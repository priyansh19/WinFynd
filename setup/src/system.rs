//! The bits of Windows that setup touches: the uninstall registry entry the NSIS
//! installer writes, the Run key, the accent color, and child processes.

use std::path::{Path, PathBuf};
use std::process::Command;

pub const PRODUCT: &str = "WinFynd";
/// The app's Tauri identifier; its config, index and WebView data live in folders with this name.
pub const BUNDLE_ID: &str = "app.winfynd.desktop";

const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\WinFynd";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// An existing install, as recorded by the NSIS installer.
#[derive(Debug, Clone)]
pub struct Installed {
    pub version: String,
    pub dir: PathBuf,
    pub main_binary: String,
}

impl Installed {
    pub fn exe(&self) -> PathBuf {
        self.dir.join(&self.main_binary)
    }
}

/// Where a fresh per-user install goes, matching the NSIS default.
pub fn default_dir() -> PathBuf {
    env_dir("LOCALAPPDATA").join(PRODUCT)
}

/// The app's own data: settings and the search index (Roaming), WebView cache (Local).
pub fn data_dirs() -> Vec<PathBuf> {
    vec![env_dir("APPDATA").join(BUNDLE_ID), env_dir("LOCALAPPDATA").join(BUNDLE_ID)]
}

fn env_dir(var: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(t) if t.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

/// A command that never flashes a console window.
pub fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Appends an argument verbatim. NSIS needs `/D=` and `_?=` unquoted and last, even with spaces.
pub fn raw_arg(cmd: &mut Command, arg: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg(arg);
    }
    #[cfg(not(windows))]
    cmd.arg(arg);
}

pub fn is_running(exe_name: &str) -> bool {
    let Ok(out) = hidden_command("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {exe_name}"), "/NH", "/FO", "CSV"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&out.stdout)
        .to_ascii_lowercase()
        .contains(&format!("\"{}\"", exe_name.to_ascii_lowercase()))
}

/// Compares dotted version numbers; anything after `-` or `+` is ignored.
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |v: &str| -> Vec<u64> {
        v.split(['-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.trim().parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let ord = a.get(i).unwrap_or(&0).cmp(b.get(i).unwrap_or(&0));
        if ord.is_ne() {
            return ord;
        }
    }
    std::cmp::Ordering::Equal
}

#[cfg(windows)]
mod imp {
    use super::*;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    pub fn installed() -> Option<Installed> {
        let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY).ok()?;
        let version: String = key.get_value("DisplayVersion").ok()?;
        let location: String = key.get_value("InstallLocation").ok()?;
        let main_binary = key
            .get_value::<String, _>("MainBinaryName")
            .unwrap_or_else(|_| format!("{PRODUCT}.exe"));
        let dir = PathBuf::from(location.trim().trim_matches('"'));
        Some(Installed { version, dir, main_binary })
    }

    pub fn autostart_enabled() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(RUN_KEY)
            .and_then(|k| k.get_value::<String, _>(PRODUCT))
            .is_ok()
    }

    /// The value name matches what the NSIS uninstaller removes.
    pub fn set_autostart(exe: Option<&Path>) -> std::io::Result<()> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY)?;
        match exe {
            Some(exe) => key.set_value(PRODUCT, &format!("\"{}\" --background", exe.display())),
            None => match key.delete_value(PRODUCT) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                other => other,
            },
        }
    }

    /// The system accent as (light theme, dark theme) colors, the shades Windows uses for buttons.
    pub fn accent() -> Option<(String, String)> {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent", KEY_READ)
            .ok()?;
        let palette = key.get_raw_value("AccentPalette").ok()?.bytes;
        // Eight RGBA entries, lightest first: Light3, Light2, Light1, Base, Dark1, Dark2, Dark3.
        let hex = |i: usize| -> Option<String> {
            let c = palette.get(i * 4..i * 4 + 3)?;
            Some(format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]))
        };
        Some((hex(4)?, hex(1)?))
    }

    /// The Evergreen WebView2 runtime registers its version under EdgeUpdate.
    pub fn webview2_present() -> bool {
        const CLIENT: &str = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        let has = |root: RegKey, path: String| {
            root.open_subkey_with_flags(path, KEY_READ)
                .and_then(|k| k.get_value::<String, _>("pv"))
                .map(|v| !v.is_empty() && v != "0.0.0.0")
                .unwrap_or(false)
        };
        has(RegKey::predef(HKEY_LOCAL_MACHINE), format!(r"SOFTWARE\WOW6432Node\{CLIENT}"))
            || has(RegKey::predef(HKEY_LOCAL_MACHINE), format!(r"SOFTWARE\{CLIENT}"))
            || has(RegKey::predef(HKEY_CURRENT_USER), format!(r"Software\{CLIENT}"))
    }
}

#[cfg(not(windows))]
mod imp {
    //! Setup only runs on Windows; these keep the crate checkable elsewhere.
    use super::*;

    pub fn installed() -> Option<Installed> {
        None
    }
    pub fn autostart_enabled() -> bool {
        false
    }
    pub fn set_autostart(_exe: Option<&Path>) -> std::io::Result<()> {
        Ok(())
    }
    pub fn accent() -> Option<(String, String)> {
        None
    }
    pub fn webview2_present() -> bool {
        true
    }
}

pub use imp::*;

#[cfg(test)]
mod tests {
    use super::compare_versions;
    use std::cmp::Ordering::*;

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(compare_versions("0.2.0", "0.10.0"), Less);
        assert_eq!(compare_versions("1.0", "1.0.0"), Equal);
        assert_eq!(compare_versions("1.2.3-beta", "1.2.3"), Equal);
        assert_eq!(compare_versions("2.0.0", "1.9.9"), Greater);
    }
}
