//! Win32 calls behind the native look: the accent palette from the registry,
//! the OS build (Mica needs Windows 11), DWM rounded corners, Explorer's
//! icons and thumbnails through the shell's image factory, and the text
//! selected in other apps through UI Automation.

use std::ffi::c_void;
use std::mem::size_of;

use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, SIZE};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, IBindCtx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED,
};
use windows::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT,
};

fn reg_bytes(root: HKEY, key: PCWSTR, value: PCWSTR, flags: windows::Win32::System::Registry::REG_ROUTINE_FLAGS) -> Option<Vec<u8>> {
    let mut len = 0u32;
    unsafe {
        if RegGetValueW(root, key, value, flags, None, None, Some(&mut len)).is_err() || len == 0 {
            return None;
        }
        let mut buf = vec![0u8; len as usize];
        if RegGetValueW(root, key, value, flags, None, Some(buf.as_mut_ptr() as *mut c_void), Some(&mut len)).is_err() {
            return None;
        }
        buf.truncate(len as usize);
        Some(buf)
    }
}

/// The seven shades Windows derives from the user's accent colour, lightest
/// first: Light3, Light2, Light1, Accent, Dark1, Dark2, Dark3.
pub fn accent_palette() -> Option<Vec<[u8; 3]>> {
    let bytes = reg_bytes(
        HKEY_CURRENT_USER,
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent"),
        w!("AccentPalette"),
        RRF_RT_REG_BINARY,
    )?;
    if bytes.len() < 28 {
        return None;
    }
    Some(bytes.chunks_exact(4).take(7).map(|c| [c[0], c[1], c[2]]).collect())
}

/// Windows build number, e.g. 22631. Windows 11 starts at 22000.
pub fn os_build() -> u32 {
    reg_bytes(
        HKEY_LOCAL_MACHINE,
        w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
        w!("CurrentBuildNumber"),
        RRF_RT_REG_SZ,
    )
    .map(|b| {
        let wide: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
        String::from_utf16_lossy(&wide).trim().parse().unwrap_or(0)
    })
    .unwrap_or(0)
}

/// Ask DWM for Windows 11's rounded corners on a borderless window. A no-op
/// on Windows 10, which has square corners everywhere.
pub fn round_corners(hwnd: HWND) {
    let pref = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const _ as *const c_void,
            size_of::<i32>() as u32,
        );
    }
}

/// The picture Explorer shows for a file, as straight-alpha RGBA pixels:
/// its icon, or with `thumbnail` its thumbnail when it has one.
pub fn shell_image(path: &str, size: u32, thumbnail: bool) -> Result<(u32, u32, Vec<u8>), String> {
    unsafe {
        // The shell wants a single-threaded apartment; already initialised is fine.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(path), None::<&IBindCtx>).map_err(|e| e.to_string())?;
        let flags: SIIGBF = if thumbnail { SIIGBF_RESIZETOFIT } else { SIIGBF_ICONONLY };
        let side = size as i32;
        let bitmap = factory.GetImage(SIZE { cx: side, cy: side }, flags).map_err(|e| e.to_string())?;
        let object = HGDIOBJ(bitmap.0);

        let mut bm = BITMAP::default();
        if GetObjectW(object, size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void)) == 0 {
            let _ = DeleteObject(object);
            return Err("unreadable bitmap".into());
        }
        let (w, h) = (bm.bmWidth.max(0) as u32, bm.bmHeight.unsigned_abs());
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32), // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let dc = GetDC(None);
        let rows = GetDIBits(dc, bitmap, 0, h, Some(pixels.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS);
        ReleaseDC(None, dc);
        let _ = DeleteObject(object);
        if rows == 0 {
            return Err("unreadable bitmap".into());
        }

        // BGRA with premultiplied alpha -> RGBA with straight alpha. Thumbnails
        // without an alpha channel come back all-zero alpha and are opaque.
        let opaque = pixels.chunks_exact(4).all(|p| p[3] == 0);
        for p in pixels.chunks_exact_mut(4) {
            let a = if opaque { 255 } else { p[3] };
            let (b, g, r) = (p[0], p[1], p[2]);
            let un = |c: u8| if a == 0 || a == 255 { c } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
            p[0] = un(r);
            p[1] = un(g);
            p[2] = un(b);
            p[3] = a;
        }
        Ok((w, h, pixels))
    }
}

/// The text selected in the focused control of the app in front, read through
/// UI Automation so the clipboard is left alone. None when that app doesn't
/// expose its selection this way, or nothing is selected.
pub fn selected_text(max_chars: i32) -> Option<String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let focused = uia.GetFocusedElement().ok()?;
        let pattern: IUIAutomationTextPattern = focused.GetCurrentPatternAs(UIA_TextPatternId).ok()?;
        let ranges = pattern.GetSelection().ok()?;
        let mut text = String::new();
        for i in 0..ranges.Length().ok()? {
            text.push_str(&ranges.GetElement(i).ok()?.GetText(max_chars).ok()?.to_string());
            text.push(' ');
        }
        Some(text)
    }
}
