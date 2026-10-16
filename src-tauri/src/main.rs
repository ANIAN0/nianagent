// A desktop launch must not create a console in either development or release.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    if let Some(result) = app_lib::managed_child_entry() {
        return match result {
            Ok(code) => std::process::ExitCode::from(code.clamp(0, 255) as u8),
            Err(error) => {
                eprintln!("{error}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    if let Err(error) = app_lib::run() {
        app_lib::report_host_error(&error);
        return std::process::ExitCode::FAILURE;
    }
    std::process::ExitCode::SUCCESS
}
