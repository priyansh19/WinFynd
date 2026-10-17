//! Commands the two windows call for search, indexing and model management.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_opener::OpenerExt;

use crate::engine::config::EngineConfig;
use crate::engine::ollama::InstalledModel;
use crate::engine::search::{Answer, SearchResponse};
use crate::engine::{Engine, Job, Status};

type EngineState<'a> = State<'a, Arc<Engine>>;

#[tauri::command]
pub async fn search(engine: EngineState<'_>, query: String, limit: Option<usize>) -> Result<SearchResponse, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.search(&query, limit.unwrap_or(30)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ask(engine: EngineState<'_>, question: String) -> Result<Answer, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.ask(&question))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn engine_status(engine: EngineState<'_>) -> Status {
    engine.status()
}

#[tauri::command]
pub fn get_engine_config(engine: EngineState<'_>) -> EngineConfig {
    engine.config()
}

#[tauri::command]
pub fn set_engine_config<R: Runtime>(
    app: AppHandle<R>,
    engine: EngineState<'_>,
    config: EngineConfig,
) -> Result<EngineConfig, String> {
    if config.roots.iter().any(|r| !r.is_dir()) {
        return Err("One of the folders doesn't exist".into());
    }
    if ![768, 512, 256, 128].contains(&config.dimensions) {
        return Err("Vector size must be 768, 512, 256 or 128".into());
    }
    engine.set_config(&app, config)
}

#[tauri::command]
pub fn rescan(engine: EngineState<'_>) {
    engine.enqueue(Job::Scan);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsSnapshot {
    /// Null when Ollama isn't reachable.
    installed: Option<Vec<InstalledModel>>,
    error: Option<String>,
}

#[tauri::command]
pub async fn list_models(engine: EngineState<'_>) -> Result<ModelsSnapshot, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match engine.ollama().and_then(|o| o.models()) {
        Ok(m) => ModelsSnapshot { installed: Some(m), error: None },
        Err(e) => ModelsSnapshot { installed: None, error: Some(e) },
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullProgress {
    model: String,
    status: String,
    completed: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

/// Download a model into Ollama in the background; progress arrives as
/// `models://pull` events. Indexing resumes with the new model afterwards.
#[tauri::command]
pub fn pull_model<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, model: String) -> Result<(), String> {
    let client = engine.ollama()?;
    let engine = engine.inner().clone();
    std::thread::spawn(move || {
        let emit = |p: PullProgress| {
            let _ = app.emit("models://pull", p);
        };
        let result = client.pull(&model, |status, completed, total| {
            emit(PullProgress { model: model.clone(), status, completed, total, done: false, error: None });
        });
        emit(PullProgress {
            model: model.clone(),
            status: if result.is_ok() { "success".into() } else { "failed".into() },
            completed: 0,
            total: 0,
            done: true,
            error: result.err(),
        });
        engine.enqueue(Job::Scan);
    });
    Ok(())
}

/// Only paths inside the index can be opened, so a page can't open arbitrary files.
fn indexed_path(engine: &Engine, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let roots = engine.config().roots;
    if roots.iter().any(|r| p.starts_with(r)) && p.exists() {
        Ok(p)
    } else {
        Err("That file isn't in an indexed folder".into())
    }
}

#[tauri::command]
pub fn open_path<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, path: String) -> Result<(), String> {
    let p = indexed_path(&engine, &path)?;
    crate::windows::hide_launcher(&app);
    app.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_path<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, path: String) -> Result<(), String> {
    let p = indexed_path(&engine, &path)?;
    crate::windows::hide_launcher(&app);
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}
