//! Global hotkeys: which key combos trigger which action, saved to disk and
//! registered with the OS so they work while any app has focus.

use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::windows;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    /// Show or hide the floating launcher.
    Launcher,
    /// Push-to-talk (or press-to-toggle) voice search.
    Voice,
    /// Open the launcher in answer mode.
    Ask,
    /// Search for whatever text is selected in the foreground app.
    Selection,
}

impl Action {
    pub const ALL: [Action; 4] = [
        Action::Launcher,
        Action::Voice,
        Action::Ask,
        Action::Selection,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceMode {
    /// Listen while the key is held, search on release.
    Hold,
    /// First press starts listening, second press stops.
    Toggle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConfig {
    pub launcher: String,
    pub voice: String,
    pub ask: String,
    pub selection: String,
    pub voice_mode: VoiceMode,
    pub auto_submit: bool,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            launcher: "Alt+Space".into(),
            voice: "Alt+Shift+Space".into(),
            ask: "Ctrl+Alt+Space".into(),
            selection: "Super+Shift+F".into(),
            voice_mode: VoiceMode::Hold,
            auto_submit: true,
        }
    }
}

impl HotkeyConfig {
    pub fn get(&self, action: Action) -> &str {
        match action {
            Action::Launcher => &self.launcher,
            Action::Voice => &self.voice,
            Action::Ask => &self.ask,
            Action::Selection => &self.selection,
        }
    }

    fn set(&mut self, action: Action, accelerator: String) {
        match action {
            Action::Launcher => self.launcher = accelerator,
            Action::Voice => self.voice = accelerator,
            Action::Ask => self.ask = accelerator,
            Action::Selection => self.selection = accelerator,
        }
    }

    /// Which action, if any, a pressed shortcut belongs to.
    fn action_for(&self, shortcut: &Shortcut) -> Option<Action> {
        Action::ALL
            .into_iter()
            .find(|a| Shortcut::from_str(self.get(*a)).is_ok_and(|s| &s == shortcut))
    }
}

#[derive(Default)]
pub struct HotkeyState {
    pub config: Mutex<HotkeyConfig>,
}

fn config_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("hotkeys.json"))
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> HotkeyConfig {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save<R: Runtime>(app: &AppHandle<R>, config: &HotkeyConfig) -> Result<(), String> {
    let path = config_path(app).ok_or("No config folder available")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Replace every registered shortcut with the ones in `config`. Returns the
/// actions whose combo the OS refused (usually taken by another app).
pub fn register_all<R: Runtime>(app: &AppHandle<R>, config: &HotkeyConfig) -> Vec<Action> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    Action::ALL
        .into_iter()
        .filter(|a| {
            let ok = Shortcut::from_str(config.get(*a))
                .map_err(|e| e.to_string())
                .and_then(|s| gs.register(s).map_err(|e| e.to_string()));
            ok.is_err()
        })
        .collect()
}

/// Called by the global-shortcut plugin for every press and release.
pub fn handle<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    let config = app.state::<HotkeyState>().config.lock().unwrap().clone();
    let Some(action) = config.action_for(shortcut) else {
        return;
    };

    match (action, event.state()) {
        (Action::Launcher, ShortcutState::Pressed) => windows::toggle_launcher(app),
        (Action::Voice, ShortcutState::Pressed) => {
            windows::show_launcher(app);
            let _ = app.emit_to("launcher", "voice://press", ());
        }
        (Action::Voice, ShortcutState::Released) if config.voice_mode == VoiceMode::Hold => {
            let _ = app.emit_to("launcher", "voice://release", ());
        }
        (Action::Ask, ShortcutState::Pressed) => {
            windows::show_launcher(app);
            let _ = app.emit_to("launcher", "launcher://ask", ());
        }
        (Action::Selection, ShortcutState::Pressed) => {
            windows::show_launcher(app);
            let _ = app.emit_to("launcher", "launcher://selection", ());
        }
        _ => {}
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySnapshot {
    config: HotkeyConfig,
    /// Actions whose combo could not be registered.
    unavailable: Vec<Action>,
}

#[tauri::command]
pub fn get_hotkeys<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, HotkeyState>,
) -> HotkeySnapshot {
    let config = state.config.lock().unwrap().clone();
    let gs = app.global_shortcut();
    let unavailable = Action::ALL
        .into_iter()
        .filter(|a| Shortcut::from_str(config.get(*a)).map_or(true, |s| !gs.is_registered(s)))
        .collect();
    HotkeySnapshot {
        config,
        unavailable,
    }
}

/// Bind `accelerator` (for example "Ctrl+Shift+Space") to `action`. Fails
/// without changing anything if the combo is malformed, already used by
/// another WinFynd action, or taken by another app.
#[tauri::command]
pub fn set_hotkey<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, HotkeyState>,
    action: Action,
    accelerator: String,
) -> Result<HotkeyConfig, String> {
    let new = Shortcut::from_str(&accelerator)
        .map_err(|_| format!("{accelerator} isn't a valid key combo"))?;

    let mut config = state.config.lock().unwrap();
    for other in Action::ALL.into_iter().filter(|a| *a != action) {
        if Shortcut::from_str(config.get(other)).is_ok_and(|s| s == new) {
            return Err(format!(
                "{accelerator} is already used by another WinFynd action"
            ));
        }
    }

    let gs = app.global_shortcut();
    if let Ok(old) = Shortcut::from_str(config.get(action)) {
        let _ = gs.unregister(old);
    }
    if gs.register(new).is_err() {
        if let Ok(old) = Shortcut::from_str(config.get(action)) {
            let _ = gs.register(old);
        }
        return Err(format!("{accelerator} is already taken by another app"));
    }

    config.set(action, accelerator);
    save(&app, &config)?;
    Ok(config.clone())
}

#[tauri::command]
pub fn set_voice_options<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, HotkeyState>,
    voice_mode: VoiceMode,
    auto_submit: bool,
) -> Result<HotkeyConfig, String> {
    let mut config = state.config.lock().unwrap();
    config.voice_mode = voice_mode;
    config.auto_submit = auto_submit;
    save(&app, &config)?;
    Ok(config.clone())
}

/// While the Control Center records a new combo, release every hotkey so the
/// OS passes key presses through to the recorder instead of firing actions.
#[tauri::command]
pub fn suspend_hotkeys<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, HotkeyState>,
    suspended: bool,
) {
    if suspended {
        let _ = app.global_shortcut().unregister_all();
    } else {
        register_all(&app, &state.config.lock().unwrap());
    }
}
