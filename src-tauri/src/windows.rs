//! Showing and hiding the two windows: the floating launcher and the
//! Control Center that lives in the tray.

use tauri::{AppHandle, Emitter, Manager, Runtime};

pub fn show_launcher<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("launcher") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("launcher", "launcher://shown", ());
    }
}

pub fn hide_launcher<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("launcher") {
        let _ = w.hide();
    }
}

pub fn toggle_launcher<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window("launcher") {
        Some(w) if w.is_visible().unwrap_or(false) => hide_launcher(app),
        Some(_) => show_launcher(app),
        None => {}
    }
}

pub fn show_control_center<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("control") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn hide_launcher_cmd<R: Runtime>(app: AppHandle<R>) {
    hide_launcher(&app);
}

#[tauri::command]
pub fn open_control_center<R: Runtime>(app: AppHandle<R>) {
    hide_launcher(&app);
    show_control_center(&app);
}
