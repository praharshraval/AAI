//! # RPA Agent Platform — Tauri v2 Application Entry Point
//!
//! This module serves as the main entry point for the Tauri desktop application.
//! It initializes the application state, registers all IPC command handlers, and
//! starts the Tauri runtime. The IPC bridge exposes secure keyring operations,
//! bootstrap/provisioning commands, database CRUD operations, and sidecar execution.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bootstrap;
mod database;
mod keyring;

use std::sync::{Arc, Mutex};
use tauri::Emitter;

/// Shared application state accessible from all IPC command handlers.
pub struct AppState {
    /// Thread-safe handle to the local SQLite database.
    pub db: Arc<Mutex<database::Database>>,
    /// Active Python sidecar stdin handle.
    pub child_stdin: tokio::sync::Mutex<Option<tokio::process::ChildStdin>>,
    /// Active Python child process handle.
    pub child_process: tokio::sync::Mutex<Option<tokio::process::Child>>,
    /// Currently running agent ID.
    pub current_agent_id: Mutex<Option<String>>,
}

// =============================================================================
// IPC Command Handlers — Keyring
// =============================================================================

/// Store a Gemini API key in the OS keyring (or encrypted fallback vault).
#[tauri::command]
async fn store_api_key(key: String) -> Result<String, String> {
    keyring::store_gemini_key(&key).map_err(|e| e.to_string())?;
    Ok("API key stored securely".into())
}

/// Retrieve the stored Gemini API key.
#[tauri::command]
async fn get_api_key() -> Result<Option<String>, String> {
    keyring::get_gemini_key().map_err(|e| e.to_string())
}

/// Delete the stored Gemini API key from the keyring/vault.
#[tauri::command]
async fn delete_api_key() -> Result<String, String> {
    keyring::delete_gemini_key().map_err(|e| e.to_string())?;
    Ok("API key deleted".into())
}

/// Check whether a Gemini API key exists without revealing its value.
#[tauri::command]
async fn has_api_key() -> Result<bool, String> {
    keyring::has_gemini_key().map_err(|e| e.to_string())
}

// =============================================================================
// IPC Command Handlers — Bootstrap & Provisioning
// =============================================================================

/// Run a complete pre-flight diagnostics check.
#[tauri::command]
async fn run_preflight_check() -> Result<bootstrap::PreflightReport, String> {
    bootstrap::run_preflight().await.map_err(|e| e.to_string())
}

/// Auto-provision a missing dependency component.
#[tauri::command]
async fn auto_provision(component: String) -> Result<String, String> {
    bootstrap::auto_provision(&component)
        .await
        .map_err(|e| e.to_string())
}

// =============================================================================
// IPC Command Handlers — Database CRUD
// =============================================================================

/// List all saved agent definitions from the local database.
#[tauri::command]
fn get_agents(state: tauri::State<'_, AppState>) -> Result<Vec<database::AgentRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.list_agents().map_err(|e| e.to_string())
}

/// Persist a new or updated agent definition.
#[tauri::command]
fn save_agent(
    state: tauri::State<'_, AppState>,
    agent: database::AgentRecord,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_agent(&agent).map_err(|e| e.to_string())?;
    Ok("Agent saved".into())
}

/// Delete an agent definition from the local database.
#[tauri::command]
fn delete_agent(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_agent(&id).map_err(|e| e.to_string())?;
    Ok("Agent deleted".into())
}

/// Retrieve the execution history for a specific agent.
#[tauri::command]
fn get_execution_history(
    state: tauri::State<'_, AppState>,
    agent_id: String,
) -> Result<Vec<database::ExecutionLog>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_execution_history(&agent_id)
        .map_err(|e| e.to_string())
}

// =============================================================================
// IPC Command Handlers — Agent Execution & Sidecar Control
// =============================================================================

