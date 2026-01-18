use kern_core::Document;
use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Manager;
static AUTH_TX: Mutex<Option<tokio::sync::oneshot::Sender<String>>> = Mutex::new(None);
use tauri::{Emitter, State};

// Import system information commands
mod commands;
use commands::{get_app_version, get_arch, get_os_type, get_os_version, get_webview_version};

mod ai_client;

mod extension_manager;
mod git_operations;
mod lsp_manager;
mod tailwind_ext;

use lsp_manager::{get_lsp_status, restart_lsp_server, start_lsp_server, stop_lsp_server};

pub struct AppState {
    pub document: Mutex<Option<Document>>,
    pub pty_writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    // Store PtyPair struct directly, wrapping in Option/Mutex
    // PtyPair contains Box<dyn MasterPty> and Box<dyn SlavePty>, which are Send.
    // So PtyPair itself is Send.
    pub pty_pair: Arc<Mutex<Option<PtyPair>>>,
    pub pty_child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
    // Support multiple terminals for split functionality
    pub terminals: Arc<Mutex<Vec<TerminalInstance>>>,
    pub lsp_manager: lsp_manager::LSPManager,
}

pub struct TerminalInstance {
    pub id: usize,
    pub writer: Option<Box<dyn Write + Send>>,
    pub pair: Option<PtyPair>,
    pub child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
}

