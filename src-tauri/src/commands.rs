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
        // A disconnected network drive can take a long time to answer. Only
        // folders just added are checked, so one that's gone since can't
        // block every other setting.
        let old = engine.config();
        if config.roots.iter().filter(|r| !old.roots.contains(r)).any(|r| !r.is_dir()) {
            return Err("One of the folders doesn't exist".into());
        }
        if ![768, 512, 256, 128].contains(&config.dimensions) {
            return Err("Vector size must be 768, 512, 256 or 128".into());
        }
        if !config.speech_model.is_empty() && !speech::is_installed(&engine.speech_dir, &config.speech_model) {
            return Err("Download that speech model first".into());
        }
        let saved = engine.set_config(config)?;
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
    /// The models on this PC. Null when the search model runs in Ollama and
    /// Ollama isn't reachable.
    installed: Option<Vec<InstalledModel>>,
    error: Option<String>,
    /// Whether Ollama answered. Ask mode needs it either way.
    ollama: bool,
}

#[tauri::command]
pub async fn list_models(engine: EngineState<'_>) -> Result<ModelsSnapshot, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let from_ollama = engine.ollama().and_then(|o| o.models());
        let ollama = from_ollama.is_ok();
        if engine.config().builtin() {
            // WinFynd's own search model, plus Ollama's chat models for Ask.
            let mut installed = engine.local_model().map(|m| m.installed()).unwrap_or_default();
            installed.extend(from_ollama.unwrap_or_default().into_iter().filter(|m| !m.name.contains("embed")));
            return ModelsSnapshot { installed: Some(installed), error: None, ollama };
        }
        match from_ollama {
            Ok(m) => ModelsSnapshot { installed: Some(m), error: None, ollama },
            Err(e) => ModelsSnapshot { installed: None, error: Some(e), ollama },
        }
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

/// Download a model in the background; progress arrives as `models://pull`
/// events. The search model goes to WinFynd's own folder unless it runs in
/// Ollama; chat models always go to Ollama. Indexing resumes with the new
/// model afterwards.
#[tauri::command]
pub async fn pull_model<R: Runtime>(app: AppHandle<R>, engine: EngineState<'_>, model: String) -> Result<(), String> {
    if engine.config().builtin() && model.starts_with("embeddinggemma") {
        return download_search_model(app, engine.inner().clone(), model);
    }
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

/// Download EmbeddingGemma 2 for WinFynd to run itself, reporting progress
/// like an Ollama pull. Also called at startup when the model setup picked
/// isn't on this PC yet (an update from a version that used Ollama).
pub fn download_search_model<R: Runtime>(app: AppHandle<R>, engine: Arc<Engine>, model: String) -> Result<(), String> {
    let local = engine.local_model().ok_or("WinFynd's model engine isn't available")?;
    if local.is_downloading() {
        // Progress is already arriving.
        return Ok(());
    }
    std::thread::spawn(move || {
        let emit = |status: &str, completed: u64, total: u64, done: bool, error: Option<String>| {
            let _ = app.emit(
                "models://pull",
                PullProgress { model: model.clone(), status: status.into(), completed, total, done, error },
            );
        };
        emit("starting", 0, 0, false, None);
        let result = local.download(&model, |completed, total| {
            emit("downloading", completed, total, false, None);
            engine.note_model_download(completed, total);
        });
        if let Err(e) = &result {
            crate::diag::warn(&format!("downloading the search model failed: {e}"));
        }
        let ok = result.is_ok();
        emit(if ok { "success" } else { "failed" }, 0, 0, true, result.err());
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
    /// Its version, such as "7.1"; null when it couldn't be read.
    ffmpeg_version: Option<String>,
}

fn media_snapshot(engine: &Engine) -> MediaSnapshot {
    let ffmpeg = engine.ffmpeg_path();
    MediaSnapshot {
        speech_models: speech::CATALOG
            .iter()
            .map(|m| SpeechModelInfo { model: *m, installed: speech::is_installed(&engine.speech_dir, m.id) })
            .collect(),
        ffmpeg: ffmpeg.as_ref().map(|p| p.display().to_string()),
        ffmpeg_version: ffmpeg.as_deref().and_then(ffmpeg_version),
    }
}

/// Run `ffmpeg -version` (without flashing a console window) and take the
/// version from its first line: "ffmpeg version 7.1 Copyright ..." -> "7.1".
/// Remembered per path, so reopening the page doesn't start FFmpeg again.
fn ffmpeg_version(ffmpeg: &std::path::Path) -> Option<String> {
    static SEEN: std::sync::Mutex<Option<(PathBuf, Option<String>)>> = std::sync::Mutex::new(None);
    let mut seen = SEEN.lock().unwrap();
    if let Some((path, version)) = seen.as_ref() {
        if path == ffmpeg {
            return version.clone();
        }
    }
    let version = read_ffmpeg_version(ffmpeg);
    *seen = Some((ffmpeg.to_path_buf(), version.clone()));
    version
}

fn read_ffmpeg_version(ffmpeg: &std::path::Path) -> Option<String> {
    let mut cmd = std::process::Command::new(ffmpeg);
    cmd.arg("-version").stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let version = text.lines().next()?.strip_prefix("ffmpeg version ")?.split_whitespace().next()?;
    // Builds like "7.1-full_build-www.gyan.dev" or "n7.1" keep just the number.
    let version = version.trim_start_matches('n').split(['-', '+']).next()?;
    // Git and nightly builds ("N-115123-g…", "2024-05-13-git-…") show as plain "Found".
    (version.starts_with(|c: char| c.is_ascii_digit()) && version.contains('.')).then(|| version.to_string())
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
                // Windows showing the old config would turn speech off again on their next save.
                if let Ok(saved) = engine.set_config(cfg) {
                    let _ = app.emit("engine://config", &saved);
                }
            }
        }
        emit(SpeechProgress { id: id.clone(), completed: 0, total: 0, done: true, error: result.err() });
    });
    Ok(())
}

