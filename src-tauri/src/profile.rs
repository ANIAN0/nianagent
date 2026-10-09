use crate::storage::{self, StoragePaths};
use tauri::{App, Manager};

/// 必须读取WebView2实际环境；仅检查Tauri配置不能证明策略或环境覆盖没有生效。
#[cfg(windows)]
pub fn verify(app: &App, paths: &StoragePaths) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment7;
    use windows_core::{Interface, PWSTR};
    let expected = paths.data.join("webview");
    let (sender, receiver) = std::sync::mpsc::channel();
    let window = app
        .get_webview_window("main")
        .ok_or("Moon主窗口不存在，无法核验profile。")?;
    window
        .with_webview(move |webview| {
            let result = (|| -> Result<(), String> {
                let environment: ICoreWebView2Environment7 = webview
                    .environment()
                    .cast()
                    .map_err(|_| "当前WebView2不能报告实际数据目录，请更新WebView2后重试。")?;
                let mut folder = PWSTR::null();
                unsafe {
                    environment
                        .UserDataFolder(&mut folder)
                        .map_err(|_| "无法读取WebView2实际数据目录。")?;
                }
                if folder.is_null() {
                    return Err("WebView2实际数据目录为空。".into());
                }
                let value = unsafe { folder.to_string() };
                unsafe {
                    windows_sys::Win32::System::Com::CoTaskMemFree(folder.0.cast());
                }
                let actual =
                    std::path::PathBuf::from(value.map_err(|_| "WebView2实际数据目录编码异常。")?);
                storage::reject_links(&actual)?;
                let expected =
                    dunce::canonicalize(expected).map_err(|_| "预期profile目录不存在。")?;
                let actual = dunce::canonicalize(actual).map_err(|_| "实际profile目录不存在。")?;
                if !storage::text(&expected).eq_ignore_ascii_case(&storage::text(&actual)) {
                    return Err(
                        "WebView2实际profile与Moon数据根不同，已停止启动，避免写入其他目录。"
                            .into(),
                    );
                }
                log::info!(
                    "已核验WebView2实际UserDataFolder：{}",
                    storage::text(&actual)
                );
                Ok(())
            })();
            let _ = sender.send(result);
        })
        .map_err(|_| "无法访问WebView2实际环境。")?;
    // Tauri当前主线程with_webview同步执行；无法取得结果同样停止，不猜测配置已生效。
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "WebView2实际数据目录核验超时，已停止启动。")?
}
#[cfg(not(windows))]
pub fn verify(_app: &App, _paths: &StoragePaths) -> Result<(), String> {
    Ok(())
}
