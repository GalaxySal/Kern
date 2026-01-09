use std::process::Command;
use tauri::command;

#[command]
pub fn get_os_type() -> String {
    tauri_plugin_os::platform().to_string()
}

#[command]
pub fn get_os_version() -> String {
    tauri_plugin_os::version().to_string()
}

#[command]
pub fn get_arch() -> String {
    tauri_plugin_os::arch().to_string()
}

#[command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[command]
pub fn get_webview_version() -> String {
    #[cfg(target_os = "linux")]
    {
        // Try to get WebKitGTK version via pkg-config
        let version_opt = Command::new("pkg-config")
            .args(["--modversion", "webkit2gtk-4.1"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok());

        if let Some(v) = version_opt {
            return format!("WebKitGTK {}", v.trim());
        }
    }

    // Fallback for other platforms
    format!("Native WebView ({})", tauri_plugin_os::platform())
}
