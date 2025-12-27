// ============================================
// Kern Vibe AI Client (Production Upgrade)
// handles real streaming, secure keys, and context
// ============================================

use crate::extension_manager;
use crate::tailwind_ext;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreBuilder;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VibeChunk {
    pub text: String,
    pub is_final: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatContext {
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub cursor_line: Option<usize>,
    pub cursor_col: Option<usize>,
}

/// Retrieve API key from secure store
fn get_api_key(app: &AppHandle, provider: &str) -> Option<String> {
    let store_path = PathBuf::from("settings.json");
    let store = StoreBuilder::new(app, store_path).build().ok()?;
    store
        .get(provider)
        .and_then(|v: serde_json::Value| v.as_str().map(|s: &str| s.to_string()))
}

#[tauri::command]
pub async fn stream_vibe_chat(
    app_handle: AppHandle,
    prompt: String,
    project_root: String,
    mut model_id: String,
    context: ChatContext,
) -> Result<(), String> {
    // 0. Handle Custom Model ID Override
    let store_path = PathBuf::from("settings.json");
    let store = StoreBuilder::new(&app_handle, store_path.clone())
        .build()
        .ok();
    if model_id == "custom" || model_id == "ollama" {
        if let Some(s) = &store {
            if let Some(custom_id) = s
                .get("custom_model_id")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
            {
                model_id = custom_id;
            } else if model_id == "ollama" {
                return Err(
                    "Ollama selected but no model name provided in 'Custom Model ID' field."
                        .to_string(),
                );
            } else {
                return Err("Custom Model ID selected but none provided in Settings.".to_string());
            }
        }
    }

    // 1. Identify Provider and Get Key
    let provider = if model_id.contains("gpt-") {
        "openai"
    } else if model_id.contains("claude-") {
        "anthropic"
    } else if model_id.contains("gemini-") {
        "gemini"
    } else if model_id.contains("deepseek-") {
        "deepseek"
    } else if model_id == "ollama" || model_id.contains("qwen") || model_id.contains("llama") {
        "ollama"
    } else {
        "openai"
    }; // Fallback to OpenAI compatible

    let api_key = if provider == "ollama" {
        "".to_string() // Ollama typically doesn't need a key locally
    } else {
        get_api_key(&app_handle, provider)
            .ok_or_else(|| format!("API key for {} not found in Settings.", provider))?
    };

    // 2. Fetch Tailwind Context
    let tailwind_data = tailwind_ext::tailwind_scan_project(project_root.clone())
        .map_err(|e| format!("Tailwind scan failed: {}", e))?;

    let mut theme_context = String::new();
    if !tailwind_data.custom_properties.is_empty() {
        theme_context.push_str("\nTailwind v4 @theme variables:\n");
        for prop in tailwind_data.custom_properties {
            theme_context.push_str(&format!("- {}: {}\n", prop.label, prop.detail));
        }
    }

    // 3. Prepare System Prompt with Context
    // 3. Prepare System Prompt with Context (Strict No-Yapping)
    let system_prompt = format!(
        "You are a senior software engineer. ONLY generate code. NO yapping. NO explanations. \
         Stay focused on modern Tailwind v4 and Rust. Use current project context.\n\n\
         Project Root: {}\n\
         Active File: {:?}\n\
         Cursor: {}:{}\n\
         {}\n\
         Deliver code that can be directly applied. Be concise.",
        project_root,
        context.file_path.unwrap_or_default(),
        context.cursor_line.unwrap_or(0),
        context.cursor_col.unwrap_or(0),
        theme_context
    );

    // 4. Start Streaming Request
    let client = reqwest::Client::new();

    if provider == "gemini" {
        // Google AI Studio Native (v1beta)
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?key={}",
            model_id, api_key
        );

        let response = client
            .post(url)
            .json(&json!({
                "contents": [{
                    "role": "user",
                    "parts": [{"text": format!("{}\n\nUser request: {}", system_prompt, prompt)}]
                }],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 4096,
                }
            }))
            .send()
            .await
            .map_err(|e| format!("Gemini request failed: {}", e))?;

        if !response.status().is_success() {
            let err_body = response.text().await.unwrap_or_default();
            // Inject hint for mismatch detection
            let err_msg = if err_body.contains("INVALID_ARGUMENT") || err_body.contains("not found")
            {
                format!("Model ID Mismatch (invalid_model): {}", err_body)
            } else {
                format!("Gemini Error: {}", err_body)
            };
            return Err(err_msg);
        }

        let mut stream = response.bytes_stream();
        tokio::spawn(async move {
            let mut buffer = String::new();
            while let Some(item) = stream.next().await {
                if let Ok(bytes) = item {
                    let chunk_str = String::from_utf8_lossy(&bytes);
                    buffer.push_str(&chunk_str);

                    // Simple heuristic to extract text from Gemini chunks
                    while let Some(start) = buffer.find('{') {
                        let mut brace_count = 0;
                        let mut end_idx = None;
                        for (i, c) in buffer[start..].char_indices() {
                            if c == '{' {
                                brace_count += 1;
                            } else if c == '}' {
                                brace_count -= 1;
                            }

                            if brace_count == 0 {
                                end_idx = Some(start + i + 1);
                                break;
                            }
                        }

                        if let Some(end) = end_idx {
                            let json_str = &buffer[start..end];
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                                // Check for Errors
                                if let Some(err) = json["error"].as_object() {
                                    let msg = err
                                        .get("message")
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("Unknown Gemini Error");
                                    let _ = app_handle.emit(
                                        "vibe-chunk",
                                        VibeChunk {
                                            text: format!(
                                                "\n\n> [!CAUTION]\n> **Gemini API Error:** {}\n",
                                                msg
                                            ),
                                            is_final: false,
                                        },
                                    );
                                }
                                // Check for Content
                                else if let Some(content) =
                                    json["candidates"][0]["content"]["parts"][0]["text"].as_str()
                                {
                                    let _ = app_handle.emit(
                                        "vibe-chunk",
                                        VibeChunk {
                                            text: content.to_string(),
                                            is_final: false,
                                        },
                                    );
                                }
                            }
                            buffer = buffer[end..].to_string();
                        } else {
                            break; // Wait for more data
                        }
                    }
                }
            }
            let _ = app_handle.emit(
                "vibe-chunk",
                VibeChunk {
                    text: "".to_string(),
                    is_final: true,
                },
            );
        });
    } else {
        // OpenAI / DeepSeek / Anthropic compatible
        let url = if provider == "deepseek" {
            "https://api.deepseek.com/chat/completions"
        } else if provider == "anthropic" {
            "https://api.anthropic.com/v1/messages"
        } else if provider == "ollama" {
            "http://localhost:11434/v1/chat/completions"
        } else {
            "https://api.openai.com/v1/chat/completions"
        };

        let mut request = client.post(url);

        if provider == "anthropic" {
            request = request
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": model_id,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 4096,
                    "stream": true
                }));
        } else {
            request = request
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&json!({
                    "model": model_id,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "stream": true
                }));
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("API request failed: {}", e))?;

        if !response.status().is_success() {
            let err_body = response.text().await.unwrap_or_default();
            return Err(format!("API Error ({}): {}", provider, err_body));
        }

        let mut stream = response.bytes_stream();
        tokio::spawn(async move {
            while let Some(item) = stream.next().await {
                if let Ok(bytes) = item {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if line.starts_with("data: ") {
                            let data = line.trim_start_matches("data: ");
                            if data == "[DONE]" {
                                break;
                            }

                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                // Anthropic format
                                if let Some(content) = json["delta"]["text"].as_str() {
                                    let _ = app_handle.emit(
                                        "vibe-chunk",
                                        VibeChunk {
                                            text: content.to_string(),
                                            is_final: false,
                                        },
                                    );
                                }
                                // OpenAI format
                                else if let Some(content) =
                                    json["choices"][0]["delta"]["content"].as_str()
                                {
                                    let _ = app_handle.emit(
                                        "vibe-chunk",
                                        VibeChunk {
                                            text: content.to_string(),
                                            is_final: false,
                                        },
                                    );
                                }
                            }
                        }
                    }
                }
            }
            let _ = app_handle.emit(
                "vibe-chunk",
                VibeChunk {
                    text: "".to_string(),
                    is_final: true,
                },
            );
        });
    }

    Ok(())
}

/// Securely apply AI-generated code to a file
#[tauri::command]
pub async fn apply_code_change(
    project_root: String,
    file_path: String,
    code: String,
) -> Result<(), String> {
    let root = Path::new(&project_root);
    let path = Path::new(&file_path);

    if !extension_manager::is_path_allowed(path, root) {
        return Err("Security Error: Access denied to path outside project root.".to_string());
    }

    fs::write(path, code).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}
