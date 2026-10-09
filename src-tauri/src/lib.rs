mod desktop_commands;
mod desktop_contract_generated;
mod desktop_runtime;
mod migration;
mod models;
mod native_directory;
mod profile;
mod storage;
mod window_lifecycle;
mod windows_guard;
use tauri::{Manager, RunEvent};
pub use window_lifecycle::report_host_error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    if migration::maintenance_entry()? {
        return Ok(());
    }
    // 已有实例/维护屏障在创建任何profile、数据锁或后端之前接收通知。
    if windows_guard::notify_existing() {
        return Ok(());
    }
    let paths = storage::StoragePaths::initialize()?;
    let mut context = tauri::generate_context!();
    let windows = paths.configure(&mut context);
    let mut builder = tauri::Builder::default();
    if option_env!("MOON_UPDATER_PUBLIC_KEY").is_some_and(|key| !key.trim().is_empty()) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    // This plugin must run before setup can create a second backend.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Err(error) = window_lifecycle::show_main(app) {
            report_host_error(&error);
        }
    }));
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            models::model_request,
            models::cancel_model_request,
            models::open_authorization_url,
            desktop_commands::desktop_get_state,
            desktop_commands::desktop_open_data_directory,
            desktop_commands::desktop_open_retained_copy,
            desktop_commands::desktop_choose_data_directory,
            desktop_commands::storage_prepare_migration,
            desktop_commands::storage_start_migration,
            desktop_commands::desktop_acknowledge_flush,
            desktop_commands::desktop_acknowledge_startup,
            desktop_commands::desktop_restart,
            desktop_commands::update_check,
            desktop_commands::update_download,
            desktop_commands::update_cancel,
            desktop_commands::update_set_preferences,
            desktop_commands::update_install
        ])
        .setup(move |app| {
            // Tauri executes setup from Ready and panics on Err; it is not part
            // of Builder::build's Result. Handle failures before leaving setup.
            let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Info)
                            .targets([tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder { path: paths.data.join("logs"), file_name: Some("moon".into()) })])
                            .build(),
                    )?;
                }
                // 沿用正式 WindowConfig 的 URL、尺寸和窗口行为，仅显式绑定已核验的数据根。
                // 所有自动窗口已禁用，创建完成并确认实际 WebView2 环境后才能启动 Node。
                for window in &windows {
                    tauri::WebviewWindowBuilder::from_config(app.handle(), window)?
                        .data_directory(paths.data.join("webview"))
                        .build()?;
                }
                profile::verify(app, &paths).map_err(std::io::Error::other)?;
                let backend = models::ModelBackend::new(app, &paths)?;
                let readable = backend.internal("$validateStorage", serde_json::json!({}), std::time::Duration::from_secs(60)).is_ok_and(|value| value["readable"] == true);
                storage::atomic_json(&paths.data.join("maintenance/startup.json"), &serde_json::json!({"dataSetId":paths.marker.data_set_id,"generation":paths.bootstrap.generation,"version":env!("CARGO_PKG_VERSION"),"profileVerified":cfg!(windows),"profileDirectory":storage::text(&paths.data.join("webview")),"backendReadable":readable,"frontendReady":false})).map_err(std::io::Error::other)?;
                app.manage(backend);
                app.manage(desktop_runtime::DesktopRuntime::new(paths.clone(), readable));
                window_lifecycle::setup(app.handle())?;
                Ok(())
            })();
            if let Err(error) = result {
                if let Some(backend) = app.try_state::<models::ModelBackend>() {
                    backend.shutdown();
                }
                report_host_error(&format!("无法启动 Moon：{error}"));
                app.handle().exit(1);
            }
            Ok(())
        })
        .build(context)
        .map_err(|error| format!("无法启动 Moon：{error}"))?;
    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(backend) = app.try_state::<models::ModelBackend>() {
                backend.shutdown();
            }
        }
    });
    Ok(())
}
