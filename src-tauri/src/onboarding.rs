//! First-run setup: which window opens at launch, and remembering that the
//! user has finished (or skipped) the welcome flow.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

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
        let _ = w.unminimize();
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// At launch: the welcome flow until it's finished, then the Control Center.
pub fn show_first_window<R: Runtime>(app: &AppHandle<R>) {
    if is_complete(app) {
        windows::show_control_center(app);
    } else {
        show(app);
    }
}

/// Close the welcome flow. `then` is where the user goes next: "launcher" to
/// try a search, "control" for the Control Center, anything else for the tray.
#[tauri::command]
pub fn finish_onboarding<R: Runtime>(app: AppHandle<R>, then: String) -> Result<(), String> {
    mark_complete(&app)?;
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

#[tauri::command]
pub fn open_ollama_download<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.opener().open_url(OLLAMA_DOWNLOAD, None::<&str>).map_err(|e| e.to_string())
}

/// Show the launcher from the hotkeys step, without finishing the flow.
#[tauri::command]
pub fn try_launcher<R: Runtime>(app: AppHandle<R>) {
    windows::show_launcher(&app);
}
