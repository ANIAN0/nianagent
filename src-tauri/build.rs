use base64::{Engine, engine::general_purpose::STANDARD};

fn main() {
    // 公钥变化必须使编译期配置重新生成，避免复用前一次发行的密钥。
    println!("cargo:rerun-if-env-changed=MOON_UPDATER_PUBLIC_KEY");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let valid = std::env::var("MOON_UPDATER_PUBLIC_KEY")
            .ok()
            .and_then(|value| STANDARD.decode(value.trim()).ok())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|value| minisign_verify::PublicKey::decode(&value).ok())
            .is_some();
        if !valid {
            panic!("正式发行构建缺少有效 MOON_UPDATER_PUBLIC_KEY，请使用 pnpm desktop:build");
        }
    }
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
