mod models;
mod window_lifecycle;
use tauri::{Manager, RunEvent};
pub use window_lifecycle::report_host_error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    let builder = tauri::Builder::default();
    // This plugin must run before setup can create a second backend.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Err(error) = window_lifecycle::show_main(app) {
            report_host_error(&error);
        }
    }));
    let app = builder
        .invoke_handler(tauri::generate_handler![
            models::model_request,
            models::cancel_model_request,
            models::open_authorization_url
        ])
        .setup(|app| {
            // Tauri executes setup from Ready and panics on Err; it is not part
            // of Builder::build's Result. Handle failures before leaving setup.
            let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                if cfg!(debug_assertions) {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Info)
                            .build(),
                    )?;
                }
                app.manage(models::ModelBackend::new(app)?);
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
        .build(tauri::generate_context!())
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
