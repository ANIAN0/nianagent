fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri supplies the application manifest, but Cargo's unit-test
        // executables do not inherit it. Native dialogs import TaskDialogIndirect,
        // which requires Common Controls v6 before the test harness can start.
        // Embed it for the library/test targets. The app binary already receives
        // Tauri's resource manifest, so it must not generate a duplicate resource.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
        println!("cargo:rustc-link-arg-bin=app=/MANIFEST:NO");
    }
}