#[tauri::command]
fn shell_open(path: String) -> Result<(), String> {
    open::that(path).map_err(|e| e.to_string())?;
    Ok(())
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
async fn read_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut entries = Vec::new();
    let read_path = if path.is_empty() {
        // If path is empty, this shouldn't happen, but fallback to home directory
        match dirs::home_dir() {
            Some(home) => home.to_string_lossy().to_string(),
            None => ".".to_string(),
        }
    } else {
        path.clone()
    };

    // Path validation
    let path_obj = std::path::Path::new(&read_path);
    if !path_obj.exists() {
        return Err(format!("Path does not exist: {}", read_path));
    }
    if !path_obj.is_dir() {
        return Err(format!("Path is not a directory: {}", read_path));
    }

    let mut read_result = tokio::fs::read_dir(read_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    const MAX_ENTRIES: usize = 1000;

    while let Some(entry) = read_result.next_entry().await.map_err(|e| e.to_string())? {
        if count >= MAX_ENTRIES {
            break; // Prevent infinite loops on large directories
        }

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
        count += 1;
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

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

// --- System Information Commands ---
// Moved to commands.rs

// --- Utility Commands ---

#[tauri::command]
fn get_current_dir() -> Result<String, String> {
    Ok(std::env::current_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    match dirs::home_dir() {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => get_current_dir(), // Fallback to current dir if home not found
    }
}

#[tauri::command]
fn set_current_dir(path: String) -> Result<(), String> {
    std::env::set_current_dir(&path).map_err(|e| e.to_string())
}

// --- Terminal Commands ---

#[tauri::command]
fn spawn_terminal(state: State<AppState>, app_handle: tauri::AppHandle) -> Result<(), String> {
    // Check if terminal is already running
    {
        let child_guard = state.pty_child.lock().map_err(|_| "Failed to lock child")?;
        if child_guard.is_some() {
            return Ok(()); // Terminal already running
        }
    }
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Detect user's shell and OS
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "/bin/bash".to_string()
        }
    });

    let cmd = CommandBuilder::new(&shell);

    // Don't use login shell flags to avoid extra prompts
    // Just start the shell in interactive mode
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Store writer
    {
        let mut writer_guard = state
            .pty_writer
            .lock()
            .map_err(|_| "Failed to lock writer")?;
        *writer_guard = Some(writer);
    }

    // Store pair to keep it alive
    {
        let mut pair_guard = state.pty_pair.lock().map_err(|_| "Failed to lock pair")?;
        *pair_guard = Some(pair);
    }

    // Store child process to keep it alive
    {
        let mut child_guard = state.pty_child.lock().map_err(|_| "Failed to lock child")?;
        *child_guard = Some(child);
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
    let mut writer_guard = state
        .pty_writer
        .lock()
        .map_err(|_| "Failed to lock writer")?;
    if let Some(writer) = writer_guard.as_mut() {
        write!(writer, "{}", data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_user_ports() -> Result<Vec<PortInfo>, String> {
    use std::process::Command;

    let output = if cfg!(target_os = "windows") {
        Command::new("netstat").args(["-ano"]).output()
    } else {
        Command::new("netstat").args(["-tulpn"]).output()
    }
    .map_err(|e| format!("Failed to run netstat: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports = Vec::new();

    for line in stdout.lines() {
        if cfg!(target_os = "windows") {
            // Windows netstat format: TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       1234
            if line.contains("LISTENING") || line.contains("ESTABLISHED") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 {
                    let address = parts[1];
                    if let Some(port_str) = address.split(':').next_back()
                        && let Ok(port) = port_str.parse::<u16>()
                    {
                        let pid = parts.get(4).unwrap_or(&"?");
                        let process_name = get_process_name(pid);
                        ports.push(PortInfo {
                            port,
                            protocol: "TCP".to_string(),
                            process: process_name,
                            local_address: format!("localhost:{}", port),
                        });
                    }
                }
            }
        } else {
            // Linux netstat format: tcp        0      0 127.0.0.1:5173          0.0.0.0:*               LISTEN      1234/python
            if line.contains("LISTEN") || line.contains("ESTABLISHED") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 7 {
                    let address = parts[3];
                    if let Some(port_str) = address.split(':').next_back()
                        && let Ok(port) = port_str.parse::<u16>()
                    {
                        let process_info = parts.get(6).unwrap_or(&"?");
                        let (process, _) =
                            process_info.split_once('/').unwrap_or((process_info, ""));
                        ports.push(PortInfo {
                            port,
                            protocol: parts[0].to_uppercase(),
                            process: process.to_string(),
                            local_address: format!("localhost:{}", port),
                        });
                    }
                }
            }
        }
    }

    // Sort by port number and remove duplicates
    ports.sort_by_key(|p| p.port);
    ports.dedup_by_key(|p| p.port);

    Ok(ports)
}

#[derive(serde::Serialize)]
struct PortInfo {
    port: u16,
    protocol: String,
    process: String,
    local_address: String,
}

fn get_process_name(pid: &str) -> String {
    // Use runtime detection instead of compile-time cfg
    if std::env::consts::OS == "windows" {
        // Inline the Windows logic to avoid cfg issues
        use std::process::Command;

        if pid == "?" || pid.is_empty() {
            return "Unknown".to_string();
        }

        match Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = stdout.lines().next() {
                    line.split(',')
                        .next()
                        .unwrap_or("Unknown")
                        .trim_matches('"')
                        .to_string()
                } else {
                    "Unknown".to_string()
                }
            }
            Err(_) => "Unknown".to_string(),
        }
    } else {
        "Unknown".to_string()
    }
}

#[tauri::command]
fn kill_terminal(state: State<AppState>) -> Result<(), String> {
    // Kill child process
    {
        let mut child_guard = state.pty_child.lock().map_err(|_| "Failed to lock child")?;
        if let Some(mut child) = child_guard.take() {
            // Use the Child trait's kill method directly
            child
                .kill()
                .map_err(|e| format!("Failed to kill process: {}", e))?;
        }
    }

    // Clear writer
    {
        let mut writer_guard = state
            .pty_writer
            .lock()
            .map_err(|_| "Failed to lock writer")?;
        *writer_guard = None;
    }

    // Clear pair
    {
        let mut pair_guard = state.pty_pair.lock().map_err(|_| "Failed to lock pair")?;
        *pair_guard = None;
    }

    Ok(())
}

#[tauri::command]
fn split_terminal(state: State<AppState>, app_handle: tauri::AppHandle) -> Result<usize, String> {
    let mut terminals_guard = state
        .terminals
        .lock()
        .map_err(|_| "Failed to lock terminals")?;
    let terminal_id = terminals_guard.len();

    // Create new terminal instance
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Detect user's shell and OS
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "/bin/bash".to_string()
        }
    });

    let cmd = CommandBuilder::new(&shell);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Create terminal instance
    let terminal = TerminalInstance {
        id: terminal_id,
        writer: Some(writer),
        pair: Some(pair),
        child: Some(child),
    };

    // Start reader thread for this terminal
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("term-data-split", data);
                }
                Ok(_) => break, // EOF
                Err(_) => break,
            }
        }
    });

    terminals_guard.push(terminal);
    Ok(terminal_id)
}

#[tauri::command]
fn resize_terminal(rows: u16, cols: u16, state: State<AppState>) -> Result<(), String> {
    let pair_guard = state.pty_pair.lock().map_err(|_| "Failed to lock pair")?;
    if let Some(pair) = pair_guard.as_ref() {
        pair.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Terminal resize failed: {}", e))?;
    }
    Ok(())
}

