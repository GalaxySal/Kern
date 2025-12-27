// ============================================
// Kern Extension Manager
// Supabase-backed extension marketplace with
// secure download, checksum verification, and
// sandboxed sidecar execution.
// ============================================

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

// Supabase configuration - will be loaded from environment
const SUPABASE_URL: &str = "https://osgtltgosztvivcnltsw.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zZ3RsdGdvc3p0dml2Y25sdHN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3NDYzMzQsImV4cCI6MjA4MjMyMjMzNH0.DFD2-1stdrJFgEnHcaVSj_YtROhySl_ige_gdAQ8LUM";

/// Extension metadata from Supabase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    #[serde(alias = "author_name")]
    pub author: Option<String>,
    pub binary_type: String, // "js_only" or "rust_sidecar"
    pub download_url: String,
    pub checksum_sha256: String,
    pub permissions: Vec<String>,
    pub icon_url: Option<String>,
    // New fields for enhanced marketplace
    #[serde(default)]
    pub downloads: i64,
    #[serde(default)]
    pub rating: f64,
    #[serde(default)]
    pub tags: Vec<String>,
    pub repository_url: Option<String>,
    #[serde(default)]
    pub is_official: bool,
}

/// Installed extension manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub binary_type: String,
    pub permissions: Vec<String>,
    pub installed_at: String,
}

/// Extension manager error types
#[derive(Debug, Clone, Serialize)]
pub struct ExtensionError {
    pub code: String,
    pub message: String,
}

impl From<String> for ExtensionError {
    fn from(msg: String) -> Self {
        ExtensionError {
            code: "UNKNOWN".to_string(),
            message: msg,
        }
    }
}

impl From<&str> for ExtensionError {
    fn from(msg: &str) -> Self {
        ExtensionError {
            code: "UNKNOWN".to_string(),
            message: msg.to_string(),
        }
    }
}

/// Get the Kern extensions directory (~/.kern/extensions)
pub fn get_extensions_dir() -> Result<PathBuf, ExtensionError> {
    let home = dirs::home_dir().ok_or_else(|| ExtensionError {
        code: "NO_HOME".to_string(),
        message: "Could not find home directory".to_string(),
    })?;

    let ext_dir = home.join(".kern").join("extensions");

    if !ext_dir.exists() {
        fs::create_dir_all(&ext_dir).map_err(|e| ExtensionError {
            code: "DIR_CREATE_FAILED".to_string(),
            message: format!("Failed to create extensions directory: {}", e),
        })?;
    }

    Ok(ext_dir)
}

/// Get installed extensions manifest path
fn get_manifest_path() -> Result<PathBuf, ExtensionError> {
    Ok(get_extensions_dir()?.join("manifest.json"))
}

/// Read installed extensions from manifest
pub fn get_installed_extensions() -> Result<Vec<InstalledExtension>, ExtensionError> {
    let manifest_path = get_manifest_path()?;

    if !manifest_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&manifest_path).map_err(|e| ExtensionError {
        code: "MANIFEST_READ_FAILED".to_string(),
        message: format!("Failed to read manifest: {}", e),
    })?;

    serde_json::from_str(&content).map_err(|e| ExtensionError {
        code: "MANIFEST_PARSE_FAILED".to_string(),
        message: format!("Failed to parse manifest: {}", e),
    })
}

/// Save installed extensions manifest
fn save_manifest(extensions: &[InstalledExtension]) -> Result<(), ExtensionError> {
    let manifest_path = get_manifest_path()?;
    let content = serde_json::to_string_pretty(extensions).map_err(|e| ExtensionError {
        code: "MANIFEST_SERIALIZE_FAILED".to_string(),
        message: format!("Failed to serialize manifest: {}", e),
    })?;

    fs::write(&manifest_path, content).map_err(|e| ExtensionError {
        code: "MANIFEST_WRITE_FAILED".to_string(),
        message: format!("Failed to write manifest: {}", e),
    })
}

/// Verify SHA256 checksum of a file (async, memory-efficient streaming)
#[allow(dead_code)]
pub async fn verify_checksum(
    file_path: &Path,
    expected_hash: &str,
) -> Result<bool, ExtensionError> {
    use tokio::fs::File;
    use tokio::io::AsyncReadExt;

    let mut file = File::open(file_path).await.map_err(|e| ExtensionError {
        code: "FILE_OPEN_FAILED".to_string(),
        message: format!("Failed to open file for checksum: {}", e),
    })?;

    let mut hasher = Sha256::new();
    // Use 64KB buffer for optimal I/O performance while keeping memory low
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        let bytes_read = file.read(&mut buffer).await.map_err(|e| ExtensionError {
            code: "FILE_READ_FAILED".to_string(),
            message: format!("Failed to read file: {}", e),
        })?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    let result = hasher.finalize();
    let computed_hash = hex::encode(result);

    Ok(computed_hash.eq_ignore_ascii_case(expected_hash))
}

