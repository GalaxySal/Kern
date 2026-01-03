fn main() {
    // Disable WebKit sandbox warning
    println!("cargo:rustc-env=WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1");

    tauri_build::build()
}
