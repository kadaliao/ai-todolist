//! Docket desktop shell: the web app in a native window, plus what a browser can't do —
//! a global quick-entry shortcut, a menu-bar icon, and staying alive for reminders.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn quick_shortcut() -> Shortcut {
    // ⌘⇧Space on macOS (Ctrl/⌘+Space usually switch input sources), Ctrl+Shift+Space elsewhere.
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::SHIFT;
    Shortcut::new(Some(mods), Code::Space)
}

fn toggle_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quick"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Err(e) = app.global_shortcut().register(quick_shortcut()) {
                eprintln!("could not register the quick-entry shortcut: {e}");
            }

            let quick = MenuItem::with_id(app, "quick", "快速添加… / Quick Add", true, Some("CmdOrCtrl+Shift+Space"))?;
            let show = MenuItem::with_id(app, "show", "显示 Docket / Show Docket", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 / Quit", true, Some("CmdOrCtrl+Q"))?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&quick, &show, &sep, &quit])?;
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("Docket")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick" => toggle_quick(app),
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the main window keeps Docket running in the menu bar so reminders still fire.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) if window.label() == "quick" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Docket");

    app.run(|app, event| {
        if let RunEvent::Reopen { .. } = event {
            show_main(app);
        }
    });
}