// i18n commands
#[tauri::command]
async fn get_locale() -> Result<String, String> {
    // Try to get system locale, fallback to English
    let locale = sys_locale::get_locale().unwrap_or_else(|| "en".to_string());
    // Extract just the language part (e.g., "en-US" -> "en")
    let lang = locale.split('-').next().unwrap_or("en");
    Ok(lang.to_string())
}

#[tauri::command]
async fn load_translations(locale: String) -> Result<serde_json::Value, String> {
    let file_path = format!("src-tauri/locales/{}.json", locale);
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read translation file: {}", e))?;
    let translations: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse translation file: {}", e))?;
    Ok(translations)
}

#[tauri::command]
async fn set_locale(locale: String) -> Result<String, String> {
    // In a real implementation, you might want to store this preference
    // For now, just return the locale as confirmation
    Ok(locale)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut builder = tauri::Builder::default()
        .manage(AppState {
            document: Mutex::new(None),
            pty_writer: Arc::new(Mutex::new(None)),
            pty_pair: Arc::new(Mutex::new(None)),
            pty_child: Arc::new(Mutex::new(None)),
            terminals: Arc::new(Mutex::new(Vec::new())),
            lsp_manager: lsp_manager::LSPManager::new(),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_localhost::Builder::new(9527).build());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    builder
        /* tauri-plugin-deep-link causes 'state() called before manage()' panic on Linux.
        We disable it on Linux/Windows and use manual argv/single-instance instead. */
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            println!("Second instance started with argv: {:?}", argv);
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();

            // Manually handle deep links passed via argv (common on all platforms)
            for arg in argv {
                if arg.starts_with("kern://") {
                    println!("Manual deep link handoff from second instance: {}", arg);
                    let mut tx_guard = AUTH_TX.lock().unwrap();
                    if let Some(tx) = tx_guard.take() {
                        let _ = tx.send(arg);
                    }
                }
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|_app| {
            /* Only use deep-link plugin on macOS where it's required for native URL events */
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    println!("macOS deep link event received: {:?}", urls);
                    for url in urls {
                        let url_str = url.to_string();
                        if url_str.starts_with("kern://auth-callback")
                            || url_str.starts_with("kern://google-auth-callback")
                        {
                            let mut tx_guard = AUTH_TX.lock().unwrap();
                            if let Some(tx) = tx_guard.take() {
                                let _ = tx.send(url_str);
                            }
                        }
                    }
                });
            }

            // Linux & Windows & macOS (First Instance): check argv manually for links
            // This catches the 'kern://...' link if the app was started BY the link.
            for arg in std::env::args() {
                if arg.starts_with("kern://auth-callback")
                    || arg.starts_with("kern://google-auth-callback")
                {
                    println!("Initial startup with deep link: {}", arg);
                    let mut tx_guard = AUTH_TX.lock().unwrap();
                    if let Some(tx) = tx_guard.take() {
                        let _ = tx.send(arg);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            shell_open,
            open_file,
            save_file,
            read_dir,
            get_view_lines,
            get_current_dir,
            get_home_dir,
            set_current_dir,
            spawn_terminal,
            write_to_terminal,
            kill_terminal,
            split_terminal,
            resize_terminal,
            get_os_type,
            get_os_version,
            get_arch,
            get_app_version,
            get_webview_version,
            get_git_branch,
            open_project,
            search_files,
            search_content,
            watch_project,
            unwatch_project,
            get_user_ports,
            git_status,
            git_commit,
            git_branches,
            git_checkout_branch,
            git_create_branch,
            git_push,
            git_pull,
            extension_manager::list_marketplace_extensions,
            extension_manager::list_installed_extensions,
            extension_manager::install_extension,
            extension_manager::uninstall_extension,
            tailwind_ext::tailwind_scan_project,
            tailwind_ext::tailwind_start_watcher,
            tailwind_ext::tailwind_stop_watcher,
            ai_client::stream_vibe_chat,
            ai_client::apply_code_change,
            ai_client::sync_settings,
            authenticate_github,
            authenticate_google,
            start_lsp_server,
            stop_lsp_server,
            get_lsp_status,
            restart_lsp_server,
            get_locale,
            load_translations,
            set_locale
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                let state = app_handle.state::<AppState>();

                println!("Close requested - cleaned up and exiting...");

                // 1. Stop all LSP servers gracefully
                let _ = state.lsp_manager.stop_all_servers();

                // Note: PTY processes and WebKit processes are automatically killed
                // when the parent process exits via std::process::exit(0).

                app_handle.exit(0);
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: GitHubUser,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[tauri::command]
async fn authenticate_github(_app_handle: tauri::AppHandle) -> Result<AuthResponse, String> {
    use reqwest::Client;

    let _ = dotenvy::dotenv();
    println!("Starting GitHub authentication flow...");

    let client_id = std::env::var("GITHUB_CLIENT_ID").unwrap_or_else(|_| {
        println!("Warning: GITHUB_CLIENT_ID not found in env, using fallback");
        "Ov23li8kiy5bB9tLd13g".to_string()
    });
    let client_secret = std::env::var("GITHUB_CLIENT_SECRET").unwrap_or_else(|_| {
        println!("Warning: GITHUB_CLIENT_SECRET not found in env, using fallback");
        "5eff5a4dd6a6f8cb13f1978568140b6801a26a2e".to_string()
    });

    // Create a channel to receive the callback URL
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let mut tx_guard = AUTH_TX.lock().unwrap();
        *tx_guard = Some(tx);
    }

    let state = uuid::Uuid::new_v4().to_string();

    // Use kern://auth-callback as the deep link protocol
    let redirect_uri = "kern://auth-callback";

    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&scope=repo&redirect_uri={}&state={}",
        client_id,
        urlencoding::encode(redirect_uri),
        &state
    );

    println!("Opening auth URL: {}", auth_url);
    shell_open(auth_url)?;

    println!("Waiting for OAuth callback (kern://auth-callback)...");

    // Wait for the callback with a timeout
    let url_str = match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(res) => {
            let val = res.map_err(|_| "Failed to receive OAuth callback".to_string())?;
            println!("Received callback URL: {}", val);
            val
        }
        Err(_) => {
            println!("Error: OAuth timeout reached after 300s");
            let mut tx_guard = AUTH_TX.lock().unwrap();
            *tx_guard = None;
            return Err("OAuth timeout reached".to_string());
        }
    };

    println!("Parsing callback URL...");
    // Parse URL to get code
    let url =
        url::Url::parse(&url_str).map_err(|e| format!("Failed to parse callback URL: {}", e))?;
    let code_pair = url.query_pairs().find(|(key, _)| key == "code");

    let code = match code_pair {
        Some((_, code)) => {
            println!("Code extracted successfully.");
            code.to_string()
        }
        None => {
            println!("Error: No OAuth code found in callback URL");
            return Err("No OAuth code received in parsed URL".to_string());
        }
    };

    println!("Exchanging code for access token...");
    // Exchange code for token
    let client = Client::new();
    let token_resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", "Kern-Editor")
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| {
            println!("Error: Token request failed: {}", e);
            e.to_string()
        })?;

    println!("Token response received. Decoding...");
    let token_data: serde_json::Value = token_resp.json().await.map_err(|e| {
        println!("Error: Failed to decode token response JSON: {}", e);
        e.to_string()
    })?;

    if let Some(error) = token_data.get("error") {
        let err_msg = error.as_str().unwrap_or("Unknown OAuth error").to_string();
        println!("Error: GitHub returned OAuth error: {}", err_msg);
        return Err(err_msg);
    }

    let access_token = token_data["access_token"]
        .as_str()
        .ok_or_else(|| {
            println!(
                "Error: No access_token in GitHub response: {:?}",
                token_data
            );
            "No access token in response".to_string()
        })?
        .to_string();

    println!("Access token obtained. Fetching user info...");

    // Get user info
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("token {}", access_token))
        .header("User-Agent", "Kern-Editor")
        .send()
        .await
        .map_err(|e| {
            println!("Error: User info request failed: {}", e);
            e.to_string()
        })?;

    let user_data: GitHubUser = user_resp.json().await.map_err(|e| {
        println!("Error: Failed to decode user info JSON: {}", e);
        e.to_string()
    })?;

    println!(
        "GitHub Authentication successful for user: {}",
        user_data.login
    );

    Ok(AuthResponse {
        token: access_token,
        user: user_data,
    })
}

