//! Hybrid search (meaning + exact words) and Ask mode.
//!
//! Every candidate chunk gets one score from three signals:
//! - meaning: how far its cosine similarity stands above the typical score
//!   for this query, measured separately for text and for pictures, so
//!   photos compete fairly with documents;
//! - exact words: how many of the query's meaningful words appear in the
//!   chunk's text and in the file name;
//! - the kind of file asked for ("photo of…", "the budget spreadsheet").
//!
//! A result has to clear a fixed bar on that score and stay close to the
//! best result, so a search with one clear answer doesn't trail off into
//! dozens of loosely related files.

use std::collections::HashMap;

use serde::Serialize;

use super::ollama::{self, EmbedInput};
use super::vectors::Spread;
use super::{db, media, name_words, Engine};

/// Nearest text chunks and pictures pulled from the vector index.
const TEXT_CANDIDATES: usize = 200;
const VISUAL_CANDIDATES: usize = 60;
/// Exact-word candidates per full-text query.
const WORD_CANDIDATES: usize = 150;
/// Below these cosines a chunk is never kept on meaning alone, however much
/// it stands out. Pictures sit much further from text queries than text does.
const MIN_TEXT_COSINE: f32 = 0.25;
const MIN_VISUAL_COSINE: f32 = 0.08;
/// Weights for the exact-word signals (squared coverage, so all words
/// matching counts far more than some). Every word in the file name is
/// enough on its own; every word in the text needs the meaning to agree a bit.
const TEXT_WORDS_WEIGHT: f32 = 2.5;
const NAME_WORDS_WEIGHT: f32 = 3.5;
/// Bonus when the file is the kind the query asks for.
const KIND_BONUS: f32 = 1.5;
/// A file-name chunk says less than real content, so its meaning counts less.
const NAME_ONLY_PENALTY: f32 = 0.5;
/// Score a result needs, with and without meaning (Ollama offline).
const MIN_SCORE: f32 = 3.5;
const MIN_SCORE_WORDS_ONLY: f32 = 1.5;
/// Results this far below the best one are dropped.
const MAX_GAP: f32 = 4.0;
/// With fewer vectors than this in a modality its score spread is blended
/// with a typical one, so a small index (or a handful of photos) still works.
const PRIOR_WEIGHT: f32 = 50.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: i64,
    pub chunk_id: i64,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified: i64,
    /// Where in the file: "Page 3", "Slide 7", "Sheet Q1"…
    pub location: Option<String>,
    pub snippet: Option<String>,
    pub reason: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<Hit>,
    /// False when only exact-word search was available (Ollama offline).
    pub semantic: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub n: usize,
    pub name: String,
    pub path: String,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub text: String,
    pub sources: Vec<Source>,
    pub model: String,
}

/// Words that say nothing about which file is meant.
const STOPWORDS: &[&str] = &[
    "a", "an", "the", "of", "to", "in", "on", "for", "with", "and", "or", "is", "are", "was", "were", "be", "been", "it",
    "its", "my", "me", "i", "we", "our", "you", "your", "this", "that", "these", "those", "there", "here", "at", "by",
    "from", "as", "about", "into", "find", "search", "show", "open", "get", "look", "looking", "where", "what", "which",
    "when", "who", "how", "does", "do", "did", "can", "could", "please", "some", "any", "all", "file", "files", "thing",
    "things", "stuff", "one", "has", "have", "had", "that's", "with", "without", "like",
];

/// Words that name a kind of file, and the kind they mean.
const KIND_WORDS: &[(&str, &str)] = &[
    ("photo", "image"), ("photos", "image"), ("picture", "image"), ("pictures", "image"), ("pic", "image"),
    ("pics", "image"), ("image", "image"), ("images", "image"), ("screenshot", "image"), ("screenshots", "image"),
    ("selfie", "image"), ("selfies", "image"), ("video", "video"), ("videos", "video"), ("clip", "video"),
    ("clips", "video"), ("movie", "video"), ("song", "audio"), ("songs", "audio"), ("music", "audio"),
    ("audio", "audio"), ("podcast", "audio"), ("recording", "audio"), ("spreadsheet", "spreadsheet"),
    ("spreadsheets", "spreadsheet"), ("excel", "spreadsheet"), ("sheet", "spreadsheet"), ("csv", "spreadsheet"),
    ("slides", "slides"), ("presentation", "slides"), ("deck", "slides"), ("powerpoint", "slides"),
    ("pdf", "document"), ("document", "document"), ("documents", "document"), ("doc", "document"),
];

