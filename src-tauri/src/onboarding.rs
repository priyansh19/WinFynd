//! First-run setup: which window opens at launch, and remembering that the
//! user has finished (or skipped) the welcome flow.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use crate::engine::Engine;
use crate::hotkeys::HotkeyState;
use crate::windows;

/// Bump to show the flow again after an update that adds a setup step.
const FLOW_VERSION: u32 = 1;

/// Where Ollama for Windows is downloaded from. The only web page WinFynd opens.
const OLLAMA_DOWNLOAD: &str = "https://ollama.com/download/windows";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct OnboardingFile {
    /// Flow version the user last finished; 0 means never.
    completed_version: u32,
}

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("onboarding.json"))
}

pub fn is_complete<R: Runtime>(app: &AppHandle<R>) -> bool {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<OnboardingFile>(&s).ok())
        .is_some_and(|f| f.completed_version >= FLOW_VERSION)
}

fn mark_complete<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let path = path(app).ok_or("No config folder available")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&OnboardingFile { completed_version: FLOW_VERSION })
        .map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("onboarding") {
        // A finished flow starts over at Welcome ("Run setup again").
        let _ = app.emit_to("onboarding", "onboarding://shown", ());
        let _ = w.unminimize();
        let _ = w.center();
        windows::fit_to_screen(&w);
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// At launch: the welcome flow until it's finished, then Settings.
pub fn show_first_window<R: Runtime>(app: &AppHandle<R>) {
    if is_complete(app) {
        windows::show_control_center(app);
    } else {
        show(app);
    }
}

/// Close the welcome flow. `then` is where the user goes next: "launcher" to
/// try a search, "control" for Settings, anything else for the tray.
#[tauri::command]
pub fn finish_onboarding<R: Runtime>(app: AppHandle<R>, then: String) -> Result<(), String> {
    mark_complete(&app)?;
    watch_warm_up(app.clone());
    if let Some(w) = app.get_webview_window("onboarding") {
        let _ = w.hide();
    }
    match then.as_str() {
        "launcher" => windows::show_launcher(&app),
        "control" => windows::show_control_center(&app),
        _ => {}
    }
    Ok(())
}

/// Set while a watcher runs, so setup's warm-up and closing it don't start two.
static WATCHING: AtomicBool = AtomicBool::new(false);

/// Keep the tray tooltip showing indexing progress and send one notification
/// when the first full index is done. Starts at the warm-up step, so the
/// notification comes whether setup is still open or was closed.
fn watch_warm_up<R: Runtime>(app: AppHandle<R>) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        watch(&app);
        WATCHING.store(false, Ordering::SeqCst);
    });
}

fn watch<R: Runtime>(app: &AppHandle<R>) {
    let started = Instant::now();
    let mut was_busy = false;
    loop {
        std::thread::sleep(Duration::from_secs(2));
        let Some(engine) = app.try_state::<Arc<Engine>>() else { return };
        let s = engine.status();
        let tray = app.tray_by_id("main");
        // While the search model downloads, files are indexed by words and
        // re-read once it arrives, so that doesn't count as done.
        let busy = s.state != "idle" || s.queued > 0 || s.ollama == "modelMissing";
        if busy {
            was_busy = true;
            if let Some(t) = &tray {
                let total = s.files.max(0) as usize + s.queued;
                let _ = t.set_tooltip(Some(format!("WinFynd · indexing {} of {} files", s.files, total)));
            }
            // Give up quietly if it never finishes (for example, the model is never downloaded).
            if started.elapsed() > Duration::from_secs(12 * 3600) {
                return;
            }
            continue;
        }
        if let Some(t) = &tray {
            let _ = t.set_tooltip(Some("WinFynd"));
        }
        if was_busy {
            let keys = app
                .try_state::<HotkeyState>()
                .map(|h| spoken_keys(&h.config.lock().unwrap().launcher))
                .unwrap_or_else(|| "your search shortcut".into());
            let files = thousands(s.files.max(0) as u64);
            let body = if s.ollama == "ok" {
                format!("All {files} files are searchable. Press {keys} to find anything.")
            } else {
                format!("All {files} files are searchable by words and names. Install Ollama to search by meaning.")
            };
            let _ = app.notification().builder().title("WinFynd is ready").body(body).show();
        }
        return;
    }
}

/// "Super+Shift+F" as people say it: "Win + Shift + F".
fn spoken_keys(accelerator: &str) -> String {
    accelerator.split('+').map(|k| if k == "Super" { "Win" } else { k }).collect::<Vec<_>>().join(" + ")
}

/// 51204 → "51,204", like the rest of the app.
fn thousands(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// From setup's warm-up step: notify when the first index is done, even if setup stays open.
#[tauri::command]
pub fn watch_first_index<R: Runtime>(app: AppHandle<R>) {
    watch_warm_up(app);
}

#[tauri::command]
pub fn open_ollama_download<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.opener().open_url(OLLAMA_DOWNLOAD, None::<&str>).map_err(|e| e.to_string())
}

#[derive(Clone, Serialize)]
struct Query {
    text: String,
    ask: bool,
}

/// Show the launcher from setup without finishing the flow: "Try it now", or
/// a suggested search typed in for the user (asked, with `ask`).
#[tauri::command]
pub fn try_launcher<R: Runtime>(app: AppHandle<R>, query: Option<String>, ask: Option<bool>) {
    windows::show_launcher(&app);
    if let Some(text) = query {
        let _ = app.emit_to("launcher", "launcher://query", Query { text, ask: ask.unwrap_or(false) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_numbers_and_keys_read_naturally() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(51_204), "51,204");
        assert_eq!(thousands(1_234_567), "1,234,567");
        assert_eq!(spoken_keys("Alt+Space"), "Alt + Space");
        assert_eq!(spoken_keys("Super+Shift+F"), "Win + Shift + F");
    }
}
