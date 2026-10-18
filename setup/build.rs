fn main() {
    if std::env::var_os("CARGO_FEATURE_PAYLOAD").is_some() {
        let payload = std::env::var("WINFYND_PAYLOAD")
            .expect("set WINFYND_PAYLOAD to the NSIS installer (see scripts/build-installer.mjs)");
        println!("cargo:rerun-if-changed={payload}");
        println!("cargo:rustc-env=WINFYND_PAYLOAD={payload}");
    }
    println!("cargo:rerun-if-env-changed=WINFYND_PAYLOAD");
    tauri_build::build()
}
