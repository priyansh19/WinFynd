//! Measures search quality on a set of real searches, so ranking changes are
//! judged by results instead of guesses.
//!
//! A case is a query and the file(s) it should find (a file name or the end
//! of a path). A case with no expected files should find nothing confident.
//! Run it against your own index (close WinFynd first):
//!
//! ```text
//! set WINFYND_EVAL=C:\path\to\cases.json
//! cargo test --release --lib eval_real_index -- --ignored --nocapture
//! ```
//!
//! See `src-tauri/eval/cases.example.json` for the format.

use serde::{Deserialize, Serialize};

use super::{db, Engine};

#[derive(Debug, Clone, Deserialize)]
pub struct Case {
    pub query: String,
    /// File names or path endings that count as finding it; empty means
    /// the right answer is "nothing".
    #[serde(default)]
    pub expect: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Miss {
    pub query: String,
    /// 1-based position of the first expected file, if it was listed at all.
    pub rank: Option<usize>,
    pub top: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    /// Cases that expect a file.
    pub cases: usize,
    /// Share of those where it was the first result, or in the top five.
    pub top1: f32,
    pub top5: f32,
    /// Mean of 1/rank (0 when not listed).
    pub mrr: f32,
    /// Share of those where it was marked confident.
    pub confident: f32,
    /// Cases that expect nothing, and the share that showed nothing confident.
    pub empty_cases: usize,
    pub empty_correct: f32,
    /// Photo and video-frame vectors in the index; 0 means pictures can't
    /// be found by what they show.
    pub picture_vectors: i64,
    pub misses: Vec<Miss>,
}

fn normalize(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

pub fn evaluate(engine: &Engine, cases: &[Case]) -> Report {
    let (mut n, mut top1, mut top5, mut rr, mut confident) = (0usize, 0usize, 0usize, 0f32, 0usize);
    let (mut empty, mut empty_ok) = (0usize, 0usize);
    let mut misses = Vec::new();
    for case in cases {
        let r = engine.search(&case.query, 30);
        if case.expect.is_empty() {
            empty += 1;
            if r.hits.iter().all(|h| !h.confident) {
                empty_ok += 1;
            } else {
                misses.push(Miss {
                    query: case.query.clone(),
                    rank: None,
                    top: r.hits.iter().filter(|h| h.confident).take(3).map(|h| h.name.clone()).collect(),
                });
            }
            continue;
        }
        n += 1;
        let wanted: Vec<String> = case.expect.iter().map(|e| normalize(e)).collect();
        let at = r.hits.iter().position(|h| {
            let path = normalize(&h.path);
            wanted.iter().any(|w| path.ends_with(&format!("/{w}")) || path == *w)
        });
        if let Some(i) = at {
            rr += 1.0 / (i + 1) as f32;
            top1 += usize::from(i == 0);
            top5 += usize::from(i < 5);
            confident += usize::from(r.hits[i].confident);
        }
        if at != Some(0) {
            misses.push(Miss {
                query: case.query.clone(),
                rank: at.map(|i| i + 1),
                top: r.hits.iter().take(3).map(|h| h.name.clone()).collect(),
            });
        }
    }
    let share = |k: usize, of: usize| if of == 0 { 0.0 } else { k as f32 / of as f32 };
    Report {
        cases: n,
        top1: share(top1, n),
        top5: share(top5, n),
        mrr: if n == 0 { 0.0 } else { rr / n as f32 },
        confident: share(confident, n),
        empty_cases: empty,
        empty_correct: share(empty_ok, empty),
        picture_vectors: db::visual_count(&engine.db.lock().unwrap()),
        misses,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::EngineConfig;

    /// Runs the cases in `WINFYND_EVAL` against the installed app's index.
    #[test]
    #[ignore]
    fn eval_real_index() {
        let cases_path = std::env::var("WINFYND_EVAL").expect("set WINFYND_EVAL to a cases JSON file");
        let cases: Vec<Case> = serde_json::from_str(&std::fs::read_to_string(&cases_path).unwrap()).unwrap();
        let base = std::env::var("WINFYND_DATA").map(std::path::PathBuf::from).unwrap_or_else(|_| {
            // Tauri's app data and config folder on Windows.
            std::path::PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("app.winfynd.desktop")
        });
        let config_path = base.join("engine.json");
        let config = EngineConfig::load(&config_path).expect("no engine.json; has WinFynd indexed anything?");
        let conn = db::open(&base.join("index.sqlite3")).unwrap();
        let (engine, _rx) = Engine::open(conn, config, config_path, base.join("speech"), |_| {}).unwrap();
        engine.refresh_ollama_state();
        let report = evaluate(&engine, &cases);
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    }
}