#[tauri::command]
async fn authenticate_google(_app_handle: tauri::AppHandle) -> Result<AuthResponse, String> {
    use reqwest::Client;

    let _ = dotenvy::dotenv();
    println!("Starting Google authentication flow...");

    // Load .env file manually if needed, though dotenvy::dotenv() at start should handle it.
    // We check for specific error to guide the user.
    let client_id = std::env::var("GOOGLE_CLIENT_ID")
        .map_err(|_| "Missing GOOGLE_CLIENT_ID. Please add it to src-tauri/.env".to_string())?;

    let client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
        .map_err(|_| "Missing GOOGLE_CLIENT_SECRET. Please add it to src-tauri/.env".to_string())?;

    if client_id.is_empty() || client_secret.is_empty() {
        return Err("Google Credentials are empty in .env".to_string());
    }

    // Create a channel to receive the callback URL
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let mut tx_guard = AUTH_TX.lock().unwrap();
        *tx_guard = Some(tx);
    }

    let state = uuid::Uuid::new_v4().to_string();
    let redirect_uri = "kern://google-auth-callback";

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=email%20profile&state={}",
        client_id,
        urlencoding::encode(redirect_uri),
        &state
    );

    println!("Opening Google auth URL: {}", auth_url);
    shell_open(auth_url)?;

    println!("Waiting for Google OAuth callback...");

    // Wait for the callback with a timeout
    let url_str = match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(res) => {
            let val = res.map_err(|_| "Failed to receive OAuth callback".to_string())?;
            println!("Received callback URL: {}", val);
            val
        }
        Err(_) => {
            println!("Error: OAuth timeout reached");
            let mut tx_guard = AUTH_TX.lock().unwrap();
            *tx_guard = None;
            return Err("OAuth timeout reached".to_string());
        }
    };

    // Parse URL
    let url =
        url::Url::parse(&url_str).map_err(|e| format!("Failed to parse callback URL: {}", e))?;
    // Verify it is google callback
    if url.domain() != Some("google-auth-callback") && !url_str.contains("google-auth-callback") {
        // Note: parsing kern://google-auth-callback might put host as google-auth-callback
        // or it might just be the path.
        // For now, accept it if it contains the keywords
        println!(
            "Warning: Callback URL might not match expected protocol: {}",
            url_str
        );
    }

    let code_pair = url.query_pairs().find(|(key, _)| key == "code");
    let code = match code_pair {
        Some((_, code)) => code.to_string(),
        None => return Err("No OAuth code found in callback".to_string()),
    };

    println!("Exchanging code for token...");
    let client = Client::new();
    let params = format!(
        "client_id={}&client_secret={}&code={}&grant_type=authorization_code&redirect_uri={}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&client_secret),
        urlencoding::encode(&code),
        urlencoding::encode(redirect_uri)
    );

    let token_resp = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(params)
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    let token_data: serde_json::Value = token_resp
        .json()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if let Some(error) = token_data.get("error") {
        return Err(format!("Google OAuth Error: {}", error));
    }

    let access_token = token_data["access_token"]
        .as_str()
        .ok_or("No access token in response")?
        .to_string();

    println!("Fetching user info...");
    let user_resp = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    let user_data: serde_json::Value = user_resp
        .json()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    let user = GitHubUser {
        login: user_data["name"]
            .as_str()
            .unwrap_or("Google User")
            .to_string(),
        avatar_url: user_data["picture"].as_str().map(|s| s.to_string()),
    };

    println!("Google Auth successful for: {}", user.login);

    Ok(AuthResponse {
        token: access_token,
        user,
    })
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
                String::new()
            } else {
                stdout
            }
        }
        Err(_) => String::new(),
    }
}

