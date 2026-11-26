mod boot;
mod desktop_commands;
mod desktop_contract_generated;
mod desktop_runtime;
mod diagnostics;
mod managed_child;
mod migration;
mod models;
mod native_directory;
mod native_files;
mod profile;
#[cfg(windows)]
mod selection_translate;
mod storage;
#[cfg(windows)]
mod translation_text;
mod updater;
mod window_lifecycle;
mod windows_guard;
pub use managed_child::entry as managed_child_entry;
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
    let storage_started = std::time::Instant::now();
    let mut storage_steps = Vec::new();
    let paths = storage::StoragePaths::initialize(|event, duration_ms| {
        storage_steps.push((event, duration_ms));
    })?;
    let storage_init_ms = storage_started.elapsed().as_millis();
    let mut context = tauri::generate_context!();
    let windows = paths.configure(&mut context);
    let mut builder = tauri::Builder::default();
    if option_env!("MOON_UPDATER_PUBLIC_KEY").is_some_and(|key| !key.trim().is_empty()) {
        // updater先反序列化插件配置；dev --release也使用同一编译期公钥，不能依赖发行overlay已存在。
        if let Some(key) = option_env!("MOON_UPDATER_PUBLIC_KEY") {
            context
                .config_mut()
                .plugins
                .0
                .entry("updater".into())
                .or_insert_with(|| serde_json::json!({}))["pubkey"] = serde_json::json!(key);
        }
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    // This plugin must run before setup can create a second backend.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Err(error) = window_lifecycle::show_main(app) {
            report_host_error(&error);
        }
    }));
    let commands: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            models::model_request,
            models::cancel_model_request,
            models::open_authorization_url,
            models::open_local_url,
            native_files::file_editors,
            native_files::file_choose_editor,
            native_files::file_open,
            native_files::file_export,
            desktop_commands::desktop_get_state,
            desktop_commands::storage_measure_capacity,
            desktop_commands::desktop_open_data_directory,
            desktop_commands::desktop_open_log_directory,
            desktop_commands::desktop_export_diagnostics,
            desktop_commands::desktop_open_retained_copy,
            desktop_commands::desktop_choose_data_directory,
            desktop_commands::storage_prepare_migration,
            desktop_commands::storage_start_migration,
            desktop_commands::storage_detect_legacy_sources,
            desktop_commands::storage_prepare_import,
            desktop_commands::desktop_acknowledge_flush,
            desktop_commands::desktop_acknowledge_startup,
            desktop_commands::desktop_restart,
            desktop_commands::update_check,
            desktop_commands::update_download,
            desktop_commands::update_cancel,
            desktop_commands::update_set_preferences,
            desktop_commands::update_install,
            desktop_commands::update_dismiss_error,
            desktop_commands::update_acknowledge_updated,
            boot::boot_get_state,
            boot::boot_retry,
            boot::boot_acknowledge_frontend,
            boot::boot_exit
        ]);
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(move |invoke| {
            let name = invoke.message.command();
            let label = invoke.message.webview_ref().label();
            let backend_ready = invoke
                .message
                .webview_ref()
                .app_handle()
                .try_state::<std::sync::Arc<boot::BootRuntime>>()
                .is_some_and(|service| service.ready());
            let boot_command = matches!(
                name,
                "boot_get_state" | "boot_retry" | "boot_acknowledge_frontend" | "boot_exit"
            );
            let allowed = label == "main" && (backend_ready || boot_command);
            if !allowed {
                invoke.resolver.reject(desktop_runtime::issue(
                    desktop_contract_generated::IssueCode::Unavailable,
                    "当前窗口不能调用此原生能力。",
                    desktop_contract_generated::RecoveryAction::None,
                ));
                return true;
            }
            commands(invoke)
        })
        .setup(move |app| {
            // Tauri executes setup from Ready and panics on Err; it is not part
            // of Builder::build's Result. Handle failures before leaving setup.
            let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                {
                    app.handle()
                        .plugin(diagnostics::plugin(paths.data.join("logs")))?;
                }
                // 状态及未启Node的稳定服务对象先受管理，窗口能在耗时启动期间读取真实阶段与退出。
                let boot = boot::BootRuntime::new(paths.clone());
                let attempt_id = boot.snapshot().attempt_id;
                diagnostics::log_step(
                    "startup.storage_initialize",
                    &attempt_id,
                    storage_init_ms,
                    "committed",
                    "",
                    "",
                );
                for &(event, duration_ms) in &storage_steps {
                    diagnostics::log_step(event, &attempt_id, duration_ms, "committed", "", "");
                }
                app.manage(boot.clone());
                app.manage(models::ModelBackend::new(app.handle(), &paths)?);
                // 沿用正式 WindowConfig 的 URL、尺寸和窗口行为，仅显式绑定已核验的数据根。
                // 所有自动窗口已禁用，创建完成并确认实际 WebView2 环境后才能启动 Node。
                let window_started = std::time::Instant::now();
                for window in &windows {
                    tauri::WebviewWindowBuilder::from_config(app.handle(), window)?
                        .data_directory(paths.data.join("webview"))
                        .background_color(window_lifecycle::startup_background_color())
                        .build()?;
                }
                diagnostics::log_step(
                    "startup.window_build",
                    &attempt_id,
                    window_started.elapsed().as_millis(),
                    "committed",
                    "",
                    "",
                );
                window_lifecycle::setup_boot(app.handle()).map_err(std::io::Error::other)?;
                boot.start(app.handle());
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
            if let Some(boot) = app.try_state::<std::sync::Arc<boot::BootRuntime>>() {
                boot.terminate();
            }
            if let Some(backend) = app.try_state::<models::ModelBackend>() {
                backend.shutdown();
            }
        }
    });
    Ok(())
}
