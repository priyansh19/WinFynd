mod commands;
mod engine;
mod hotkeys;
mod windows;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

use hotkeys::HotkeyState;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::handle)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(HotkeyState::default())
        .invoke_handler(tauri::generate_handler![
            hotkeys::get_hotkeys,
            hotkeys::set_hotkey,
            hotkeys::set_voice_options,
            hotkeys::suspend_hotkeys,
            windows::hide_launcher_cmd,
            windows::open_control_center,
            commands::search,
            commands::ask,
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
        ])
        .setup(|app| {
            let handle = app.handle();

            let config = hotkeys::load(handle);
            hotkeys::register_all(handle, &config);
            *app.state::<HotkeyState>().config.lock().unwrap() = config;

            let engine = engine::Engine::start(handle)?;
            app.manage(engine);

            let open = MenuItem::with_id(app, "open", "Open WinFynd", true, None::<&str>)?;
            let control = MenuItem::with_id(app, "control", "Control Center", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit WinFynd", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &control, &sep, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("WinFynd")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => windows::show_launcher(app),
                    "control" => windows::show_control_center(app),
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

            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // The launcher behaves like a popup: it goes away when you click elsewhere.
            ("launcher", WindowEvent::Focused(false)) => {
                let _ = window.hide();
            }
            // Closing the Control Center keeps WinFynd running in the tray.
            ("control", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running WinFynd");
}