/// Only paths the index covers can be opened, so a page can't open arbitrary files.
fn indexed_path(engine: &Engine, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if engine.covers(&p) && p.exists() {
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

const REPO: &str = "https://github.com/priyansh19/WinFynd";

/// Open one of WinFynd's own pages (the repository, its releases or issues)
/// in the browser. Nothing else can be opened this way.
#[tauri::command]
pub async fn open_link<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    if url != REPO && !url.starts_with(&format!("{REPO}/")) {
        return Err("Only WinFynd's own pages open from here".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    /// The newest release's version, without the leading "v".
    version: String,
    url: String,
    /// True when it's newer than the running app.
    newer: bool,
}

/// The newest WinFynd release on GitHub. Settings calls this at most once a
/// day, and not at all when update checks are turned off.
#[tauri::command]
pub async fn latest_release<R: Runtime>(app: AppHandle<R>) -> Result<Release, String> {
    let running = app.package_info().version.to_string();
    blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent(concat!("WinFynd/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())?;
        let body: serde_json::Value = client
            .get("https://api.github.com/repos/priyansh19/WinFynd/releases/latest")
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;
        let version = body["tag_name"].as_str().unwrap_or_default().trim_start_matches('v').to_string();
        let url = body["html_url"].as_str().unwrap_or(REPO).to_string();
        Ok(Release { newer: is_newer(&version, &running), version, url })
    })
    .await?
}

/// "0.10.0" is newer than "0.9.2"; anything unparsable isn't newer.
fn is_newer(candidate: &str, running: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|p| p.parse::<u64>().ok()).collect::<Option<Vec<_>>>();
    match (parse(candidate), parse(running)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// Open setup again from Settings, as the tray's "Run setup again" does.
#[tauri::command]
pub async fn run_setup<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::onboarding::show(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn newer_releases_compare_by_number() {
        assert!(super::is_newer("0.10.0", "0.9.2"));
        assert!(super::is_newer("1.0.0", "0.1.0"));
        assert!(!super::is_newer("0.1.0", "0.1.0"));
        assert!(!super::is_newer("0.1.0-beta", "0.0.1"));
    }

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
