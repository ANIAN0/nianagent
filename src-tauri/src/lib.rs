mod boot;
mod desktop_commands;
mod desktop_contract_generated;
mod desktop_runtime;
mod managed_child;
mod migration;
mod models;
mod native_directory;
mod native_files;
mod profile;
mod startup;
mod storage;
mod window_lifecycle;
mod windows_guard;
pub use managed_child::entry as managed_child_entry;
use tauri::{Manager, RunEvent};
pub use window_lifecycle::report_host_error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    if startup::handoff_entry()? {
        return Ok(());
    }
    if migration::maintenance_entry()? {
        return Ok(());
    }
    // 已有实例/维护屏障在创建任何profile、数据锁或后端之前接收通知。
    if windows_guard::notify_existing() {
        return Ok(());
    }
    let startup_gate = startup::StartupGate::inspect()?;
    let paths = if startup_gate.is_none() {
        Some(storage::StoragePaths::initialize()?)
    } else {
        None
    };
    let mut context = tauri::generate_context!();
    let windows = if let Some(gate) = &startup_gate {
        vec![gate.configure(&mut context)]
    } else {
        paths
            .as_ref()
            .ok_or("正常存储根缺失。")?
            .configure(&mut context)
    };
    let mut builder = tauri::Builder::default();
    if startup_gate.is_none()
        && option_env!("MOON_UPDATER_PUBLIC_KEY").is_some_and(|key| !key.trim().is_empty())
    {
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
            native_files::file_editors,
            native_files::file_choose_editor,
            native_files::file_open,
            native_files::file_export,
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
            desktop_commands::update_install,
            desktop_commands::startup_get_state,
            desktop_commands::startup_choose_directory,
            desktop_commands::startup_prepare_migration,
            desktop_commands::startup_start_migration,
            desktop_commands::startup_prepare_fresh,
            desktop_commands::startup_start_fresh,
            desktop_commands::startup_retry_migration,
            desktop_commands::startup_open_diagnostics,
            desktop_commands::startup_continue,
            desktop_commands::startup_exit,
            boot::boot_get_state,
            boot::boot_retry,
            boot::boot_acknowledge_frontend,
            boot::boot_exit
        ]);
    let is_startup = startup_gate.is_some();
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(move |invoke| {
            let name = invoke.message.command();
            let startup_command = matches!(
                name,
                "startup_get_state"
                    | "startup_choose_directory"
                    | "startup_prepare_migration"
                    | "startup_start_migration"
                    | "startup_prepare_fresh"
                    | "startup_start_fresh"
                    | "startup_retry_migration"
                    | "startup_open_diagnostics"
                    | "startup_continue"
                    | "startup_exit"
            );
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
            // URL仅决定前端页面；实际能力由宿主模式与请求窗口身份授权，首启不能调用业务接口。
            let ready = matches!(
                name,
                "startup_get_state" | "startup_exit" | "startup_open_diagnostics"
            ) || invoke
                .message
                .webview_ref()
                .app_handle()
                .try_state::<std::sync::Arc<startup::StartupGate>>()
                .is_some_and(|gate| gate.profile_verified());
            let allowed = if is_startup {
                label == "startup" && startup_command && ready
            } else {
                label == "main"
                    && (!startup_command || name == "startup_get_state")
                    && (backend_ready || boot_command || name == "startup_get_state")
            };
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
                if let Some(gate) = &startup_gate {
                    app.manage(gate.clone());
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Info)
                            .targets([tauri_plugin_log::Target::new(
                                tauri_plugin_log::TargetKind::Folder {
                                    path: gate.control.join("startup/logs"),
                                    file_name: Some("moon-startup".into()),
                                },
                            )])
                            .build(),
                    )?;
                    for window in &windows {
                        tauri::WebviewWindowBuilder::from_config(app.handle(), window)?
                            .data_directory(gate.profile.clone())
                            .build()?;
                    }
                    profile::verify_directory(app.handle(), "startup", &gate.profile)
                        .map_err(std::io::Error::other)?;
                    gate.activate(app.handle());
                    let window = app
                        .get_webview_window("startup")
                        .ok_or("Moon首启窗口不存在。")?;
                    let gate = gate.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            if !gate.snapshot().capabilities.exit {
                                api.prevent_close();
                            }
                        }
                    });
                    return Ok(());
                }
                let paths = paths.as_ref().ok_or("正常存储根缺失。")?;
                {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Info)
                            .targets([tauri_plugin_log::Target::new(
                                tauri_plugin_log::TargetKind::Folder {
                                    path: paths.data.join("logs"),
                                    file_name: Some("moon".into()),
                                },
                            )])
                            .build(),
                    )?;
                }
                // 状态及未启Node的稳定服务对象先受管理，窗口能在耗时启动期间读取真实阶段与退出。
                let boot = boot::BootRuntime::new(paths.clone());
                app.manage(boot.clone());
                app.manage(models::ModelBackend::new(app.handle(), paths)?);
                // 沿用正式 WindowConfig 的 URL、尺寸和窗口行为，仅显式绑定已核验的数据根。
                // 所有自动窗口已禁用，创建完成并确认实际 WebView2 环境后才能启动 Node。
                for window in &windows {
                    tauri::WebviewWindowBuilder::from_config(app.handle(), window)?
                        .data_directory(paths.data.join("webview"))
                        .build()?;
                }
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
        if let RunEvent::ExitRequested { api, code, .. } = &event {
            if app
                .try_state::<std::sync::Arc<startup::StartupGate>>()
                .is_some_and(|gate| {
                    !gate.snapshot().capabilities.exit
                        && !(code == &Some(0) && gate.controlled_handoff_exit())
                })
            {
                api.prevent_exit();
            }
        }
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
