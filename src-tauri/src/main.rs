// A desktop launch must not create a console in either development or release.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    if let Err(error) = app_lib::run() {
        app_lib::report_host_error(&error);
        return std::process::ExitCode::FAILURE;
    }
    std::process::ExitCode::SUCCESS
}
