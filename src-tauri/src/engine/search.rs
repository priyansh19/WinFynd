//! Hybrid search (meaning + exact words) and Ask mode.
//!
//! Several ranked lists are fused per file with reciprocal-rank fusion
//! (RRF): nearest text chunks, nearest pictures, chunks containing every
//! query word, chunks containing some, and file names containing the words.
//! RRF needs no score calibration, which can only be fitted once there's a
//! labelled set of real searches (see `eval`), and ties are broken in a fixed
//! order so the same search always gives the same list.
//!
//! RRF always fills the list, so each result is also marked confident or
//! not: confident when its words match or its meaning is clearly close. The
//! launcher shows the rest under "Weaker matches" instead of hiding them.
//!
//! Dates, kinds and folders named in the query ("pdf from last week", "in
//! Downloads") filter the results, and are shown as chips the user can
//! remove. Recently modified files get a small boost.

use std::collections::HashMap;

use serde::Serialize;

use super::db::{self, Filter};
use super::ollama::{self, EmbedInput};
use super::{media, Engine};

/// Nearest text chunks and pictures pulled from the vector index.
const TEXT_CANDIDATES: usize = 200;
const VISUAL_CANDIDATES: usize = 60;
/// Exact-word candidates per list.
const WORD_CANDIDATES: usize = 150;
/// The usual RRF constant.
const RRF_K: f32 = 60.0;
/// How much each list counts. Pictures count less unless the query asks for
/// them, so a photo doesn't top every search just for being the nearest one.
const W_TEXT: f32 = 1.0;
const W_VISUAL: f32 = 0.5;
const W_VISUAL_WANTED: f32 = 1.0;
const W_ALL_WORDS: f32 = 1.0;
const W_SOME_WORDS: f32 = 0.4;
const W_NAME: f32 = 1.0;
const W_FILTER_ONLY: f32 = 0.6;
/// The "some words" list is only consulted when "all words" finds fewer.
const SOME_WORDS_BELOW: usize = 10;
/// Extra for a file of a kind the query hints at without naming it outright
/// ("sheet", "recording"), and for recent files (fading over ~2 months).
/// One rank-1 vote is 1/61 ≈ 0.016, so these only reorder near-ties.
const KIND_HINT_BOOST: f32 = 0.004;
const RECENCY_BOOST: f32 = 0.003;
const RECENCY_DAYS: f32 = 60.0;
/// Cosines above which a match on meaning alone counts as confident.
/// First estimates; to be fitted with the eval set on real EmbeddingGemma 2
/// scores. Pictures sit much further from text queries than text does.
const CONFIDENT_TEXT_COSINE: f32 = 0.45;
const CONFIDENT_VISUAL_COSINE: f32 = 0.20;
/// Weaker matches shown after the confident ones, at most.
const MAX_WEAK: usize = 8;

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
    /// False for weaker matches, shown after the confident ones.
    pub confident: bool,
}

/// A filter read from the query, which the user can remove.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterChip {
    pub label: String,
    /// The words in the query that set it; removing them drops the filter.
    pub phrase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<Hit>,
    /// False when only exact-word search was available (Ollama offline).
    pub semantic: bool,
    pub filters: Vec<FilterChip>,
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
    "things", "stuff", "one", "has", "have", "had", "that's", "without", "like", "since",
];

/// Words that name a kind of file outright: they filter to that kind.
const KIND_FILTERS: &[(&str, &str, &str)] = &[
    ("photo", "image", "Photos"), ("photos", "image", "Photos"), ("picture", "image", "Photos"),
    ("pictures", "image", "Photos"), ("pic", "image", "Photos"), ("pics", "image", "Photos"),
    ("image", "image", "Photos"), ("images", "image", "Photos"), ("screenshot", "image", "Photos"),
    ("screenshots", "image", "Photos"), ("selfie", "image", "Photos"), ("selfies", "image", "Photos"),
    ("video", "video", "Videos"), ("videos", "video", "Videos"), ("movie", "video", "Videos"),
    ("song", "audio", "Audio"), ("songs", "audio", "Audio"), ("music", "audio", "Audio"), ("podcast", "audio", "Audio"),
    ("spreadsheet", "spreadsheet", "Spreadsheets"), ("spreadsheets", "spreadsheet", "Spreadsheets"),
    ("excel", "spreadsheet", "Spreadsheets"), ("presentation", "slides", "Presentations"),
    ("presentations", "slides", "Presentations"), ("powerpoint", "slides", "Presentations"),
    ("slides", "slides", "Presentations"),
];
/// Extensions named outright ("the pdf from…").
const EXT_FILTERS: &[(&str, &str)] =
    &[("pdf", "pdf"), ("pdfs", "pdf"), ("docx", "docx"), ("xlsx", "xlsx"), ("pptx", "pptx"), ("csv", "csv")];
