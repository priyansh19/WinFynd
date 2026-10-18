//! Numbers for Settings and setup that the search engine doesn't need itself:
//! files per kind (overall and per folder or drive), a quick count of what a
//! folder holds before it's indexed, the drives and their sizes, the index's
//! size on disk, and the version of the local Ollama. Everything here only
//! reads.
//!
//! Like every command, these are `async` and do their work off the window
//! thread (see `commands.rs`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::engine::scope::{self, Drive};
use crate::engine::Engine;

type EngineState<'a> = State<'a, Arc<Engine>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    path: String,
    files: i64,
    /// Files per kind ("document", "image", …).
    kinds: BTreeMap<String, i64>,
    /// True when the count stopped early on a very big folder.
    partial: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    kinds: BTreeMap<String, i64>,
    folders: Vec<FolderStats>,
    /// The index database on disk, in bytes.
    index_bytes: u64,
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

fn index_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("index.sqlite3"))
}

/// Files in the index per kind, overall and for each searched folder or drive.
#[tauri::command]
pub async fn index_stats<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>) -> Result<IndexStats, String> {
    let engine = engine.inner().clone();
    let db_path = index_path(&app);
    blocking(move || {
        let roots = engine.roots();
        let db = engine.db.lock().unwrap();
        // Files per kind under a folder; "" counts every file.
        let by_kind = |prefix: &str| -> BTreeMap<String, i64> {
            let Ok(mut stmt) =
                db.prepare_cached("SELECT kind, COUNT(*) FROM files WHERE substr(path, 1, length(?1)) = ?1 GROUP BY kind")
            else {
                return BTreeMap::new();
            };
            stmt.query_map([prefix], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default()
        };
        let kinds = by_kind("");
        let folders = roots
            .iter()
            .map(|root| {
                let kinds = by_kind(&with_separator(root));
                FolderStats { path: root.display().to_string(), files: kinds.values().sum(), kinds, partial: false }
            })
            .collect();
        drop(db);
        let index_bytes = db_path
            .map(|p| ["", "-wal", "-shm"].iter().filter_map(|s| std::fs::metadata(format!("{}{s}", p.display())).ok()).map(|m| m.len()).sum())
            .unwrap_or(0);
        IndexStats { kinds, folders, index_bytes }
    })
    .await
}

fn with_separator(root: &Path) -> String {
    let s = root.display().to_string();
    if s.ends_with(std::path::MAIN_SEPARATOR) {
        s
    } else {
        format!("{s}{}", std::path::MAIN_SEPARATOR)
    }
}

/// How many files each folder or drive holds, by kind, skipping what the
/// indexer skips. Used by setup before anything is indexed, so it stops
/// counting after a couple of seconds and says the number is partial. The
/// folders are counted side by side.
#[tauri::command]
pub async fn estimate_folders(paths: Vec<String>) -> Result<Vec<FolderStats>, String> {
    blocking(move || {
        let counting: Vec<_> = paths
            .iter()
            .cloned()
            .map(|p| std::thread::spawn(move || estimate(Path::new(&p), Duration::from_secs(2))))
            .collect();
        counting
            .into_iter()
            .zip(paths)
            .map(|(t, path)| t.join().unwrap_or(FolderStats { path, files: 0, kinds: BTreeMap::new(), partial: true }))
            .collect()
    })
    .await
}

/// The fixed drives, with their names and sizes.
#[tauri::command]
pub async fn list_drives() -> Result<Vec<Drive>, String> {
    blocking(scope::drives).await
}

fn estimate(root: &Path, limit: Duration) -> FolderStats {
    let started = Instant::now();
    let mut kinds = BTreeMap::new();
    let mut partial = false;
    let walker = walkdir::WalkDir::new(root).follow_links(false).into_iter();
    for entry in walker.filter_entry(|e| e.depth() == 0 || !crate::engine::walk_skips(e, &[])).filter_map(Result::ok) {
        if started.elapsed() > limit {
            partial = true;
            break;
        }
        if entry.file_type().is_file() {
            *kinds.entry(crate::engine::kind_name(entry.path()).to_string()).or_insert(0) += 1;
        }
    }
    // A count that stopped early stands as a lower bound ("at least").
    FolderStats { path: root.display().to_string(), files: kinds.values().sum(), kinds, partial }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaInfo {
    /// The running Ollama's version, or None when it isn't reachable.
    version: Option<String>,
}

/// Ask the local Ollama for its version. Loopback only.
#[tauri::command]
pub async fn ollama_info(engine: EngineState<'_>) -> Result<OllamaInfo, String> {
    let url = format!("{}/api/version", engine.config().ollama_url.trim_end_matches('/'));
    blocking(move || {
        let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build().ok()?;
        let body: serde_json::Value = client.get(url).send().ok()?.json().ok()?;
        body.get("version").and_then(|v| v.as_str()).map(str::to_string)
    })
    .await
    .map(|version| OllamaInfo { version })
}

/// Pause reading new files for `minutes`; 0 resumes.
#[tauri::command]
pub async fn pause_indexing(engine: EngineState<'_>, minutes: u64) -> Result<(), String> {
    engine.pause(minutes);
    Ok(())
}

/// Forget everything indexed and read the folders again from scratch.
/// The user's files are not touched.
#[tauri::command]
pub async fn delete_index(engine: EngineState<'_>) -> Result<(), String> {
    engine.enqueue(crate::engine::Job::Rebuild);
    Ok(())
}