/// Start an automation task: creates the AgentRecord in SQLite and spawns Python engine.
#[tauri::command]
async fn start_agent_task(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    api_key: Option<String>,
) -> Result<database::AgentRecord, String> {
    let trimmed_prompt = prompt.trim().to_string();
    if trimmed_prompt.is_empty() {
        return Err("Prompt cannot be empty".into());
    }

    // 1. Resolve API key (supports cloud Gemini or built-in local engine)
    let key = if let Some(k) = api_key {
        let trimmed_k = k.trim().to_string();
        if !trimmed_k.is_empty() {
            let _ = keyring::store_gemini_key(&trimmed_k);
            trimmed_k
        } else {
            keyring::get_gemini_key()
                .unwrap_or(None)
                .unwrap_or_else(|| "local-mode".to_string())
        }
    } else {
        keyring::get_gemini_key()
            .unwrap_or(None)
            .unwrap_or_else(|| "local-mode".to_string())
    };

    let key = if key.trim().is_empty() {
        "local-mode".to_string()
    } else {
        key
    };

    // 2. Kill any currently running sidecar process
    {
        let mut child_guard = state.child_process.lock().await;
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill().await;
        }
        let mut stdin_guard = state.child_stdin.lock().await;
        *stdin_guard = None;
    }

    // 3. Create AgentRecord and save to SQLite
    let agent_id = uuid::Uuid::new_v4().to_string();
    let title = if trimmed_prompt.len() > 36 {
        format!("{}...", &trimmed_prompt[..36])
    } else {
        trimmed_prompt.clone()
    };

    let mut agent = database::AgentRecord::new(
        title,
        trimmed_prompt.clone(),
        trimmed_prompt.clone(),
        "{}".into(),
    );
    agent.id = agent_id.clone();
    agent.status = "running".into();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.save_agent(&agent).map_err(|e| e.to_string())?;
    }
    {
        let mut curr = state.current_agent_id.lock().map_err(|e| e.to_string())?;
        *curr = Some(agent_id.clone());
    }

    // 4. Resolve Python executable
    let home = std::env::var("HOME").unwrap_or_else(|_| "".into());
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

    let python_candidates = [
        cwd.join("python-engine/.venv/bin/python"),
        std::path::PathBuf::from(format!("{}/.gemini/antigravity/scratch/rpa-agent-platform/python-engine/.venv/bin/python", home)),
        std::path::PathBuf::from(format!("{}/.local/share/uv/python/cpython-3.11-macos-aarch64-none/bin/python3.11", home)),
        std::path::PathBuf::from(format!("{}/.local/bin/python3", home)),
        std::path::PathBuf::from("python3"),
        std::path::PathBuf::from("python"),
    ];

    let mut python_bin = "python3".to_string();
    for cand in &python_candidates {
        if cand.exists() {
            python_bin = cand.to_string_lossy().to_string();
            break;
        }
    }

    // 5. Paths
    let main_py_candidates = [
        cwd.join("python-engine/main.py"),
        std::path::PathBuf::from(format!("{}/.gemini/antigravity/scratch/rpa-agent-platform/python-engine/main.py", home)),
    ];

    let mut main_py = format!("{}/.gemini/antigravity/scratch/rpa-agent-platform/python-engine/main.py", home);
    let mut working_dir = format!("{}/.gemini/antigravity/scratch/rpa-agent-platform/python-engine", home);

    for cand in &main_py_candidates {
        if cand.exists() {
            main_py = cand.to_string_lossy().to_string();
            if let Some(parent) = cand.parent() {
                working_dir = parent.to_string_lossy().to_string();
            }
            break;
        }
    }

    tracing::info!("Spawning Python engine with {} at {}", python_bin, main_py);

    // 6. Spawn Python process
    let mut cmd = tokio::process::Command::new(&python_bin);
    cmd.arg(&main_py)
        .current_dir(&working_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Ok(curr_path) = std::env::var("PATH") {
        let enhanced_path = format!("{}/.cargo/bin:{}/.local/bin:{}/.local/node/bin:{}", home, home, home, curr_path);
        cmd.env("PATH", enhanced_path);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!("Failed to spawn Python process ({python_bin}): {e}")
    })?;

    let stdin = child.stdin.take().ok_or("Failed to open child stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to open child stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open child stderr")?;

    // Store stdin & process handle
    {
        let mut stdin_guard = state.child_stdin.lock().await;
        *stdin_guard = Some(stdin);
        let mut child_guard = state.child_process.lock().await;
        *child_guard = Some(child);
    }

    // 7. Write start payload to stdin
    let start_msg = serde_json::json!({
        "type": "start",
        "data": {
            "prompt": trimmed_prompt,
            "api_key": key,
            "thread_id": agent_id.clone()
        }
    });

    {
        let mut stdin_guard = state.child_stdin.lock().await;
        if let Some(ref mut s) = *stdin_guard {
            use tokio::io::AsyncWriteExt;
            let mut line = serde_json::to_string(&start_msg).map_err(|e| e.to_string())?;
            line.push('\n');
            s.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
            s.flush().await.map_err(|e| e.to_string())?;
        }
    }

    // 8. Background stdout streaming task
    let app_stdout = app.clone();
    let db_stdout = state.db.clone();
    let agent_id_stdout = agent_id.clone();

    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut reader = tokio::io::BufReader::new(stdout).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Emit raw event to frontend
            let _ = app_stdout.emit("agent-event", trimmed);

            // Parse and sync DB records
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

                if msg_type == "manifest" {
                    if let Some(manifest) = val.get("data") {
                        let manifest_str = serde_json::to_string(manifest).unwrap_or_else(|_| "{}".into());
                        let title = manifest.get("title").and_then(|t| t.as_str()).unwrap_or("RPA Agent");
                        if let Ok(db) = db_stdout.lock() {
                            let _ = db.save_agent(&database::AgentRecord {
                                id: agent_id_stdout.clone(),
                                name: title.to_string(),
                                description: manifest.get("description").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                                prompt: String::new(),
                                manifest_json: manifest_str,
                                status: "running".into(),
                                created_at: String::new(),
                                updated_at: String::new(),
                            });
                        }
                    }
                } else if msg_type == "completed" {
                    if let Ok(db) = db_stdout.lock() {
                        let _ = db.update_agent_status(&agent_id_stdout, "idle");
                        let _ = db.log_execution_step(
                            &agent_id_stdout,
                            "finalization",
                            "success",
                            "",
                            &trimmed,
                            None,
                        );
                    }
                } else if msg_type == "error" || msg_type == "rejected" {
                    if let Ok(db) = db_stdout.lock() {
                        let _ = db.update_agent_status(&agent_id_stdout, "error");
                        let err_msg = val.get("data").and_then(|d| d.get("message").or_else(|| d.get("reason"))).and_then(|m| m.as_str());
                        let _ = db.log_execution_step(
                            &agent_id_stdout,
                            "execution",
                            "error",
                            "",
                            "",
                            err_msg,
                        );
                    }
                } else if msg_type == "hitl_pause" {
                    if let Ok(db) = db_stdout.lock() {
                        let _ = db.update_agent_status(&agent_id_stdout, "paused");
                    }
                }
            }
        }
    });

    // 9. Background stderr streaming task
    let app_stderr = app.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut reader = tokio::io::BufReader::new(stderr).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                tracing::warn!("[python:stderr] {}", trimmed);
                let err_payload = serde_json::json!({
                    "type": "stderr",
                    "data": { "message": trimmed }
                });
                let _ = app_stderr.emit("agent-event", err_payload.to_string());
            }
        }
    });

    Ok(agent)
}

