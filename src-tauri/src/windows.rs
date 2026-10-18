//! Showing and hiding the two windows: the floating launcher and the
//! Control Center that lives in the tray.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewWindow};

/// Put the launcher where PowerToys Run puts its box: centred across the
/// monitor the pointer is on, a fifth of the way down its work area, so it
/// opens where you're looking and grows downwards as results arrive.
fn place_launcher<R: Runtime>(app: &AppHandle<R>, w: &WebviewWindow<R>) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, w.outer_size()) else {
        let _ = w.center();
        return;
    };
    // The window takes the target monitor's scale once it moves there.
    let scale = monitor.scale_factor() / w.scale_factor().unwrap_or(1.0);
    let width = (size.width as f64 * scale) as i32;
    let area = monitor.work_area();
    let x = area.position.x + (area.size.width as i32 - width) / 2;
    let y = area.position.y + area.size.height as i32 / 5;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

pub fn show_launcher<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("launcher") {
        place_launcher(app, &w);
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
