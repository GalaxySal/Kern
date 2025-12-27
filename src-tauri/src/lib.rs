use tauri::{State, Emitter};
use std::sync::{Arc, Mutex};
use kern_core::Document;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem, PtyPair};
use std::io::{Read, Write};
use std::thread;

mod extension_manager;
mod tailwind_ext;
mod ai_client;

pub struct AppState {
    pub document: Mutex<Option<Document>>,
    pub pty_writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    // Store PtyPair struct directly, wrapping in Option/Mutex
    // PtyPair contains Box<dyn MasterPty> and Box<dyn SlavePty>, which are Send.
    // So PtyPair itself is Send.
    pub pty_pair: Arc<Mutex<Option<PtyPair>>>, 
}

#[tauri::command]
fn open_file(path: String, state: State<AppState>) -> Result<String, String> {
    let doc = Document::from_path(&path).map_err(|e| e.to_string())?;
    let content = doc.to_string();
    
    let mut doc_guard = state.document.lock().map_err(|_| "Failed to lock state")?;
    *doc_guard = Some(doc);
    
    Ok(content)
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut entries = Vec::new();
    let read_path = if path.is_empty() { "." } else { &path };
    
    let read_result = std::fs::read_dir(read_path).map_err(|e| e.to_string())?;

    for entry in read_result {
        let entry = entry.map_err(|e| e.to_string())?;
        let path_buf = entry.path();
        let is_dir = path_buf.is_dir();
        let name = entry.file_name().to_string_lossy().to_string();
        let path_str = path_buf.to_string_lossy().to_string();

        entries.push(FileNode {
            name,
            path: path_str,
            is_dir,
            children: None,
        });
    }
    
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(entries)
}

#[tauri::command]
fn get_view_lines(start: usize, end: usize, state: State<AppState>) -> Result<Vec<String>, String> {
    let doc_guard = state.document.lock().map_err(|_| "Failed to lock state")?;
    if let Some(doc) = &*doc_guard {
        Ok(doc.get_lines(start, end))
    } else {
        Err("No document open".to_string())
    }
}

// --- Terminal Commands ---

#[tauri::command]
fn spawn_terminal(state: State<AppState>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let cmd = CommandBuilder::new("bash");
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Store writer
    {
        let mut writer_guard = state.pty_writer.lock().map_err(|_| "Failed to lock writer")?;
        *writer_guard = Some(writer);
    }

    // Store pair to keep it alive
    {
        let mut pair_guard = state.pty_pair.lock().map_err(|_| "Failed to lock pair")?;
        *pair_guard = Some(pair);
    }
    
    // Start reader thread
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("term-data", data);
                }
                Ok(_) => break, // EOF
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn write_to_terminal(data: String, state: State<AppState>) -> Result<(), String> {
    let mut writer_guard = state.pty_writer.lock().map_err(|_| "Failed to lock writer")?;
    if let Some(writer) = writer_guard.as_mut() {
        write!(writer, "{}", data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_terminal(rows: u16, cols: u16, state: State<AppState>) -> Result<(), String> {
    let pair_guard = state.pty_pair.lock().map_err(|_| "Failed to lock pair")?;
    if let Some(pair) = pair_guard.as_ref() {
        pair.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState { 
            document: Mutex::new(None),
            pty_writer: Arc::new(Mutex::new(None)),
            pty_pair: Arc::new(Mutex::new(None)), 
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            open_file,
            save_file,
            read_dir,
            get_view_lines,
            spawn_terminal,
            write_to_terminal,
            resize_terminal,
            get_git_branch,
            open_project,
            search_files,
            search_content,
            watch_project,
            unwatch_project,
            extension_manager::list_marketplace_extensions,
            extension_manager::list_installed_extensions,
            extension_manager::install_extension,
            extension_manager::uninstall_extension,
            tailwind_ext::tailwind_scan_project,
            tailwind_ext::tailwind_start_watcher,
            tailwind_ext::tailwind_stop_watcher,
            ai_client::stream_vibe_chat,
            ai_client::apply_code_change
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_git_branch(cwd: String) -> String {
    use std::process::Command;
    // Default to main/master if checking fails or not a git repo, or empty string.
    // User wants "functionality", so let's try to get the real one.
    let output = Command::new("git")
        .arg("branch")
        .arg("--show-current")
        .current_dir(&cwd)
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if stdout.is_empty() {
                "".to_string()
            } else {
                stdout
            }
        },
        Err(_) => "".to_string()
    }
}

// ============================================
// Phase 2: Advanced Features
// ============================================

use std::collections::HashMap;
use std::path::Path;

/// Project file tree node for JSON serialization
#[derive(serde::Serialize, Clone)]
struct ProjectNode {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<ProjectNode>,
}

/// Fast project scanner using ignore crate (respects .gitignore)
#[tauri::command]
fn open_project(root: String) -> Result<ProjectNode, String> {
    use ignore::WalkBuilder;
    
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root));
    }
    
    // Build walker with .gitignore support
    let walker = WalkBuilder::new(&root)
        .hidden(false)           // Show hidden files
        .ignore(true)            // Respect .gitignore
        .git_ignore(true)        // Respect .git/info/exclude
        .git_global(true)        // Respect global gitignore
        .git_exclude(true)       // Respect .git/info/exclude
        .max_depth(Some(20))     // Limit depth for safety
        .build();
    
    // Collect all entries into a flat list first
    let mut entries: Vec<(String, String, bool)> = Vec::new();
    
    for result in walker {
        if let Ok(entry) = result {
            let path = entry.path();
            let path_str = path.to_string_lossy().to_string();
            let name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());
            let is_dir = path.is_dir();
            
            // Skip root itself
            if path_str != root {
                entries.push((name, path_str, is_dir));
            }
        }
    }
    
    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        b.2.cmp(&a.2).then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))
    });
    
    // Build tree structure
    let root_name = root_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());
    
    let mut tree = ProjectNode {
        name: root_name,
        path: root.clone(),
        is_dir: true,
        children: Vec::new(),
    };
    
    // Use HashMap to build parent-child relationships
    let mut node_map: HashMap<String, Vec<ProjectNode>> = HashMap::new();
    
    for (name, path, is_dir) in entries.iter().rev() {
        let parent = Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        
        let children = node_map.remove(path).unwrap_or_default();
        
        let node = ProjectNode {
            name: name.clone(),
            path: path.clone(),
            is_dir: *is_dir,
            children,
        };
        
        node_map.entry(parent).or_insert_with(Vec::new).push(node);
    }
    
    // Get root children and sort them
    if let Some(mut children) = node_map.remove(&root) {
        children.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        tree.children = children;
    }
    
    Ok(tree)
}

