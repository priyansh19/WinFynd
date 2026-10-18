//! WinFynd Setup: a small Windows 11 style window in front of the NSIS installer.
//!
//! The NSIS installer that `tauri build` makes still does the actual install and the
//! Apps & features entry; this runs it silently and shows progress. Built without the
//! `payload` feature it is only the uninstaller, shipped inside the app as uninstall-ui.exe.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod system;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WindowEvent};

use system::Installed;

#[cfg(feature = "payload")]
const PAYLOAD: Option<&[u8]> = Some(include_bytes!(env!("WINFYND_PAYLOAD")));
#[cfg(not(feature = "payload"))]
const PAYLOAD: Option<&[u8]> = None;

/// The version of the embedded app, passed in by scripts/build-installer.mjs.
const VERSION: &str = match option_env!("WINFYND_VERSION") {
    Some(v) => v,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Mode {
    Install,
    Update,
    Reinstall,
    /// A newer WinFynd is already installed.
    Newer,
    Uninstall,
    /// Run with --uninstall, but WinFynd isn't installed.
    NotInstalled,
    /// The uninstaller build, started without --uninstall.
    NoPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupState {
    mode: Mode,
    version: &'static str,
    installed_version: Option<String>,
    install_dir: String,
    running: bool,
    autostart: bool,
    data_bytes: u64,
    /// Size of the installed app folder, shown when uninstalling.
    app_bytes: u64,
    accent_light: Option<String>,
    accent_dark: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallOptions {
    dir: String,
    autostart: bool,
    desktop_shortcut: bool,
}

#[derive(Serialize, Clone)]
struct Step {
    id: &'static str,
    status: &'static str,
}

struct App {
    mode: Mode,
    installed: Option<Installed>,
    busy: AtomicBool,
}

fn args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

fn detect_mode(installed: &Option<Installed>) -> Mode {
    let uninstalling = args().iter().any(|a| a == "--uninstall");
    match (uninstalling, installed, PAYLOAD) {
        (true, Some(_), _) => Mode::Uninstall,
        (true, None, _) => Mode::NotInstalled,
        (false, _, None) => Mode::NoPayload,
        (false, None, Some(_)) => Mode::Install,
        (false, Some(i), Some(_)) => match system::compare_versions(VERSION, &i.version) {
            std::cmp::Ordering::Greater => Mode::Update,
            std::cmp::Ordering::Equal => Mode::Reinstall,
            std::cmp::Ordering::Less => Mode::Newer,
        },
    }
}

#[tauri::command]
fn get_state(app: tauri::State<App>) -> SetupState {
    let accent = system::accent();
    let installed = app.installed.as_ref();
    SetupState {
        mode: app.mode,
        version: VERSION,
        installed_version: installed.map(|i| i.version.clone()),
        install_dir: installed
            .map(|i| i.dir.clone())
            .unwrap_or_else(system::default_dir)
            .display()
            .to_string(),
        running: installed.is_some_and(|i| system::is_running(&i.main_binary)),
        autostart: installed.is_none() || system::autostart_enabled(),
        data_bytes: if app.mode == Mode::Uninstall {
            system::data_dirs().iter().map(|d| system::dir_size(d)).sum()
        } else {
            0
        },
        app_bytes: match (app.mode, installed) {
            (Mode::Uninstall, Some(i)) => system::dir_size(&i.dir),
            _ => 0,
        },
        accent_light: accent.as_ref().map(|a| a.0.clone()),
        accent_dark: accent.map(|a| a.1),
    }
}

#[tauri::command]
async fn choose_folder(window: tauri::Window, current: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Choose where to install WinFynd")
        .set_directory(&current)
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });
    let folder = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()?;
    let path = folder.into_path().ok()?;
    // Picking an existing folder installs into a WinFynd folder inside it, like most installers.
    Some(if path.ends_with(system::PRODUCT) { path } else { path.join(system::PRODUCT) }.display().to_string())
}

/// Runs a blocking job off the UI thread while keeping the window from closing.
async fn guarded<T: Send + 'static>(
    handle: tauri::AppHandle,
    job: impl FnOnce(&tauri::AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = handle.state::<App>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Setup is already working.".into());
    }
    let worker = handle.clone();
    let result = tauri::async_runtime::spawn_blocking(move || job(&worker))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    handle.state::<App>().busy.store(false, Ordering::SeqCst);
    result
}

