/// Open only Moon's fixed development pages. OAuth's HTTPS-only opener is separate.
#[tauri::command]
pub fn open_developer_tools(window: tauri::WebviewWindow, tool: String) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = (window, tool);
        Err("开发工具仅在 dev 模式可用。".into())
    }
    #[cfg(debug_assertions)]
    {
        use std::process::Command;
        use tauri::Manager;
        if !matches!(tool.as_str(), "project" | "components" | "api") {
            return Err("开发工具标识无效。".into());
        }
        let config = window.app_handle().config();
        let source = config.build.dev_url.as_ref().ok_or("开发来源未配置。")?;
        let current = window.url().map_err(|_| "无法核对开发窗口来源。")?;
        if window.label() != "main"
            || !matches!(source.scheme(), "http" | "https")
            || !matches!(source.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
            || current.origin() != source.origin()
        {
            return Err("当前窗口不是可信 Moon 开发来源。".into());
        }
        let path = match tool.as_str() {
            "project" => "/project/",
            "components" => "/ui-catalog/",
            "api" => "/api-catalog/",
            _ => unreachable!(),
        };
        let mut target = source.join(path).map_err(|_| "开发工具地址无效。")?;
        target.set_query(None);
        target.set_fragment(None);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            Command::new("rundll32.exe")
                .args(["url.dll,FileProtocolHandler", target.as_str()])
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|_| "无法打开浏览器。")?;
        }
        #[cfg(target_os = "macos")]
        Command::new("open")
            .arg(target.as_str())
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
        #[cfg(all(unix, not(target_os = "macos")))]
        Command::new("xdg-open")
            .arg(target.as_str())
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
        Ok(())
    }
}