// ============================================
// Git Commands
// ============================================

#[tauri::command]
fn git_status(repo_path: String) -> Result<git_operations::GitStatus, String> {
    git_operations::get_git_status(&repo_path)
}

#[tauri::command]
fn git_commit(repo_path: String, message: String) -> Result<git_operations::GitCommit, String> {
    git_operations::commit_changes(&repo_path, &message)
}

#[tauri::command]
fn git_branches(repo_path: String) -> Result<Vec<git_operations::GitBranch>, String> {
    git_operations::get_branches(&repo_path)
}

#[tauri::command]
fn git_checkout_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    git_operations::checkout_branch(&repo_path, &branch_name)
}

#[tauri::command]
fn git_create_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    git_operations::create_branch(&repo_path, &branch_name)
}

#[tauri::command]
fn git_push(repo_path: String, remote: String, branch: String) -> Result<(), String> {
    git_operations::push_changes(&repo_path, &remote, &branch)
}

#[tauri::command]
fn git_pull(repo_path: String, remote: String, branch: String) -> Result<(), String> {
    git_operations::pull_changes(&repo_path, &remote, &branch)
}

// ============================================
// Phase 2: Advanced Features
// ============================================

/// Project file tree node for JSON serialization
#[derive(serde::Serialize, Clone)]
struct ProjectNode {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<ProjectNode>,
}

