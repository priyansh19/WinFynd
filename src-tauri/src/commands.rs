//! Commands the two windows call for search, indexing and model management.
//!
//! Every command here is `async`: Tauri runs plain `fn` commands on the
//! window thread, so one that waits on a lock, the disk or the network
//! freezes both windows. `tests::no_command_runs_on_the_window_thread`
//! keeps it that way.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_opener::OpenerExt;

use crate::engine::config::EngineConfig;
use crate::engine::ollama::InstalledModel;
use crate::engine::search::{Answer, SearchResponse};
use crate::engine::speech::{self, SpeechModel};
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

/// Text for a spoken search: 16 kHz mono samples from the microphone,
/// transcribed on this PC by the speech model.
#[tauri::command]
pub async fn transcribe_voice(engine: EngineState<'_>, samples: Vec<f32>) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.transcribe_query(&samples))
        .await
        .map_err(|e| e.to_string())?
}

/// Run blocking work off the window thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_status(engine: EngineState<'_>) -> Result<Status, String> {
    Ok(engine.status())
}

#[tauri::command]
pub async fn get_engine_config(engine: EngineState<'_>) -> Result<EngineConfig, String> {
    Ok(engine.config())
}

#[tauri::command]
pub async fn set_engine_config<R: Runtime>(
    app: AppHandle<R>,
    engine: EngineState<'_>,
    config: EngineConfig,
) -> Result<EngineConfig, String> {
    let engine = engine.inner().clone();
    blocking(move || {
        // A disconnected network drive can take a long time to answer.
        if config.roots.iter().any(|r| !r.is_dir()) {
            return Err("One of the folders doesn't exist".into());
        }
        if ![768, 512, 256, 128].contains(&config.dimensions) {
            return Err("Vector size must be 768, 512, 256 or 128".into());
        }
        if !config.speech_model.is_empty() && !speech::is_installed(&engine.speech_dir, &config.speech_model) {
            return Err("Download that speech model first".into());
        }
        let saved = engine.set_config(&app, config)?;
        // Every window shows folders and models; tell them all.
        let _ = app.emit("engine://config", &saved);
        Ok(saved)
    })
    .await?
}

#[tauri::command]
pub async fn rescan(engine: EngineState<'_>) -> Result<(), String> {
    engine.enqueue(Job::Scan);
    Ok(())
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
pub async fn pull_model<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, model: String) -> Result<(), String> {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelInfo {
    #[serde(flatten)]
    model: SpeechModel,
    installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    speech_models: Vec<SpeechModelInfo>,
    /// Where FFmpeg was found; null when it isn't installed.
    ffmpeg: Option<String>,
}

fn media_snapshot(engine: &Engine) -> MediaSnapshot {
    MediaSnapshot {
        speech_models: speech::CATALOG
            .iter()
            .map(|m| SpeechModelInfo { model: *m, installed: speech::is_installed(&engine.speech_dir, m.id) })
            .collect(),
        ffmpeg: engine.ffmpeg_path().map(|p| p.display().to_string()),
    }
}

/// Speech models on disk and whether FFmpeg is available. `recheck` looks
/// for FFmpeg again and rescans if it has just been installed.
#[tauri::command]
pub async fn media_support(engine: EngineState<'_>, recheck: Option<bool>) -> Result<MediaSnapshot, String> {
    let engine = engine.inner().clone();
    blocking(move || {
        if recheck.unwrap_or(false) {
            let before = engine.ffmpeg_path();
            if engine.refresh_ffmpeg() != before {
                engine.enqueue(Job::Scan);
            }
        }
        media_snapshot(&engine)
    })
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechProgress {
    id: String,
    completed: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

/// Download a Whisper model in the background; progress arrives as
/// `models://speech` events. The first model downloaded is switched on, and
/// audio and video are then transcribed by the next scan.
#[tauri::command]
pub async fn download_speech_model<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, id: String) -> Result<(), String> {
    if !speech::CATALOG.iter().any(|m| m.id == id) {
        return Err(format!("Unknown speech model {id}"));
    }
    let engine = engine.inner().clone();
    std::thread::spawn(move || {
        let emit = |p: SpeechProgress| {
            let _ = app.emit("models://speech", p);
        };
        let result = speech::download(&engine.speech_dir, &id, |completed, total| {
            emit(SpeechProgress { id: id.clone(), completed, total, done: false, error: None });
        });
        if result.is_ok() {
            let mut cfg = engine.config();
            if !speech::is_installed(&engine.speech_dir, &cfg.speech_model) {
                cfg.speech_model = id.clone();
                let _ = engine.set_config(&app, cfg);
            }
        }
        emit(SpeechProgress { id: id.clone(), completed: 0, total: 0, done: true, error: result.err() });
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
pub async fn open_path<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, path: String) -> Result<(), String> {
    let engine = engine.inner().clone();
    blocking(move || {
        let p = indexed_path(&engine, &path)?;
        crate::windows::hide_launcher(&app);
        app.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
    })
    .await?
}

#[tauri::command]
pub async fn reveal_path<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, path: String) -> Result<(), String> {
    let engine = engine.inner().clone();
    blocking(move || {
        let p = indexed_path(&engine, &path)?;
        crate::windows::hide_launcher(&app);
        app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
    })
    .await?
}

#[cfg(test)]
mod tests {
    /// Eval: a plain `fn` command runs on the window thread, where anything
    /// slow shows up as "Not Responding". Every command in this file must
    /// be `async`.
    #[test]
    fn no_command_runs_on_the_window_thread() {
        let mut checked = 0;
        for src in [include_str!("commands.rs"), include_str!("stats.rs")] {
            let mut lines = src.lines();
            while let Some(line) = lines.next() {
                if line.trim() == "#[tauri::command]" {
                    let sig = lines.next().unwrap_or_default();
                    assert!(sig.contains("async fn"), "command must be async: {sig}");
                    checked += 1;
                }
            }
        }
        assert!(checked >= 15, "found only {checked} commands");
    }
}
