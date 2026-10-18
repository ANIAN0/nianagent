use tauri::{
    AppHandle, Manager, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn report_host_error(message: &str) {
    log::error!("Moon: {message}");
    if let Err(error) = write_early_host_error(message) {
        eprintln!("Moon: {message}\n早期日志未能保存：{error}");
    }
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

fn write_early_host_error(message: &str) -> Result<(), String> {
    use std::{fs, io::Write, path::PathBuf};
    let base = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("开发项目目录无效。")?
            .join(".dev/moon")
    } else {
        std::env::current_exe()
            .map_err(|_| "程序路径不可读。")?
            .parent()
            .ok_or("程序目录无效。")?
            .to_path_buf()
    };
    let directory = base.join(".moon-control/startup/logs");
    crate::storage::reject_links(&directory)?;
    fs::create_dir_all(&directory).map_err(|_| "控制日志目录不可写。")?;
    crate::storage::reject_links(&directory)?;
    let canonical_base = dunce::canonicalize(&base).map_err(|_| "日志根目录不可读。")?;
    let canonical_directory = dunce::canonicalize(&directory).map_err(|_| "日志目录不可读。")?;
    if canonical_directory != canonical_base.join(".moon-control/startup/logs") {
        return Err("日志目录超出当前控制目录。".into());
    }
    let file = directory.join(format!("moon-host-error-{}.log", uuid::Uuid::new_v4()));
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)
        .map_err(|_| "早期日志文件不可写。")?;
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    writeln!(
        output,
        "{timestamp} Moon {} PID {}: {}",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        message.replace('\0', "")
    )
    .and_then(|_| output.sync_all())
    .map_err(|_| "早期日志未能落盘。".into())
}

pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("startup"))
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

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.tray_by_id("moon-tray").is_some() {
        return Ok(());
    }
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
    Ok(())
}

/// 启动期关闭真正退出，只有实际ready后才隐藏到托盘；不能注册两套互相冲突的关闭回调。
pub fn setup_boot(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Moon 主窗口不存在。")?;
    let close_window = window.clone();
    let app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if app
                .try_state::<std::sync::Arc<crate::boot::BootRuntime>>()
                .is_some_and(|boot| boot.ready())
            {
                if close_window.hide().is_err() {
                    report_host_error("无法隐藏Moon到托盘，请通过菜单退出。");
                }
            } else {
                app.exit(0);
            }
        }
    });
    Ok(())
}