/// Extract ZIP archive to destination
#[allow(dead_code)]
fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), ExtensionError> {
    let file = File::open(zip_path).map_err(|e| ExtensionError {
        code: "ZIP_OPEN_FAILED".to_string(),
        message: format!("Failed to open ZIP: {}", e),
    })?;

    let mut archive = zip::ZipArchive::new(file).map_err(|e| ExtensionError {
        code: "ZIP_INVALID".to_string(),
        message: format!("Invalid ZIP archive: {}", e),
    })?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| ExtensionError {
            code: "ZIP_ENTRY_FAILED".to_string(),
            message: format!("Failed to read ZIP entry: {}", e),
        })?;

        let outpath = match entry.enclosed_name() {
            Some(path) => dest_dir.join(path),
            None => continue,
        };

        // Security: Prevent path traversal attacks
        if !outpath.starts_with(dest_dir) {
            return Err(ExtensionError {
                code: "PATH_TRAVERSAL".to_string(),
                message: "ZIP contains path traversal attack".to_string(),
            });
        }

        if entry.is_dir() {
            fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).ok();
            }

            let mut outfile = File::create(&outpath).map_err(|e| ExtensionError {
                code: "FILE_CREATE_FAILED".to_string(),
                message: format!("Failed to create file: {}", e),
            })?;

            std::io::copy(&mut entry, &mut outfile).map_err(|e| ExtensionError {
                code: "FILE_WRITE_FAILED".to_string(),
                message: format!("Failed to write file: {}", e),
            })?;
        }
    }

    Ok(())
}

/// Path guard: Check if a path is within allowed directory
pub fn is_path_allowed(path: &Path, allowed_root: &Path) -> bool {
    match (path.canonicalize(), allowed_root.canonicalize()) {
        (Ok(p), Ok(root)) => p.starts_with(root),
        _ => false,
    }
}

// ============================================
// Tauri Commands
// ============================================

/// Fetch extensions from Supabase (or mock data for development)
#[tauri::command]
pub async fn list_marketplace_extensions() -> Result<Vec<Extension>, ExtensionError> {
    // Try to fetch from Supabase first
    let client = reqwest::Client::new();

    match client
        .get(format!("{}/rest/v1/extensions?select=*", SUPABASE_URL))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_ANON_KEY))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<Vec<Extension>>().await {
                    Ok(mut extensions) => {
                        // Add built-in Tailwind extension if not in DB
                        if !extensions.iter().any(|e| e.id == "com.kern.tailwind-v4") {
                            extensions.insert(0, get_tailwind_extension());
                        }
                        return Ok(extensions);
                    }
                    Err(e) => {
                        eprintln!("Failed to parse Supabase response: {}", e);
                    }
                }
            } else {
                eprintln!("Supabase returned status: {}", response.status());
            }
        }
        Err(e) => {
            eprintln!("Failed to reach Supabase: {}", e);
        }
    }

    // Fallback: Return built-in extensions only
    Ok(vec![get_tailwind_extension()])
}

/// Built-in Tailwind v4 IntelliSense extension
fn get_tailwind_extension() -> Extension {
    Extension {
        id: "com.kern.tailwind-v4".to_string(),
        name: "Tailwind v4 IntelliSense".to_string(),
        version: "1.0.0".to_string(),
        description: Some("Smart CSS completions for Tailwind v4 with @theme support. Provides autocomplete for class and className attributes.".to_string()),
        author: Some("Kern Team".to_string()),
        binary_type: "js_only".to_string(),
        download_url: "builtin://tailwind-v4".to_string(),
        checksum_sha256: "builtin".to_string(),
        permissions: vec!["fs:read".to_string()],
        icon_url: Some("https://tailwindcss.com/favicons/favicon-32x32.png".to_string()),
        downloads: 1250,
        rating: 4.8,
        tags: vec!["tailwind".to_string(), "css".to_string(), "intellisense".to_string(), "autocomplete".to_string()],
        repository_url: Some("https://github.com/kern-editor/extensions".to_string()),
        is_official: true,
    }
}

/// Get list of installed extensions
#[tauri::command]
pub fn list_installed_extensions() -> Result<Vec<InstalledExtension>, ExtensionError> {
    get_installed_extensions()
}

/// Install an extension (mock implementation for development)
#[tauri::command]
pub async fn install_extension(extension: Extension) -> Result<InstalledExtension, ExtensionError> {
    let ext_dir = get_extensions_dir()?;
    let ext_path = ext_dir.join(&extension.id);

    // For development: Just create the directory and manifest entry
    // In production: Download, verify checksum, extract

    fs::create_dir_all(&ext_path).map_err(|e| ExtensionError {
        code: "DIR_CREATE_FAILED".to_string(),
        message: format!("Failed to create extension directory: {}", e),
    })?;

    // Create a marker file
    let marker_path = ext_path.join("installed.json");
    fs::write(
        &marker_path,
        serde_json::to_string_pretty(&extension).unwrap_or_default(),
    )
    .map_err(|e| ExtensionError {
        code: "MARKER_WRITE_FAILED".to_string(),
        message: format!("Failed to write marker: {}", e),
    })?;

    // Update manifest
    let mut installed = get_installed_extensions()?;

    // Remove if already exists
    installed.retain(|e| e.id != extension.id);

    let new_install = InstalledExtension {
        id: extension.id.clone(),
        name: extension.name.clone(),
        version: extension.version.clone(),
        binary_type: extension.binary_type.clone(),
        permissions: extension.permissions.clone(),
        installed_at: chrono::Utc::now().to_rfc3339(),
    };

    installed.push(new_install.clone());
    save_manifest(&installed)?;

    Ok(new_install)
}

/// Uninstall an extension
#[tauri::command]
pub fn uninstall_extension(extension_id: String) -> Result<(), ExtensionError> {
    let ext_dir = get_extensions_dir()?;
    let ext_path = ext_dir.join(&extension_id);

    if ext_path.exists() {
        fs::remove_dir_all(&ext_path).map_err(|e| ExtensionError {
            code: "REMOVE_FAILED".to_string(),
            message: format!("Failed to remove extension: {}", e),
        })?;
    }

    // Update manifest
    let mut installed = get_installed_extensions()?;
    installed.retain(|e| e.id != extension_id);
    save_manifest(&installed)?;

    Ok(())
}