/// Leading phrases that only say "search for", dropped before embedding.
const FILLER_PREFIXES: &[&str] = &[
    "find me ", "find my ", "find the ", "find ", "show me ", "show my ", "show ", "search for ", "search ",
    "look for ", "where is ", "where's ", "open ", "get me ", "i need ", "i'm looking for ", "looking for ",
];

/// What a query is after.
#[derive(Debug, PartialEq)]
pub(crate) struct Query {
    /// Meaningful words, lowercased, for exact-word matching.
    pub terms: Vec<String>,
    /// The query as sent to the embedder.
    pub semantic: String,
    /// The kind of file asked for, if any.
    pub wants: Option<&'static str>,
}

pub(crate) fn analyze(query: &str) -> Query {
    let lower = query.trim().to_lowercase();
    let mut semantic = lower.as_str();
    for p in FILLER_PREFIXES {
        if let Some(rest) = semantic.strip_prefix(p) {
            if !rest.trim().is_empty() {
                semantic = rest;
                break;
            }
        }
    }
    let words: Vec<String> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect();
    let wants = words.iter().find_map(|w| KIND_WORDS.iter().find(|(k, _)| k == w).map(|(_, kind)| *kind));
    let mut terms: Vec<String> = words
        .iter()
        .filter(|w| !STOPWORDS.contains(&w.as_str()) && !KIND_WORDS.iter().any(|(k, _)| k == w))
        .cloned()
        .collect();
    if terms.is_empty() {
        // "photos" or "the" alone: match on whatever was typed.
        terms = words.into_iter().filter(|w| w.chars().count() > 1 || w.chars().all(|c| c.is_numeric())).collect();
    }
    terms.dedup();
    Query { terms, semantic: semantic.trim().to_string(), wants }
}

/// Share of `terms` found among the words of `text`. Words match whole, or by
/// prefix for longer words ("invoice" finds "invoices") and for the last word
/// while it's still being typed.
fn coverage(terms: &[String], text: &str) -> f32 {
    if terms.is_empty() || text.is_empty() {
        return 0.0;
    }
    let words: Vec<String> = text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect();
    let found = terms
        .iter()
        .enumerate()
        .filter(|(i, t)| {
            let prefix_ok = t.chars().count() >= 4 || *i == terms.len() - 1;
            words.iter().any(|w| w == *t || (prefix_ok && w.starts_with(t.as_str())))
        })
        .count();
    found as f32 / terms.len() as f32
}

/// A modality's score spread, blended with a typical one while there are
/// too few vectors to trust it.
fn calibrated(spread: &Spread, visual: bool) -> Spread {
    let (prior_mean, prior_std) = if visual { (0.10, 0.06) } else { (0.15, 0.07) };
    let n = spread.count as f32;
    let w = n + PRIOR_WEIGHT;
    let mean = (n * spread.mean + PRIOR_WEIGHT * prior_mean) / w;
    let var = (n * spread.std.powi(2) + PRIOR_WEIGHT * prior_std * prior_std) / w;
    Spread { mean, std: var.sqrt(), count: spread.count }
}

/// What the meaning side contributed for one chunk.
struct Meaning {
    cosine: f32,
    z: f32,
}

