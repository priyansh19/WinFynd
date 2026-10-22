mod commands;
mod diag;
mod engine;
mod hotkeys;
mod native;
mod onboarding;
mod startup;
mod stats;
mod windows;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

use hotkeys::HotkeyState;

pub fn run() {
    tauri::Builder::default()
        // Opening WinFynd while it already runs in the tray (Start menu,
        // desktop shortcut) shows the running copy instead of starting a
        // second one with its own tray icon, hotkeys and indexer. It goes
        // first so the second copy exits before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !onboarding::is_complete(app) {
                onboarding::show(app);
            } else if !args.iter().any(|arg| arg == "--background") {
                windows::show_launcher(app);
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::handle)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(HotkeyState::default())
        .invoke_handler(tauri::generate_handler![
            hotkeys::get_hotkeys,
            hotkeys::set_hotkey,
            hotkeys::set_voice_options,
            hotkeys::suspend_hotkeys,
            windows::hide_launcher_cmd,
            windows::open_control_center,
            native::appearance,
            native::shell_image,
            native::online_only,
            commands::search,
            commands::ask,
            commands::transcribe_voice,
            commands::open_link,
            commands::latest_release,
            commands::run_setup,
            commands::engine_status,
            commands::get_engine_config,
            commands::set_engine_config,
            commands::rescan,
            commands::list_models,
            commands::pull_model,
            commands::media_support,
            commands::download_speech_model,
            commands::open_path,
            commands::reveal_path,
            onboarding::finish_onboarding,
            onboarding::open_ollama_download,
            onboarding::try_launcher,
            onboarding::watch_first_index,
            stats::index_stats,
            stats::estimate_folders,
            stats::list_drives,
            stats::ollama_info,
            stats::pause_indexing,
            stats::delete_index,
            startup::start_with_windows,
            startup::set_start_with_windows,
        ])
        .setup(|app| {
            let handle = app.handle();
            native::apply(handle);

            let config = hotkeys::load(handle);
            hotkeys::register_all(handle, &config);
            *app.state::<HotkeyState>().config.lock().unwrap() = config;

            if let Ok(dir) = handle.path().app_log_dir() {
                diag::init(&dir);
            }

            let engine = engine::Engine::start(handle)?;
            // The search model setup picked, run by WinFynd itself, isn't on
            // this PC yet (an update from a version that ran it in Ollama, or
            // a download that was cut off): fetch it now so indexing finishes
            // without anyone opening Settings.
            let cfg = engine.config();
            if onboarding::is_complete(handle)
                && cfg.builtin()
                && engine.local_model().is_some_and(|m| m.has_runtime() && !m.is_installed(&cfg.embed_model))
            {
                let _ = commands::download_search_model(handle.clone(), engine.clone(), cfg.embed_model);
            }
            let watched = Arc::downgrade(&engine);
            app.manage(engine);
            // If the windows ever stop answering, the log says what the
            // indexer was doing at the time.
            diag::watch_main_thread(handle.clone(), move || match watched.upgrade() {
                Some(e) => {
                    let s = e.status();
                    format!("index {}, {} queued, at {}", s.state, s.queued, s.current.unwrap_or_default())
                }
                None => "shutting down".into(),
            });

            let open = MenuItem::with_id(app, "open", "Open WinFynd", true, None::<&str>)?;
            let control = MenuItem::with_id(app, "control", "Settings", true, None::<&str>)?;
            let setup = MenuItem::with_id(app, "setup", "Run setup again", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit WinFynd", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &control, &setup, &sep, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("WinFynd")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => windows::show_launcher(app),
                    "control" => windows::show_control_center(app),
                    "setup" => onboarding::show(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        windows::toggle_launcher(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Started at sign-in (setup adds --background to the Run key): stay
            // in the tray, unless first-run setup still needs finishing.
            let background = std::env::args().any(|arg| arg == "--background");
            if !background || !onboarding::is_complete(handle) {
                onboarding::show_first_window(handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // The launcher behaves like a popup: it goes away when you click elsewhere.
            ("launcher", WindowEvent::Focused(false)) => {
                let _ = window.hide();
            }
            // Closing Settings or setup keeps WinFynd running in the tray. The
            // window itself goes, so the tray process stays small; it's built
            // again when it's next opened. Setup closed early shows again at
            // the next launch.
            // Light/dark switches also change the accent shades the page uses.
            (_, WindowEvent::ThemeChanged(_)) => native::theme_changed(window),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running WinFynd");
}
