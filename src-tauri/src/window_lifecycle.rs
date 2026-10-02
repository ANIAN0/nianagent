use tauri::{
    AppHandle, Manager, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn report_host_error(message: &str) {
    log::error!("Moon: {message}");
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let title: Vec<u16> = "Moon".encode_utf16().chain(Some(0)).collect();
        let text: Vec<u16> = message
            .replace('\0', "")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // The UTF-16 buffers are terminated and remain alive for the synchronous dialog.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    eprintln!("Moon: {message}");
}

pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Moon 主窗口不存在。")?;
    window
        .unminimize()
        .map_err(|error| format!("无法恢复 Moon：{error}"))?;
    window
        .show()
        .map_err(|error| format!("无法显示 Moon：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦 Moon：{error}"))?;
    Ok(())
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "打开 Moon", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Moon", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Moon 应用图标缺失。")?;
    // Create the recovery entry before intercepting CloseRequested.
    TrayIconBuilder::with_id("moon-tray")
        .tooltip("Moon")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Err(error) = show_main(app) {
                    report_host_error(&error);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = show_main(tray.app_handle()) {
                    report_host_error(&error);
                }
            }
        })
        .build(app)?;
    let window = app
        .get_webview_window("main")
        .ok_or("Moon 主窗口不存在。")?;
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = close_window.hide() {
                report_host_error(&format!("无法隐藏 Moon 到托盘：{error}"));
            }
        }
    });
    Ok(())
}