fn step(handle: &tauri::AppHandle, id: &'static str, status: &'static str) {
    let _ = handle.emit("step", Step { id, status });
}

/// Runs `job` as one named step, reporting it active, then done or failed.
fn run_step<T>(
    handle: &tauri::AppHandle,
    id: &'static str,
    job: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    step(handle, id, "active");
    let result = job();
    step(handle, id, if result.is_ok() { "done" } else { "failed" });
    result
}

#[tauri::command]
async fn install(handle: tauri::AppHandle, options: InstallOptions) -> Result<(), String> {
    guarded(handle, move |handle| {
        let app = handle.state::<App>();
        let updating = matches!(app.mode, Mode::Update | Mode::Reinstall);
        let payload = PAYLOAD.ok_or("This copy of setup doesn't include WinFynd.")?;
        // Updates go where WinFynd already is; the folder choice only applies to fresh installs.
        let dir = match (&app.installed, updating) {
            (Some(i), true) => i.dir.clone(),
            _ => PathBuf::from(options.dir.trim()),
        };
        if !dir.is_absolute() {
            return Err("Choose a full folder path, like C:\\Apps\\WinFynd.".into());
        }

        let installer = run_step(handle, "prepare", || {
            let path = std::env::temp_dir().join(format!("WinFynd-{VERSION}-installer.exe"));
            std::fs::write(&path, payload).map_err(|e| format!("Couldn't unpack WinFynd: {e}"))?;
            Ok(path)
        })?;

        let result = run_step(handle, "copy", || run_nsis(&installer, &dir, updating, options.desktop_shortcut));
        let _ = std::fs::remove_file(&installer);
        result?;

        run_step(handle, "register", || {
            let now = system::installed().ok_or("WinFynd didn't register with Windows.")?;
            if system::compare_versions(&now.version, VERSION).is_ne() {
                return Err(format!("Windows still lists WinFynd {}.", now.version));
            }
            // An update keeps whatever the person chose before.
            if !updating {
                system::set_autostart(options.autostart.then(|| now.exe()).as_deref())
                    .map_err(|e| format!("Couldn't set WinFynd to start at sign-in: {e}"))?;
            }
            Ok(())
        })
    })
    .await
}

fn run_nsis(installer: &Path, dir: &Path, updating: bool, desktop_shortcut: bool) -> Result<(), String> {
    let mut cmd = system::hidden_command(installer);
    cmd.arg("/S");
    if updating {
        // Same flag Tauri's updater uses: keeps the Run key and doesn't add a desktop shortcut.
        cmd.arg("/UPDATE");
    } else if !desktop_shortcut {
        cmd.arg("/NS");
    }
    system::raw_arg(&mut cmd, &format!("/D={}", dir.display()));
    let status = cmd.status().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    match status.code() {
        Some(0) => Ok(()),
        // NSIS aborts when WinFynd can't be closed or a newer version is installed.
        Some(2) => Err("WinFynd couldn't be closed, or a newer version is installed. Quit WinFynd from the tray and try again.".into()),
        code => Err(format!("The installer stopped with code {}.", code.unwrap_or(-1))),
    }
}

