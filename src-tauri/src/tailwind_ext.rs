// ============================================
// Kern Tailwind v4 IntelliSense Extension
// ID: com.kern.tailwind-v4
//
// Thin wrapper around kern_core::tailwind
// ============================================

use kern_core::tailwind::{
    TailwindCompletions, TailwindWatcher, get_default_utilities, scan_css_files,
};
use std::time::Duration;
use tauri::Emitter;

/// Scan project for Tailwind completions
#[tauri::command]
pub fn tailwind_scan_project(root: String) -> Result<TailwindCompletions, String> {
    let root_path = std::path::Path::new(&root);

    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root));
    }

    // Get custom @theme properties from CSS files
    let custom_properties = scan_css_files(root_path);

    // Get embedded Tailwind v4 utilities
    let utilities = get_default_utilities();

    Ok(TailwindCompletions {
        custom_properties,
        utilities,
        project_root: root,
    })
}

/// Start watching CSS files for changes
#[tauri::command]
pub fn tailwind_start_watcher(root: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    if TailwindWatcher::is_active() {
        return Ok(()); // Already watching
    }

    let watcher = TailwindWatcher::new(&root)?;
    let root_clone = root.clone();

    std::thread::spawn(move || {
        let rx = watcher.receiver;
        println!("Tailwind watcher started for: {}", root_clone);

        while TailwindWatcher::is_active() {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(result) => {
                    if let Ok(event) = result {
                        // Check if any changed file is CSS
                        let css_changed = event
                            .paths
                            .iter()
                            .any(|p| p.extension().is_some_and(|ext| ext == "css"));

                        if css_changed {
                            // Re-scan and emit updated completions
                            let root_path = std::path::Path::new(&root_clone);
                            let custom_properties = scan_css_files(root_path);
                            let utilities = get_default_utilities();

                            let completions = TailwindCompletions {
                                custom_properties,
                                utilities,
                                project_root: root_clone.clone(),
                            };

                            let _ = app_handle.emit("tailwind-completions-updated", completions);
                            println!("Tailwind completions updated");
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }

        TailwindWatcher::stop();
        println!("Tailwind watcher stopped");
    });

    Ok(())
}

/// Stop watching CSS files
#[tauri::command]
pub fn tailwind_stop_watcher() {
    TailwindWatcher::stop();
}
