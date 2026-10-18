//! Native look and feel: system backdrops, rounded corners, the user's accent
//! colour, and Explorer's own icons and thumbnails for results.

#[cfg(windows)]
mod win;

use serde::Serialize;
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, Window};

/// What a window's page needs to paint itself like the rest of Windows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    /// Accent shades as #rrggbb, lightest first (Light3 … Accent … Dark3).
    /// Empty when unknown; the page falls back to Windows' default blue.
    accent: Vec<String>,
    /// The system backdrop behind the page: "mica", "acrylic" or "none".
    backdrop: &'static str,
}

/// Acrylic for the launcher, like other transient flyouts; Mica for the
/// Settings window on Windows 11. Windows 10 has no Mica, so that window
/// paints a solid background instead.
fn backdrop_for(label: &str) -> &'static str {
    #[cfg(windows)]
    {
        match label {
            "launcher" => "acrylic",
            _ if win::os_build() >= 22000 => "mica",
            _ => "none",
        }
    }
    #[cfg(not(windows))]
    {
        let _ = label;
        "none"
    }
}

pub fn apply<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        let effect = match backdrop_for(&label) {
            "acrylic" => Some(Effect::Acrylic),
            "mica" => Some(Effect::Mica),
            _ => None,
        };
        if let Some(effect) = effect {
            let _ = window.set_effects(EffectsBuilder::new().effect(effect).build());
        }
        // A borderless window gets square corners unless it asks DWM for round
        // ones. Every window draws its own title bar, so all of them ask.
        #[cfg(windows)]
        {
            if let Ok(hwnd) = window.hwnd() {
                win::round_corners(hwnd);
            }
        }
    }
}

/// Light/dark switches change which accent shades the page should use.
pub fn theme_changed<R: Runtime>(window: &Window<R>) {
    let _ = window.emit_to(window.label(), "appearance://changed", ());
}

#[tauri::command]
pub fn appearance<R: Runtime>(window: WebviewWindow<R>) -> Appearance {
    #[cfg(windows)]
    let accent = win::accent_palette()
        .map(|p| p.iter().map(|[r, g, b]| format!("#{r:02x}{g:02x}{b:02x}")).collect())
        .unwrap_or_default();
    #[cfg(not(windows))]
    let accent = Vec::new();
    Appearance { accent, backdrop: backdrop_for(window.label()) }
}

/// Longest selection used as a search; anything past it is cut.
#[cfg_attr(not(windows), allow(dead_code))]
const SELECTION_CHARS: usize = 200;

/// The text selected in the app in front, as a one-line search, for the
/// "Search selected text" shortcut. Gives up after 400 ms so a busy app
/// can't hold the launcher back.
pub fn selected_text() -> Option<String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(win::selected_text(SELECTION_CHARS as i32 * 4));
        });
        rx.recv_timeout(std::time::Duration::from_millis(400)).ok().flatten().and_then(|t| as_query(&t))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Selected text as a search: whitespace and line breaks folded to single
/// spaces, cut to `SELECTION_CHARS`; None when nothing is left.
#[cfg_attr(not(windows), allow(dead_code))]
fn as_query(raw: &str) -> Option<String> {
    let text: String = raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(SELECTION_CHARS).collect();
    let text = text.trim_end().to_string();
    (!text.is_empty()).then_some(text)
}

/// Explorer's icon for a file, or with `thumbnail` its thumbnail when it has
/// one, as a PNG data URL.
#[tauri::command]
pub async fn shell_image(path: String, size: u32, thumbnail: bool) -> Result<String, String> {
    #[cfg(windows)]
    {
        use base64::Engine as _;
        tauri::async_runtime::spawn_blocking(move || {
            let (w, h, rgba) = win::shell_image(&path, size.clamp(16, 512), thumbnail)?;
            let img = image::RgbaImage::from_raw(w, h, rgba).ok_or("unreadable bitmap")?;
            let mut png = std::io::Cursor::new(Vec::new());
            img.write_to(&mut png, image::ImageFormat::Png).map_err(|e| e.to_string())?;
            Ok(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png.into_inner())
            ))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (path, size, thumbnail);
        Err("Explorer images are only available on Windows".into())
    }
}

/// Which of these files are OneDrive placeholders whose contents are only
/// online. Reading one, even to draw it as a thumbnail, downloads it.
#[tauri::command]
pub async fn online_only(paths: Vec<String>) -> Result<Vec<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| is_online_only(p)).collect())
        .await
        .map_err(|e| e.to_string())
}

/// The same attributes the indexer looks for before reading a file.
#[cfg(windows)]
fn is_online_only(path: &str) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x40000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x400000;
    std::fs::metadata(path).is_ok_and(|m| {
        m.file_attributes() & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0
    })
}

#[cfg(not(windows))]
fn is_online_only(_path: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selections_become_one_line_searches() {
        assert_eq!(as_query("  lease\r\n renewal \t notice "), Some("lease renewal notice".into()));
        assert_eq!(as_query(" \n\t "), None);
        let long = "word ".repeat(100);
        let q = as_query(&long).unwrap();
        assert!(q.chars().count() <= SELECTION_CHARS);
        assert!(!q.ends_with(' '));
    }
}
