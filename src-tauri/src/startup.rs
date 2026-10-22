//! Starting WinFynd when the user signs in, so it keeps watching and indexing
//! in the tray. It's the same Run key value setup writes (and the NSIS
//! uninstaller removes), with `--background` so no window opens.
//!
//! A per-user Run key rather than a Windows service: a service runs as
//! SYSTEM in its own session, where the user's OneDrive files and drive
//! mappings aren't there to read, and installing one needs admin rights.

#[cfg(windows)]
mod imp {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE: &str = "WinFynd";

    pub fn enabled() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(RUN_KEY)
            .and_then(|k| k.get_value::<String, _>(VALUE))
            .is_ok()
    }

    pub fn set(on: bool) -> Result<(), String> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY).map_err(|e| e.to_string())?;
        if on {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            key.set_value(VALUE, &format!("\"{}\" --background", exe.display())).map_err(|e| e.to_string())
        } else {
            match key.delete_value(VALUE) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn enabled() -> bool {
        false
    }

    pub fn set(_on: bool) -> Result<(), String> {
        Err("Starting with the computer is only set up on Windows".into())
    }
}

pub use imp::{enabled, set};

#[tauri::command]
pub async fn start_with_windows() -> Result<bool, String> {
    Ok(enabled())
}

#[tauri::command]
pub async fn set_start_with_windows(on: bool) -> Result<bool, String> {
    set(on)?;
    Ok(enabled())
}