/// Send input payload to the running Python sidecar stdin (for HITL approval or feedback).
#[tauri::command]
async fn send_agent_input(state: tauri::State<'_, AppState>, input: String) -> Result<(), String> {
    let mut stdin_guard = state.child_stdin.lock().await;
    if let Some(ref mut s) = *stdin_guard {
        use tokio::io::AsyncWriteExt;
        let mut line = input;
        if !line.ends_with('\n') {
            line.push('\n');
        }
        s.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        s.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No active sidecar process to receive input.".into())
    }
}

/// Stop or cancel the currently active automation task.
#[tauri::command]
async fn stop_agent_task(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut child_guard = state.child_process.lock().await;
    if let Some(mut child) = child_guard.take() {
        let _ = child.kill().await;
    }
    let mut stdin_guard = state.child_stdin.lock().await;
    *stdin_guard = None;

    if let Ok(guard) = state.current_agent_id.lock() {
        if let Some(ref agent_id) = *guard {
            if let Ok(db) = state.db.lock() {
                let _ = db.update_agent_status(agent_id, "idle");
            }
        }
    }
    Ok(())
}

/// Open a file in macOS Finder or default system handler.
#[tauri::command]
fn open_file_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// =============================================================================
// Application Bootstrap
// =============================================================================

fn main() {
    tracing_subscriber::fmt::init();
    tracing::info!("Initializing RPA Agent Platform...");

    let db = database::Database::new().expect("Failed to initialize database");
    db.initialize_schema().expect("Failed to initialize database schema");
    tracing::info!("Database initialized successfully");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: Arc::new(Mutex::new(db)),
            child_stdin: tokio::sync::Mutex::new(None),
            child_process: tokio::sync::Mutex::new(None),
            current_agent_id: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            store_api_key,
            get_api_key,
            delete_api_key,
            has_api_key,
            run_preflight_check,
            auto_provision,
            get_agents,
            save_agent,
            delete_agent,
            get_execution_history,
            start_agent_task,
            send_agent_input,
            stop_agent_task,
            open_file_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