impl Engine {
    pub fn search(&self, query: &str, limit: usize) -> SearchResponse {
        let q = analyze(query);
        if q.semantic.is_empty() && q.terms.is_empty() {
            return SearchResponse { hits: Vec::new(), semantic: true };
        }

        // Meaning: the query vector, nearest chunks of each modality, and the
        // spread that tells a real match from the usual background similarity.
        let qvec = self.query_vector(&q.semantic).ok();
        let semantic = qvec.is_some();
        let mut meaning: HashMap<i64, Meaning> = HashMap::new();
        let mut spreads = (Spread::default(), Spread::default());
        if let Some(qv) = &qvec {
            let vectors = self.vectors.read().unwrap();
            let ranked = vectors.rank(qv, TEXT_CANDIDATES, VISUAL_CANDIDATES);
            spreads = (calibrated(&ranked.text, false), calibrated(&ranked.visual, true));
            for (id, cosine, visual) in ranked.top {
                let z = if visual { spreads.1.z(cosine) } else { spreads.0.z(cosine) };
                meaning.insert(id, Meaning { cosine, z });
            }
        }

        // Exact words: chunks with every word, then (for several words) any.
        let mut candidates: Vec<i64> = meaning.keys().copied().collect();
        {
            let db = self.db.lock().unwrap();
            candidates.extend(db::fts_search(&db, &q.terms, true, true, WORD_CANDIDATES).unwrap_or_default());
            if q.terms.len() > 1 {
                candidates.extend(db::fts_search(&db, &q.terms, false, true, WORD_CANDIDATES).unwrap_or_default());
            }
        }
        candidates.sort_unstable();
        candidates.dedup();

        // Score each chunk; keep each file's best.
        let db = self.db.lock().unwrap();
        let vectors = self.vectors.read().unwrap();
        let mut best: HashMap<i64, (f32, Hit)> = HashMap::new();
        for chunk_id in candidates {
            let Ok(Some((file, chunk))) = db::chunk_with_file(&db, chunk_id) else { continue };
            let m = meaning.get(&chunk_id).map(|m| Meaning { cosine: m.cosine, z: m.z }).or_else(|| {
                let (cosine, visual) = vectors.score(chunk_id, qvec.as_deref()?)?;
                Some(Meaning { cosine, z: if visual { spreads.1.z(cosine) } else { spreads.0.z(cosine) } })
            });
            let name_only = chunk.text.is_none() && !chunk.visual;
            let text_words = chunk.text.as_deref().map_or(0.0, |t| coverage(&q.terms, t));
            let stem = file.name.rsplit_once('.').map_or(file.name.as_str(), |(s, _)| s);
            let name_words_cov = coverage(&q.terms, &format!("{} {}", stem, name_words(stem)));

            let mut meaning_part = m.as_ref().map_or(0.0, |m| m.z.clamp(-2.0, 8.0));
            if name_only {
                meaning_part -= NAME_ONLY_PENALTY;
            }
            let floor = if chunk.visual { MIN_VISUAL_COSINE } else { MIN_TEXT_COSINE };
            let by_meaning = m.as_ref().is_some_and(|m| m.cosine >= floor);
            let words_part = TEXT_WORDS_WEIGHT * text_words.powi(2) + NAME_WORDS_WEIGHT * name_words_cov.powi(2);
            if !by_meaning && words_part == 0.0 {
                continue;
            }
            let kind_part = if q.wants == Some(file.kind.as_str()) { KIND_BONUS } else { 0.0 };
            let score = meaning_part + words_part + kind_part;
            if score < if semantic { MIN_SCORE } else { MIN_SCORE_WORDS_ONLY } {
                continue;
            }
            if best.get(&file.id).is_some_and(|(s, _)| *s >= score) {
                continue;
            }

            let timed = chunk.label.as_deref().is_some_and(media::is_timestamp);
            let all_text_words = text_words >= 1.0;
            let name_led = name_words_cov >= 1.0 && (name_only || !all_text_words) && meaning_part < 3.0;
            let reason = match (&file.kind[..], &chunk.label) {
                _ if name_led => "Name matches".to_string(),
                ("image", _) if chunk.visual => "Image matches your search".to_string(),
                (_, Some(at)) if timed && chunk.visual => format!("Shown at {at}"),
                (_, Some(at)) if timed && all_text_words => format!("Said at {at}, exact words"),
                (_, Some(at)) if timed => format!("Talked about at {at}"),
                (_, Some(label)) if all_text_words => format!("Exact words on {}", label.to_lowercase()),
                (_, Some(label)) => format!("Matches the meaning on {}", label.to_lowercase()),
                (_, None) if all_text_words => "Exact words match".to_string(),
                (_, None) if name_only => "Name is a close match".to_string(),
                _ => "Matches the meaning".to_string(),
            };
            let hit = Hit {
                id: file.id,
                chunk_id,
                kind: file.kind,
                name: file.name,
                path: file.path,
                size: file.size,
                modified: file.mtime,
                location: chunk.label,
                snippet: chunk.text.map(|t| snippet(&t, query)),
                reason,
                score,
            };
            best.insert(hit.id, (score, hit));
        }

        let mut hits: Vec<Hit> = best.into_values().map(|(_, h)| h).collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score));
        if let Some(top) = hits.first().map(|h| h.score) {
            hits.retain(|h| h.score >= top - MAX_GAP);
        }
        hits.truncate(limit);
        SearchResponse { hits, semantic }
    }

    fn query_vector(&self, query: &str) -> Result<Vec<f32>, String> {
        let cfg = self.config();
        self.ollama()?
            .embed(&cfg.embed_model, &[EmbedInput::Query(query.to_string())], cfg.dimensions)?
            .pop()
            .ok_or_else(|| "No query embedding".to_string())
    }

    /// Answer a question from the most relevant passages, citing them.
    pub fn ask(&self, question: &str) -> Result<Answer, String> {
        let cfg = self.config();
        let client = self.ollama()?;
        let installed = client.models()?;
        let model = if !cfg.chat_model.is_empty() && ollama::has_model(&installed, &cfg.chat_model) {
            cfg.chat_model.clone()
        } else {
            installed
                .iter()
                .map(|m| m.name.clone())
                .find(|n| !n.contains("embed"))
                .ok_or("No chat model is installed in Ollama. Pull one (for example gemma4) to use Ask mode.")?
        };

        let hits: Vec<Hit> = self.search(question, 12).hits.into_iter().filter(|h| h.snippet.is_some()).take(6).collect();
        if hits.is_empty() {
            return Ok(Answer {
                text: "I couldn't find anything in your indexed files about that.".into(),
                sources: Vec::new(),
                model,
            });
        }

        let db = self.db.lock().unwrap();
        let mut context = String::new();
        let mut sources = Vec::new();
        for (i, h) in hits.iter().enumerate() {
            let full = passage_for(&db, h).unwrap_or_else(|| h.snippet.clone().unwrap_or_default());
            let loc = h.location.as_deref().map(|l| format!(", {l}")).unwrap_or_default();
            context.push_str(&format!("[{}] {}{}\n{}\n\n", i + 1, h.name, loc, full));
            sources.push(Source { n: i + 1, name: h.name.clone(), path: h.path.clone(), location: h.location.clone() });
        }
        drop(db);

        let system = "You answer questions using only the numbered passages from the user's own files. \
                      Cite passages like [1] or [2][3]. If the passages don't contain the answer, say so plainly. \
                      Be brief: lead with the answer in one or two sentences.";
        let user = format!("Passages:\n\n{context}Question: {question}");
        let text = client.chat(&model, system, &user)?;
        Ok(Answer { text, sources, model })
    }
}