/// Fuzzy file name search across project
#[tauri::command]
fn search_files(query: String, root: String, limit: usize) -> Vec<(String, String, i64)> {
    use fuzzy_matcher::FuzzyMatcher;
    use fuzzy_matcher::skim::SkimMatcherV2;
    use ignore::WalkBuilder;
    
    let matcher = SkimMatcherV2::default();
    let mut results: Vec<(String, String, i64)> = Vec::new();
    
    let walker = WalkBuilder::new(&root)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .build();
    
    for result in walker {
        if let Ok(entry) = result {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                
                if let Some(score) = matcher.fuzzy_match(&name, &query) {
                    let path_str = path.to_string_lossy().to_string();
                    results.push((name, path_str, score));
                }
            }
        }
    }
    
    // Sort by score descending
    results.sort_by(|a, b| b.2.cmp(&a.2));
    
    // Limit results
    results.truncate(limit.min(100));
    
    results
}

/// Content search result
#[derive(serde::Serialize)]
struct ContentMatch {
    path: String,
    line_number: usize,
    line_content: String,
}

/// Search file contents (grep-style)
#[tauri::command]
fn search_content(query: String, root: String, limit: usize) -> Vec<ContentMatch> {
    use ignore::WalkBuilder;
    use std::fs::File;
    use std::io::{BufRead, BufReader};
    
    let mut results: Vec<ContentMatch> = Vec::new();
    let query_lower = query.to_lowercase();
    
    let walker = WalkBuilder::new(&root)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .build();
    
    'outer: for entry_result in walker {
        if let Ok(entry) = entry_result {
            let path = entry.path();
            if path.is_file() {
                // Skip binary files (simple check by extension)
                let ext = path.extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                
                let skip_exts = ["png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "pdf", "zip", "tar", "gz", "exe", "dll", "so", "dylib", "node"];
                if skip_exts.contains(&ext.as_str()) {
                    continue;
                }
                
                if let Ok(file) = File::open(path) {
                    let reader = BufReader::new(file);
                    for (line_num, line_result) in reader.lines().enumerate() {
                        if let Ok(line) = line_result {
                            if line.to_lowercase().contains(&query_lower) {
                                results.push(ContentMatch {
                                    path: path.to_string_lossy().to_string(),
                                    line_number: line_num + 1,
                                    line_content: line.chars().take(200).collect(), // Limit line length
                                });
                                
                                if results.len() >= limit.min(500) {
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    results
}

/// File watcher state - stored globally for this prototype
use std::sync::atomic::{AtomicBool, Ordering};
static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Start watching a directory for changes
#[tauri::command]
fn watch_project(root: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    use notify::{RecommendedWatcher, RecursiveMode, Watcher, Config};
    use std::time::Duration;
    
    if WATCHER_ACTIVE.load(Ordering::SeqCst) {
        return Ok(()); // Already watching
    }
    
    WATCHER_ACTIVE.store(true, Ordering::SeqCst);
    
    let root_clone = root.clone();
    
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        
        let config = Config::default()
            .with_poll_interval(Duration::from_secs(2));
        
        let mut watcher: RecommendedWatcher = match Watcher::new(tx, config) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
                WATCHER_ACTIVE.store(false, Ordering::SeqCst);
                return;
            }
        };
        
        if let Err(e) = watcher.watch(Path::new(&root_clone), RecursiveMode::Recursive) {
            eprintln!("Failed to watch directory: {}", e);
            WATCHER_ACTIVE.store(false, Ordering::SeqCst);
            return;
        }
        
        while WATCHER_ACTIVE.load(Ordering::SeqCst) {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(result) => {
                    if let Ok(event) = result {
                        // Emit event to frontend
                        let _ = app_handle.emit("file-changed", serde_json::json!({
                            "kind": format!("{:?}", event.kind),
                            "paths": event.paths.iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect::<Vec<_>>()
                        }));
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
        
        WATCHER_ACTIVE.store(false, Ordering::SeqCst);
    });
    
    Ok(())
}

/// Stop watching
#[tauri::command]
fn unwatch_project() {
    WATCHER_ACTIVE.store(false, Ordering::SeqCst);
}