/// Words that only hint at a kind ("balance sheet" isn't asking for Excel).
const KIND_HINTS: &[(&str, &str)] = &[
    ("sheet", "spreadsheet"), ("deck", "slides"), ("doc", "document"), ("document", "document"),
    ("documents", "document"), ("recording", "audio"), ("clip", "video"), ("clips", "video"), ("audio", "audio"),
];
/// Relative dates: (phrase, days back, chip label).
const DATE_PHRASES: &[(&str, i64, &str)] = &[
    ("today", 1, "Today"), ("yesterday", 2, "Since yesterday"), ("this week", 7, "This week"),
    ("past week", 7, "This week"), ("last week", 14, "Last 2 weeks"), ("this month", 31, "This month"),
    ("past month", 31, "This month"), ("last month", 62, "Last 2 months"), ("this year", 366, "This year"),
    ("past year", 366, "This year"), ("last year", 731, "Last 2 years"), ("recently", 30, "Last 30 days"),
    ("recent", 30, "Last 30 days"),
];
/// Folders the user can name: "in Downloads", "on my desktop".
const FOLDERS: &[(&str, &str)] = &[
    ("downloads", "Downloads"), ("download", "Downloads"), ("desktop", "Desktop"), ("documents", "Documents"),
    ("pictures", "Pictures"), ("videos", "Videos"), ("music", "Music"), ("onedrive", "OneDrive"),
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
    pub filter: Filter,
    pub chips: Vec<FilterChip>,
    /// A kind hinted at without filtering ("sheet").
    pub hint: Option<&'static str>,
    /// The query is about pictures.
    pub wants_pictures: bool,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Words with their byte ranges in `text`.
fn word_spans(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in text.char_indices() {
        match (c.is_alphanumeric() || c == '\'', start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                out.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        out.push((s, text.len()));
    }
    out
}

pub(crate) fn analyze(query: &str) -> Query {
    analyze_at(query, now_secs())
}

pub(crate) fn analyze_at(query: &str, now: i64) -> Query {
    let raw = query.trim();
    let lower = raw.to_lowercase();
    // Chips quote the user's own words when lowercasing kept byte offsets.
    let original = if lower.len() == raw.len() { raw } else { lower.as_str() };
    let spans = word_spans(&lower);
    let word = |i: usize| &lower[spans[i].0..spans[i].1];
    let mut used = vec![false; spans.len()];
    let mut filter = Filter::default();
    let mut chips = Vec::new();
    let mut chip = |from: usize, to: usize, label: &str, used: &mut Vec<bool>| {
        used[from..=to].iter_mut().for_each(|u| *u = true);
        chips.push(FilterChip { label: label.to_string(), phrase: original[spans[from].0..spans[to].1].to_string() });
    };

    let mut i = 0;
    while i < spans.len() {
        // A connecting word ("from", "in", "on my") is part of the phrase.
        let lead = matches!(word(i), "from" | "in" | "on" | "since" | "during");
        let mut j = i + usize::from(lead);
        if lead && j < spans.len() && matches!(word(j), "my" | "the") {
            j += 1;
        }
        let two = (j + 1 < spans.len()).then(|| format!("{} {}", word(j), word(j + 1)));
        if let Some((days, label, end)) = DATE_PHRASES.iter().find_map(|(p, d, l)| {
            if two.as_deref() == Some(*p) {
                Some((*d, *l, j + 1))
            } else if j < spans.len() && word(j) == *p {
                Some((*d, *l, j))
            } else {
                None
            }
        }) {
            if filter.since.is_none() {
                filter.since = Some(now - days * 86_400);
                chip(i, end, label, &mut used);
            }
            i = end + 1;
            continue;
        }
        if lead && j < spans.len() {
            if let Some((_, folder)) = FOLDERS.iter().find(|(w, _)| *w == word(j)) {
                if filter.folder.is_none() {
                    filter.folder = Some(folder.to_string());
                    chip(i, j, &format!("In {folder}"), &mut used);
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    for i in 0..spans.len() {
        if used[i] {
            continue;
        }
        if let Some((_, kind, label)) = KIND_FILTERS.iter().find(|(w, _, _)| *w == word(i)) {
            if filter.kind.is_none() && filter.ext.is_none() {
                filter.kind = Some(kind.to_string());
                chip(i, i, label, &mut used);
            }
        } else if let Some((_, ext)) = EXT_FILTERS.iter().find(|(w, _)| *w == word(i)) {
            if filter.kind.is_none() && filter.ext.is_none() {
                filter.ext = Some(ext.to_string());
                chip(i, i, &format!("{} files", ext.to_uppercase()), &mut used);
            }
        }
    }

    let rest: Vec<&str> = (0..spans.len()).filter(|i| !used[*i]).map(word).collect();
    let hint = rest.iter().find_map(|w| KIND_HINTS.iter().find(|(k, _)| k == w).map(|(_, kind)| *kind));
    let mut terms: Vec<String> = rest
        .iter()
        .filter(|w| !STOPWORDS.contains(w) && !KIND_HINTS.iter().any(|(k, _)| k == *w))
        .map(|w| w.to_string())
        .collect();
    if terms.is_empty() && filter.is_empty() {
        // "the" or "sheet" alone: match on whatever was typed.
        terms = rest.iter().filter(|w| w.chars().count() > 1 || w.chars().all(|c| c.is_numeric())).map(|w| w.to_string()).collect();
    }
    terms.dedup();

    // The embedder gets the query minus filler and date or folder phrases,
    // but keeps kind words: "photo of a beach" embeds better than "beach".
    let mut semantic = (0..spans.len())
        .filter(|i| !used[*i] || KIND_FILTERS.iter().any(|(w, _, _)| *w == word(*i)))
        .map(word)
        .collect::<Vec<_>>()
        .join(" ");
    for p in FILLER_PREFIXES {
        if let Some(rest) = semantic.strip_prefix(p) {
            if !rest.trim().is_empty() {
                semantic = rest.to_string();
                break;
            }
        }
    }
    // Nothing left but kind words means "show me photos": no meaning to match.
    if terms.is_empty() {
        semantic.clear();
    }
    let wants_pictures = filter.kind.as_deref() == Some("image");
    Query { terms, semantic: semantic.trim().to_string(), filter, chips, hint, wants_pictures }
}

/// A word and the same word without a plural or verb ending, so
/// "invoices" and "invoice", "planned" and "plan" meet.
fn forms(w: &str) -> impl Iterator<Item = &str> {
    std::iter::once(w).chain(
        ["s", "es", "ing", "ed", "d"].into_iter().filter_map(move |sfx| w.strip_suffix(sfx)).filter(|b| b.chars().count() >= 3),
    )
}

/// Share of `terms` found among the words of `text`. Words match by stem,
/// or by prefix for the last word while it's still being typed.
fn coverage(terms: &[String], text: &str) -> f32 {
    if terms.is_empty() || text.is_empty() {
        return 0.0;
    }
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let found = terms
        .iter()
        .enumerate()
        .filter(|(i, t)| {
            let last = *i == terms.len() - 1;
            words.iter().any(|w| forms(w).any(|a| forms(t).any(|b| a == b)) || (last && w.starts_with(t.as_str())))
        })
        .count();
    found as f32 / terms.len() as f32
}

fn max_opt(a: Option<f32>, b: Option<f32>) -> Option<f32> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (x, y) => x.or(y),
    }
}

/// Which lists a file appeared in, and its best chunk.
#[derive(Default)]
struct Votes {
    score: f32,
    /// Best rank in any list, for breaking ties.
    best_rank: usize,
    chunk: i64,
    /// The weight of the vote that chose `chunk`.
    chunk_vote: f32,
    chunk_is_card: bool,
    cosine: Option<f32>,
    visual_cosine: Option<f32>,
    all_words: bool,
    name: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum List {
    Text,
    Visual,
    AllWords,
    SomeWords,
    Name,
    FilterOnly,
}

/// Chunk ids best first, with the cosine when the list came from meaning.
type Ranked = Vec<(i64, Option<f32>)>;

impl Engine {
    pub fn search(&self, query: &str, limit: usize) -> SearchResponse {
        let q = analyze(query);
        let empty = |semantic| SearchResponse { hits: Vec::new(), semantic, filters: q.chips.clone() };
        if q.terms.is_empty() && q.semantic.is_empty() && q.filter.is_empty() {
            return empty(true);
        }

        // Ranked lists of (chunk id, cosine if from meaning).
        let mut lists: Vec<(List, f32, Ranked)> = Vec::new();
        let qvec = if q.semantic.is_empty() { None } else { self.query_vector(&q.semantic).ok() };
        let semantic = qvec.is_some() || q.semantic.is_empty();
        if let Some(qv) = &qvec {
            let ranked = self.vectors.read().unwrap().rank(qv, TEXT_CANDIDATES, VISUAL_CANDIDATES);
            let (visual, text): (Vec<_>, Vec<_>) = ranked.into_iter().partition(|r| r.2);
            lists.push((List::Text, W_TEXT, text.into_iter().map(|(id, c, _)| (id, Some(c))).collect()));
            let w = if q.wants_pictures { W_VISUAL_WANTED } else { W_VISUAL };
            lists.push((List::Visual, w, visual.into_iter().map(|(id, c, _)| (id, Some(c))).collect()));
        }
        {
            let db = self.db.lock().unwrap();
            let words = |all| -> Vec<(i64, Option<f32>)> {
                db::fts_search(&db, &q.terms, all, true, WORD_CANDIDATES)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(id, _)| (id, None))
                    .collect()
            };
            let all = words(true);
            if q.terms.len() > 1 && all.len() < SOME_WORDS_BELOW {
                lists.push((List::SomeWords, W_SOME_WORDS, words(false)));
            }
            lists.push((List::AllWords, W_ALL_WORDS, all));
            let names = db::name_search(&db, &q.terms, WORD_CANDIDATES).unwrap_or_default();
            lists.push((List::Name, W_NAME, names.into_iter().map(|id| (id, None)).collect()));
            if q.terms.is_empty() && !q.filter.is_empty() {
                let newest = db::newest_matching(&db, &q.filter, WORD_CANDIDATES).unwrap_or_default();
                lists.push((List::FilterOnly, W_FILTER_ONLY, newest.into_iter().map(|id| (id, None)).collect()));
            }
        }

        // Fuse per file: each list votes once per file, at its best rank.
        let db = self.db.lock().unwrap();
        let mut files: HashMap<i64, db::FileRow> = HashMap::new();
        // Chunk → (file, is the file card).
        let mut chunk_file: HashMap<i64, Option<(i64, bool)>> = HashMap::new();
        let mut votes: HashMap<i64, Votes> = HashMap::new();
        for (list, weight, ranked) in &lists {
            let mut voted: HashMap<i64, ()> = HashMap::new();
            let mut rank = 0;
            for (chunk_id, cosine) in ranked {
                let found = *chunk_file.entry(*chunk_id).or_insert_with(|| {
                    let (file, chunk) = db::chunk_with_file(&db, *chunk_id).ok().flatten()?;
                    let id = file.id;
                    files.entry(id).or_insert(file);
                    Some((id, chunk.text.is_none() && !chunk.visual))
                });
                let Some((file_id, is_card)) = found else { continue };
                if !q.filter.allows(&files[&file_id]) {
                    continue;
                }
                let first_vote = voted.insert(file_id, ()).is_none();
                let v = votes.entry(file_id).or_insert_with(|| Votes { best_rank: usize::MAX, ..Votes::default() });
                match list {
                    List::Text => v.cosine = max_opt(v.cosine, *cosine),
                    List::Visual => v.visual_cosine = max_opt(v.visual_cosine, *cosine),
                    List::AllWords => v.all_words = true,
                    List::Name => v.name = true,
                    _ => {}
                }
                if first_vote {
                    let vote = weight / (RRF_K + rank as f32 + 1.0);
                    v.score += vote;
                    v.best_rank = v.best_rank.min(rank);
                    // Show the chunk behind the strongest vote, but any chunk
                    // with content (a passage, a picture) over the file card.
                    let better = match (is_card, v.chunk_is_card) {
                        _ if v.chunk == 0 => true,
                        (false, true) => true,
                        (true, false) => false,
                        _ => vote > v.chunk_vote,
                    };
                    if better {
                        v.chunk = *chunk_id;
                        v.chunk_vote = vote;
                        v.chunk_is_card = is_card;
                    }
                    rank += 1;
                }
            }
        }

        let now = now_secs();
        let mut ranked: Vec<(i64, Votes)> = votes.into_iter().collect();
        for (file_id, v) in ranked.iter_mut() {
            let file = &files[file_id];
            let age_days = (now - file.mtime).max(0) as f32 / 86_400.0;
            v.score += RECENCY_BOOST * (-age_days / RECENCY_DAYS).exp();
            if q.hint == Some(file.kind.as_str()) {
                v.score += KIND_HINT_BOOST;
            }
        }
        let confident = |v: &Votes| {
            v.all_words
                || v.name
                || v.cosine.is_some_and(|c| c >= CONFIDENT_TEXT_COSINE)
                || v.visual_cosine.is_some_and(|c| c >= CONFIDENT_VISUAL_COSINE)
                || (q.terms.is_empty() && q.semantic.is_empty())
        };
        // Fixed order: confident first, then score, best rank, newest, id.
        ranked.sort_by(|(a_id, a), (b_id, b)| {
            confident(b)
                .cmp(&confident(a))
                .then(b.score.total_cmp(&a.score))
                .then(a.best_rank.cmp(&b.best_rank))
                .then(files[b_id].mtime.cmp(&files[a_id].mtime))
                .then(a_id.cmp(b_id))
        });

        let mut hits = Vec::new();
        let mut weak = 0;
        for (file_id, v) in ranked {
            let is_confident = confident(&v);
            if !is_confident {
                if weak >= MAX_WEAK {
                    break;
                }
                weak += 1;
            }
            let Ok(Some((_, chunk))) = db::chunk_with_file(&db, v.chunk) else { continue };
            let file = files.remove(&file_id).unwrap();
            let text_words = chunk.text.as_deref().map_or(0.0, |t| coverage(&q.terms, t));
            let timed = chunk.label.as_deref().is_some_and(media::is_timestamp);
            let card = chunk.text.is_none() && !chunk.visual;
            let reason = match (&file.kind[..], &chunk.label) {
                ("image", _) if chunk.visual => "Image matches your search".to_string(),
                (_, Some(at)) if timed && chunk.visual => format!("Shown at {at}"),
                (_, Some(at)) if timed && text_words >= 1.0 => format!("Said at {at}, exact words"),
                (_, Some(at)) if timed => format!("Talked about at {at}"),
                (_, Some(label)) if text_words >= 1.0 => format!("Exact words on {}", label.to_lowercase()),
                (_, Some(label)) => format!("Matches the meaning on {}", label.to_lowercase()),
                _ if text_words >= 1.0 => "Exact words match".to_string(),
                _ if v.name => "Name matches".to_string(),
                _ if card && q.terms.is_empty() => format!("Newest {}", file.kind),
                _ if card => "Name and folder are a close match".to_string(),
                _ => "Matches the meaning".to_string(),
            };
            hits.push(Hit {
                id: file.id,
                chunk_id: v.chunk,
                kind: file.kind,
                name: file.name,
                path: file.path,
                size: file.size,
                modified: file.mtime,
                location: chunk.label,
                snippet: chunk.text.map(|t| snippet(&t, query)),
                reason,
                score: v.score,
                confident: is_confident,
            });
            if hits.len() >= limit {
                break;
            }
        }
        SearchResponse { hits, semantic, filters: q.chips }
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

    const NOW: i64 = 1_800_000_000;

    #[test]
    fn queries_drop_filler_and_read_filters() {
        let q = analyze_at("Find me the photo of my passport", NOW);
        assert_eq!(q.terms, vec!["passport"]);
        assert_eq!(q.filter.kind.as_deref(), Some("image"));
        assert_eq!(q.chips, vec![FilterChip { label: "Photos".into(), phrase: "photo".into() }]);
        assert_eq!(q.semantic, "the photo of my passport");

        let q = analyze_at("that PDF from last week", NOW);
        assert!(q.terms.is_empty());
        assert_eq!(q.filter.ext.as_deref(), Some("pdf"));
        assert_eq!(q.filter.since, Some(NOW - 14 * 86_400));
        assert_eq!(q.chips.iter().map(|c| c.phrase.as_str()).collect::<Vec<_>>(), vec!["from last week", "PDF"]);
        assert!(q.semantic.is_empty());

        let q = analyze_at("invoice in my Downloads", NOW);
        assert_eq!(q.terms, vec!["invoice"]);
        assert_eq!(q.filter.folder.as_deref(), Some("Downloads"));
        assert_eq!(q.chips[0].phrase, "in my Downloads");

        // "balance sheet" hints at a kind without filtering.
        let q = analyze_at("balance sheet 2025", NOW);
        assert_eq!(q.terms, vec!["balance", "2025"]);
        assert!(q.filter.is_empty());
        assert_eq!(q.hint, Some("spreadsheet"));
    }

    #[test]
    fn coverage_matches_stems_both_ways() {
        let terms = vec!["invoices".to_string(), "acme".to_string()];
        assert_eq!(coverage(&terms, "Invoice from ACME Studio"), 1.0);
        assert_eq!(coverage(&terms, "Acme lunch menu"), 0.5);
        let terms = vec!["q3".to_string(), "pla".to_string()];
        assert_eq!(coverage(&terms, "q3 planning"), 1.0);
        assert_eq!(coverage(&["pla".to_string(), "q3".to_string()], "planning q3"), 0.5);
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