#[tauri::command]
async fn uninstall(handle: tauri::AppHandle, delete_data: bool) -> Result<(), String> {
    guarded(handle, move |handle| {
        let installed = handle.state::<App>().installed.clone().ok_or("WinFynd isn't installed.")?;

        run_step(handle, "remove", || {
            let uninstaller = installed.dir.join("uninstall.exe");
            let mut cmd = system::hidden_command(&uninstaller);
            cmd.arg("/S");
            // `_?=` runs it in place so we can wait for it; it then can't delete itself.
            system::raw_arg(&mut cmd, &format!("_?={}", installed.dir.display()));
            let status = cmd.status().map_err(|e| format!("Couldn't start the uninstaller: {e}"))?;
            if !status.success() {
                return Err(format!("The uninstaller stopped with code {}.", status.code().unwrap_or(-1)));
            }
            let _ = std::fs::remove_file(&uninstaller);
            // Only removes the folder if nothing else is left in it.
            let _ = std::fs::remove_dir(&installed.dir);
            Ok(())
        })?;

        if delete_data {
            run_step(handle, "data", || {
                for dir in system::data_dirs() {
                    if dir.exists() {
                        std::fs::remove_dir_all(&dir)
                            .map_err(|e| format!("Couldn't delete {}: {e}", dir.display()))?;
                    }
                }
                Ok(())
            })?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
fn launch_app(app: tauri::State<App>, background: bool) -> Result<(), String> {
    let installed = system::installed().or_else(|| app.installed.clone()).ok_or("WinFynd isn't installed.")?;
    let mut cmd = std::process::Command::new(installed.exe());
    cmd.current_dir(&installed.dir);
    if background {
        cmd.arg("--background");
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Couldn't open WinFynd: {e}"))
}

/// The uninstall entry points at this exe inside the install folder, which the NSIS
/// uninstaller has to delete. Run from a temp copy instead.
fn relaunch_from_temp(installed: &Installed) -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    if !exe.starts_with(&installed.dir) || args().iter().any(|a| a == "--relaunched") {
        return false;
    }
    let copy = std::env::temp_dir().join(format!("WinFynd-uninstall-{}.exe", std::process::id()));
    std::fs::copy(&exe, &copy).is_ok()
        && std::process::Command::new(&copy).args(args()).arg("--relaunched").spawn().is_ok()
}

/// Deletes this temp copy once the process has exited.
fn schedule_self_delete() {
    let Ok(exe) = std::env::current_exe() else { return };
    let is_temp_copy = exe.file_name().is_some_and(|n| n.to_string_lossy().starts_with("WinFynd-uninstall-"));
    if !is_temp_copy {
        return;
    }
    let mut cmd = system::hidden_command("cmd");
    system::raw_arg(&mut cmd, &format!("/C ping 127.0.0.1 -n 3 > nul & del \"{}\"", exe.display()));
    let _ = cmd.spawn();
}

/// NSIS flags (from Tauri's own reinstall flow, or a script) go straight to the real uninstaller.
fn pass_through_uninstall(installed: &Option<Installed>) -> Option<i32> {
    if PAYLOAD.is_some() {
        return None;
    }
    let args = args();
    // `_?=` comes last and unquoted, so a path with spaces arrives split over several args.
    let dir_arg = args.iter().position(|a| a.starts_with("_?=")).map(|i| args[i..].join(" "));
    let mut nsis_args: Vec<String> = args.iter().filter(|a| a.starts_with('/')).cloned().collect();
    nsis_args.extend(dir_arg);
    if nsis_args.is_empty() {
        return None;
    }
    let dir = installed.as_ref().map(|i| i.dir.clone()).or_else(|| {
        std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf))
    })?;
    let mut cmd = std::process::Command::new(dir.join("uninstall.exe"));
    for arg in &nsis_args {
        system::raw_arg(&mut cmd, arg);
    }
    Some(cmd.status().ok().and_then(|s| s.code()).unwrap_or(2))
}

/// Without WebView2 this window can't draw, so hand over to the stock NSIS wizard,
/// which installs WebView2 first.
fn fall_back_to_nsis(mode: Mode, installed: &Option<Installed>) -> bool {
    if system::webview2_present() {
        return false;
    }
    match (mode, PAYLOAD, installed) {
        (Mode::Uninstall, _, Some(i)) => std::process::Command::new(i.dir.join("uninstall.exe")).spawn().is_ok(),
        (Mode::Install | Mode::Update | Mode::Reinstall | Mode::Newer, Some(payload), _) => {
            let path = std::env::temp_dir().join(format!("WinFynd-{VERSION}-installer.exe"));
            std::fs::write(&path, payload).is_ok() && std::process::Command::new(&path).spawn().is_ok()
        }
        _ => false,
    }
}

fn main() {
    let installed = system::installed();
    if let Some(code) = pass_through_uninstall(&installed) {
        std::process::exit(code);
    }
    let mode = detect_mode(&installed);
    if mode == Mode::Uninstall && installed.as_ref().is_some_and(relaunch_from_temp) {
        return;
    }
    if fall_back_to_nsis(mode, &installed) {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(App { mode, installed, busy: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![get_state, choose_folder, install, uninstall, launch_app])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Stopping halfway would leave a broken install.
                if window.state::<App>().busy.load(Ordering::SeqCst) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while starting WinFynd Setup")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                schedule_self_delete();
            }
        });
}
