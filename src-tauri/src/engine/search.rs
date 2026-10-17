//! Hybrid search (meaning + exact words) and Ask mode.

use std::collections::HashMap;

use serde::Serialize;

use super::ollama::{self, EmbedInput};
use super::{db, media, Engine};

/// Candidates pulled from each list before fusing.
const CANDIDATES: usize = 80;
/// Reciprocal-rank-fusion constant; 60 is the usual choice.
const RRF_K: f32 = 60.0;
/// Below this cosine similarity a vector match is treated as noise.
const MIN_SIMILARITY: f32 = 0.2;

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

impl Engine {
    pub fn search(&self, query: &str, limit: usize) -> SearchResponse {
        let query = query.trim();
        if query.is_empty() {
            return SearchResponse { hits: Vec::new(), semantic: true };
        }

        let vector_hits = self.vector_candidates(query);
        let semantic = vector_hits.is_ok();
        let vector_hits = vector_hits.unwrap_or_default();
        let fts_hits = db::fts_search(&self.db.lock().unwrap(), query, CANDIDATES).unwrap_or_default();

        // Fuse the two rankings per chunk, then keep each file's best chunk.
        let mut fused: HashMap<i64, (f32, bool, bool)> = HashMap::new();
        for (rank, (id, _)) in vector_hits.iter().enumerate() {
            let e = fused.entry(*id).or_default();
            e.0 += 1.0 / (RRF_K + rank as f32);
            e.1 = true;
        }
        for (rank, (id, _)) in fts_hits.iter().enumerate() {
            let e = fused.entry(*id).or_default();
            e.0 += 1.0 / (RRF_K + rank as f32);
            e.2 = true;
        }
        let mut ranked: Vec<(i64, (f32, bool, bool))> = fused.into_iter().collect();
        ranked.sort_by(|a, b| b.1 .0.total_cmp(&a.1 .0));

        let db = self.db.lock().unwrap();
        let mut seen = HashMap::new();
        let mut hits = Vec::new();
        for (chunk_id, (score, by_meaning, by_words)) in ranked {
            let Ok(Some((file, chunk))) = db::chunk_with_file(&db, chunk_id) else { continue };
            if seen.insert(file.id, ()).is_some() {
                continue;
            }
            let timed = chunk.label.as_deref().is_some_and(media::is_timestamp);
            let reason = match (&file.kind[..], &chunk.label, by_meaning, by_words) {
                ("image", _, true, _) => "Image matches your search".to_string(),
                (_, Some(at), true, _) if timed && chunk.text.is_none() => format!("Shown at {at}"),
                (_, Some(at), _, true) if timed => format!("Said at {at}, exact words"),
                (_, Some(at), true, _) if timed => format!("Talked about at {at}"),
                (_, Some(label), _, true) => format!("Exact words on {}", label.to_lowercase()),
                (_, Some(label), true, _) => format!("Matches the meaning on {}", label.to_lowercase()),
                (_, None, _, true) if chunk.text.is_none() => "Name matches".to_string(),
                (_, None, _, true) => "Exact words match".to_string(),
                (_, None, true, _) if chunk.text.is_none() => "Name is a close match".to_string(),
                _ => "Matches the meaning".to_string(),
            };
            hits.push(Hit {
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
            });
            if hits.len() >= limit {
                break;
            }
        }
        SearchResponse { hits, semantic }
    }

    fn vector_candidates(&self, query: &str) -> Result<Vec<(i64, f32)>, String> {
        let cfg = self.config();
        let q = self
            .ollama()?
            .embed(&cfg.embed_model, &[EmbedInput::Query(query.to_string())], cfg.dimensions)?
            .pop()
            .ok_or("No query embedding")?;
        Ok(self
            .vectors
            .read()
            .unwrap()
            .top_k(&q, CANDIDATES)
            .into_iter()
            .filter(|(_, s)| *s >= MIN_SIMILARITY)
            .collect())
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
