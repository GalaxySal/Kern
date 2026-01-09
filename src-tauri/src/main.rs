#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // NVIDIA ve WebKit arasındaki barışı sağlayan diplomatik değişkenler
    // (Linux/NVIDIA sistemlerinde WebKitGTK uyumluluk düzeltmesi)
    // SAFETY: Program başlangıç anında tek thread çalışır, güvenlidir.
    unsafe {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_FORCE_SANDBOX", "0");
    }

    kern::run()
}