/// The full chunk text behind a hit (the hit only carries a snippet).
fn passage_for(db: &rusqlite::Connection, hit: &Hit) -> Option<String> {
    db::chunk_with_file(db, hit.chunk_id).ok().flatten().and_then(|(_, c)| c.text)
}

/// About 220 characters around the first query word found, else the start.
fn snippet(text: &str, query: &str) -> String {
    const LEN: usize = 220;
    let lower = text.to_lowercase();
    let at = query
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .filter_map(|w| lower.find(&w.to_lowercase()))
        .min()
        .unwrap_or(0);
    let chars: Vec<char> = text.chars().collect();
    // Lowercasing can change byte lengths, so convert via the lowered text.
    let char_at = lower[..at].chars().count().min(chars.len());
    let start = char_at.saturating_sub(60);
    let end = (start + LEN).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{}", s.trim_start());
    }
    if end < chars.len() {
        s = format!("{}…", s.trim_end());
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_drop_filler_and_spot_the_kind() {
        let q = analyze("Find me the photo of my passport");
        assert_eq!(q.terms, vec!["passport"]);
        assert_eq!(q.wants, Some("image"));
        assert_eq!(q.semantic, "the photo of my passport");
        let q = analyze("budget spreadsheet 2025");
        assert_eq!(q.terms, vec!["budget", "2025"]);
        assert_eq!(q.wants, Some("spreadsheet"));
        // Nothing but kind words still searches for something.
        assert_eq!(analyze("photos").terms, vec!["photos"]);
    }

    #[test]
    fn coverage_counts_whole_and_prefix_words() {
        let terms = vec!["invoice".to_string(), "acme".to_string()];
        assert_eq!(coverage(&terms, "Invoices from ACME Studio"), 1.0);
        assert_eq!(coverage(&terms, "Acme lunch menu"), 0.5);
        // Short words only match as a prefix while being typed (last word).
        let terms = vec!["q3".to_string(), "pla".to_string()];
        assert_eq!(coverage(&terms, "q3 planning"), 1.0);
        assert_eq!(coverage(&["pla".to_string(), "q3".to_string()], "planning q3"), 0.5);
    }

    #[test]
    fn small_modalities_lean_on_the_prior() {
        let one_photo = Spread { mean: 0.5, std: 0.0, count: 1 };
        let c = calibrated(&one_photo, true);
        assert!(c.z(0.5) > 5.0, "a lone matching photo must still stand out");
        let big = Spread { mean: 0.3, std: 0.05, count: 100_000 };
        assert!((calibrated(&big, false).mean - 0.3).abs() < 0.001);
    }

    #[test]
    fn snippet_centers_on_query() {
        let text = format!("{} the launch moves to June {}", "x ".repeat(200), "y ".repeat(200));
        let s = snippet(&text, "launch june");
        assert!(s.contains("launch moves to June"));
        assert!(s.starts_with('…') && s.ends_with('…'));
    }

    #[test]
    fn snippet_handles_multibyte() {
        let s = snippet("café ☕ résumé naïve", "résumé");
        assert!(s.contains("résumé"));
    }
}