/// Fast project scanner using basic fs for reliability
#[tauri::command]
async fn open_project(root: String) -> Result<ProjectNode, String> {
    use tokio::fs;

    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root));
    }

    // Security: Block sensitive system directories on Linux/Unix
    if cfg!(unix) {
        let path_str = root_path.to_string_lossy();
        let blocked_paths = [
            "/",
            "/etc",
            "/bin",
            "/sbin",
            "/proc",
            "/sys",
            "/usr/bin",
            "/usr/sbin",
            "/var",
            "/dev",
            "/boot",
            "/root",
        ];

        if blocked_paths.contains(&path_str.as_ref()) {
            return Err(format!(
                "Restricted directory: '{}' is a system path and cannot be opened as a project.",
                path_str
            ));
        }

        // Additional check: Don't allow opening direct subdirectories of / if they are typical system dirs
        if path_str.starts_with('/') && path_str.split('/').filter(|s| !s.is_empty()).count() <= 1 {
            let top_dir = path_str.trim_start_matches('/');
            if blocked_paths
                .iter()
                .any(|p| p.trim_start_matches('/') == top_dir)
            {
                return Err(format!(
                    "Restricted directory: '{}' is a system path and cannot be opened as a project.",
                    path_str
                ));
            }
        }
    }

    // Simple directory reading for testing
    let mut entries: Vec<(String, String, bool)> = Vec::new();
    let mut count = 0;
    const MAX_ENTRIES: usize = 1000;

    // Read immediate directory contents first
    let mut dir_entries = fs::read_dir(&root).await.map_err(|e| e.to_string())?;

    while let Some(entry) = dir_entries.next_entry().await.map_err(|e| e.to_string())? {
        if count >= MAX_ENTRIES {
            break;
        }

        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = path.is_dir();

        entries.push((name.clone(), path_str, is_dir));
        count += 1;
    }

    // Build tree structure
    let root_name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            println!("Warning: Could not get file_name from path: {}", root);
            root.clone()
        });

    let mut tree = ProjectNode {
        name: root_name,
        path: root.clone(),
        is_dir: true,
        children: Vec::new(),
    };

    // Convert entries to ProjectNodes
    for (name, path, is_dir) in entries {
        tree.children.push(ProjectNode {
            name,
            path,
            is_dir,
            children: Vec::new(), // Don't load children initially
        });
    }

    // Add notification if project was truncated
    if count >= MAX_ENTRIES {
        tree.children.push(ProjectNode {
            name: format!("... (truncated, showing first {} files)", MAX_ENTRIES),
            path: root.clone(),
            is_dir: false,
            children: Vec::new(),
        });
    }
    Ok(tree)
}

/// Fuzzy file name search across project
#[tauri::command]
fn search_files(query: String, root: String, limit: usize) -> Vec<(String, String, i64)> {
    kern_core::search_files(&query, &root, limit)
}

#[tauri::command]
fn search_content(query: String, root: String, limit: usize) -> Vec<kern_core::ContentMatch> {
    kern_core::search_content(&query, &root, limit)
}

/// Start watching a directory for changes
#[tauri::command]
fn watch_project(root: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    use kern_core::ProjectWatcher;
    use std::time::Duration;

    if ProjectWatcher::is_active() {
        return Ok(()); // Already watching
    }

    let watcher = ProjectWatcher::new(&root)?;

    std::thread::spawn(move || {
        let rx = watcher.receiver;

        while ProjectWatcher::is_active() {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(result) => {
                    if let Ok(event) = result {
                        // Emit event to frontend
                        let _ = app_handle.emit(
                            "file-changed",
                            serde_json::json!({
                                "kind": format!("{:?}", event.kind),
                                "paths": event.paths.iter()
                                    .map(|p| p.to_string_lossy().to_string())
                                    .collect::<Vec<_>>()
                            }),
                        );
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }

        ProjectWatcher::stop();
    });

    Ok(())
}

/// Stop watching
#[tauri::command]
fn unwatch_project() {
    kern_core::ProjectWatcher::stop();
}
