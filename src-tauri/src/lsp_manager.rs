use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LSPServerConfig {
    pub command: String,
    pub args: Vec<String>,
    pub language: String,
    pub workspace_root: String,
}

#[derive(Debug)]
pub struct LSPServerInstance {
    pub config: LSPServerConfig,
    pub child: Option<std::process::Child>,
    pub pid: Option<u32>,
}

pub struct LSPManager {
    pub servers: Arc<Mutex<HashMap<String, LSPServerInstance>>>,
}

impl LSPManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_server(&self, config: LSPServerConfig) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|_| "Failed to lock servers")?;

        // Check if server is already running
        if servers.contains_key(&config.language) {
            return Ok(());
        }

        // Check if the command exists
        if !self.command_exists(&config.command) {
            return Err(format!("LSP server command not found: {}", config.command));
        }

        // Start the LSP server process
        let child = Command::new(&config.command)
            .args(&config.args)
            .current_dir(&config.workspace_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start LSP server: {}", e))?;

        let pid = child.id();

        let server_instance = LSPServerInstance {
            config: config.clone(),
            child: Some(child),
            pid: Some(pid),
        };

        servers.insert(config.language.clone(), server_instance);

        // Start monitoring the server
        self.monitor_server(config.language.clone());

        println!(
            "LSP server started for {} with PID: {}",
            config.language, pid
        );
        Ok(())
    }

    pub fn stop_server(&self, language: &str) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|_| "Failed to lock servers")?;

        if let Some(server) = servers.remove(language) {
            if let Some(mut child) = server.child {
                child
                    .kill()
                    .map_err(|e| format!("Failed to kill LSP server: {}", e))?;
            }
            println!("LSP server stopped for {}", language);
        }

        Ok(())
    }

    pub fn stop_all_servers(&self) -> Result<(), String> {
        if let Ok(servers) = self.servers.lock() {
            let languages: Vec<String> = servers.keys().cloned().collect();

            drop(servers); // Release the lock before stopping servers

            for language in languages {
                let _ = self.stop_server(&language);
            }
        }

        Ok(())
    }

    fn command_exists(&self, command: &str) -> bool {
        Command::new("which")
            .arg(command)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn monitor_server(&self, language: String) {
        thread::spawn(move || {
            // Monitor the server process
            thread::sleep(Duration::from_secs(2));

            // In a real implementation, this would:
            // 1. Read stdout/stderr for LSP messages
            // 2. Parse JSON-RPC messages
            // 3. Handle LSP protocol communication
            // 4. Emit events to the frontend

            println!("Monitoring LSP server for {}", language);
        });
    }

    pub fn get_server_status(&self) -> HashMap<String, bool> {
        if let Ok(servers) = self.servers.lock() {
            let mut status = HashMap::new();

            for (language, server) in servers.iter() {
                let is_running = server.pid.is_some();
                status.insert(language.clone(), is_running);
            }

            status
        } else {
            HashMap::new()
        }
    }
}

// Tauri commands
#[tauri::command]
pub async fn start_lsp_server(
    command: String,
    args: Vec<String>,
    language: String,
    workspace_root: String,
    lsp_manager: State<'_, LSPManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let config = LSPServerConfig {
        command,
        args,
        language,
        workspace_root,
    };

    lsp_manager.start_server(config.clone()).await?;

    // Emit event to frontend
    let _ = app_handle.emit("lsp-server-started", &config.language);

    Ok(())
}

#[tauri::command]
pub async fn stop_lsp_server(
    language: String,
    lsp_manager: State<'_, LSPManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    lsp_manager.stop_server(&language)?;

    // Emit event to frontend
    let _ = app_handle.emit("lsp-server-stopped", &language);

    Ok(())
}

#[tauri::command]
pub async fn get_lsp_status(
    lsp_manager: State<'_, LSPManager>,
) -> Result<HashMap<String, bool>, String> {
    Ok(lsp_manager.get_server_status())
}

#[tauri::command]
pub async fn restart_lsp_server(
    language: String,
    lsp_manager: State<'_, LSPManager>,
) -> Result<(), String> {
    lsp_manager.stop_server(&language)?;
    // Note: The frontend would need to call start_lsp_server again
    Ok(())
}

// Common LSP server configurations
#[allow(dead_code)]
pub fn get_default_lsp_configs(workspace_root: &str) -> Vec<LSPServerConfig> {
    vec![
        LSPServerConfig {
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            language: "typescript".to_string(),
            workspace_root: workspace_root.to_string(),
        },
        LSPServerConfig {
            command: "pylsp".to_string(),
            args: vec![],
            language: "python".to_string(),
            workspace_root: workspace_root.to_string(),
        },
        LSPServerConfig {
            command: "rust-analyzer".to_string(),
            args: vec![],
            language: "rust".to_string(),
            workspace_root: workspace_root.to_string(),
        },
        LSPServerConfig {
            command: "gopls".to_string(),
            args: vec!["serve".to_string()],
            language: "go".to_string(),
            workspace_root: workspace_root.to_string(),
        },
    ]
}
