//! Showing and hiding the windows: the floating launcher and Settings, which
//! lives in the tray.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WebviewWindowBuilder};

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

/// Settings and setup open at the design's size, which is taller than a
/// small laptop at 150% scale. Shrink a window to the screen it's on and
/// centre it; Tauri still holds it to its minimum size. A maximized window
/// is left alone: resizing it would un-maximize it.
pub fn fit_to_screen<R: Runtime>(w: &WebviewWindow<R>) {
    if w.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(Some(monitor)), Ok(size)) = (w.current_monitor(), w.outer_size()) else { return };
    let area = monitor.work_area().size;
    let (max_w, max_h) = (area.width * 19 / 20, area.height * 19 / 20);
    if size.width <= max_w && size.height <= max_h {
        return;
    }
    let _ = w.set_size(PhysicalSize::new(size.width.min(max_w), size.height.min(max_h)));
    let _ = w.center();
}

/// Settings and setup aren't built until they're opened, and closing them
/// frees them again, so WinFynd waiting in the tray holds only the launcher
/// and the indexer. `then` runs once the window exists; `page` is passed to a
/// newly built Settings window, which reads it as it loads.
///
/// Building a window from the window thread deadlocks on Windows (wry#583),
/// and tray menus and plain commands run there, so a new one is built on its
/// own thread.
pub fn with_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &'static str,
    page: Option<String>,
    then: impl FnOnce(WebviewWindow<R>, bool) + Send + 'static,
) {
    if let Some(w) = app.get_webview_window(label) {
        then(w, false);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        static BUILDING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _one_at_a_time = BUILDING.lock();
        // Opened twice quickly: the first call built it.
        if let Some(w) = app.get_webview_window(label) {
            then(w, false);
            return;
        }
        let Some(config) = app.config().app.windows.iter().find(|w| w.label == label).cloned() else { return };
        let mut builder = match WebviewWindowBuilder::from_config(&app, &config) {
            Ok(b) => b,
            Err(e) => return crate::diag::warn(&format!("couldn't open the {label} window: {e}")),
        };
        if let Some(page) = page {
            let page = serde_json::to_string(&page).unwrap_or_default();
            builder = builder.initialization_script(format!("window.__WINFYND_PAGE__ = {page};"));
        }
        match builder.build() {
            Ok(w) => {
                crate::native::apply_window(&w);
                then(w, true);
            }
            Err(e) => crate::diag::warn(&format!("couldn't open the {label} window: {e}")),
        }
    });
}

pub fn show_control_center<R: Runtime>(app: &AppHandle<R>) {
    open_settings(app, None);
}

fn open_settings<R: Runtime>(app: &AppHandle<R>, page: Option<String>) {
    let event_page = page.clone();
    with_window(app, "control", page, move |w, new| {
        let _ = w.unminimize();
        if new || !w.is_visible().unwrap_or(true) {
            fit_to_screen(&w);
        }
        let _ = w.show();
        let _ = w.set_focus();
        // A new window got the page as it loaded.
        if let (false, Some(page)) = (new, event_page) {
            let _ = w.emit_to("control", "settings://page", page);
        }
    });
}

#[tauri::command]
pub fn hide_launcher_cmd<R: Runtime>(app: AppHandle<R>) {
    hide_launcher(&app);
}

/// Open Settings, optionally at a page ("folders", "models", …).
#[tauri::command]
pub fn open_control_center<R: Runtime>(app: AppHandle<R>, page: Option<String>) {
    hide_launcher(&app);
    open_settings(&app, page);
}
