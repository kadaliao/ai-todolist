//! Native menus in the system language. Same items as Tauri's default menu (plus "Show All"),
//! with titles that match what macOS uses in its own apps.

use tauri::{
    menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    },
    AppHandle, Runtime,
};

pub struct Strings {
    pub about: &'static str,
    pub services: &'static str,
    pub hide: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub quit: &'static str,
    pub file: &'static str,
    pub close_window: &'static str,
    pub edit: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub view: &'static str,
    pub fullscreen: &'static str,
    pub window: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub help: &'static str,
    // Menu-bar (tray) menu
    pub quick_add: &'static str,
    pub show_docket: &'static str,
}

const ZH: Strings = Strings {
    about: "关于 Docket",
    services: "服务",
    hide: "隐藏 Docket",
    hide_others: "隐藏其他",
    show_all: "全部显示",
    quit: "退出 Docket",
    file: "文件",
    close_window: "关闭窗口",
    edit: "编辑",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "拷贝",
    paste: "粘贴",
    select_all: "全选",
    view: "显示",
    fullscreen: "进入全屏幕",
    window: "窗口",
    minimize: "最小化",
    zoom: "缩放",
    help: "帮助",
    quick_add: "快速添加…",
    show_docket: "显示 Docket",
};

const EN: Strings = Strings {
    about: "About Docket",
    services: "Services",
    hide: "Hide Docket",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit Docket",
    file: "File",
    close_window: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    view: "View",
    fullscreen: "Enter Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    help: "Help",
    quick_add: "Quick Add…",
    show_docket: "Show Docket",
};

/// Strings for the system's preferred language (Chinese for any zh locale, English otherwise).
pub fn strings() -> &'static Strings {
    let zh = sys_locale::get_locale()
        .map(|l| l.to_lowercase().starts_with("zh"))
        .unwrap_or(false);
    if zh {
        &ZH
    } else {
        &EN
    }
}

pub fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let s = strings();
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        ..Default::default()
    };
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, Some(s.about), Some(about))?,
            &sep()?,
            &PredefinedMenuItem::services(app, Some(s.services))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some(s.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(s.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(s.show_all))?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some(s.quit))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        s.file,
        true,
        &[&PredefinedMenuItem::close_window(
            app,
            Some(s.close_window),
        )?],
    )?;
    let edit = Submenu::with_items(
        app,
        s.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(s.undo))?,
            &PredefinedMenuItem::redo(app, Some(s.redo))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(s.cut))?,
            &PredefinedMenuItem::copy(app, Some(s.copy))?,
            &PredefinedMenuItem::paste(app, Some(s.paste))?,
            &PredefinedMenuItem::select_all(app, Some(s.select_all))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        s.view,
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some(s.fullscreen))?],
    )?;
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        s.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(s.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(s.zoom))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, Some(s.close_window))?,
        ],
    )?;
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, s.help, true, &[])?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

/// The menu-bar icon's menu.
pub fn tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let s = strings();
    let quick = MenuItem::with_id(
        app,
        "quick",
        s.quick_add,
        true,
        Some("CmdOrCtrl+Shift+Space"),
    )?;
    let show = MenuItem::with_id(app, "show", s.show_docket, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", s.quit, true, Some("CmdOrCtrl+Q"))?;
    Menu::with_items(
        app,
        &[&quick, &show, &PredefinedMenuItem::separator(app)?, &quit],
    )
}
