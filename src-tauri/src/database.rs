//! # SQLite WAL Database Manager
//!
//! This module manages all local persistent storage for the RPA Agent Platform
//! using SQLite in WAL (Write-Ahead Logging) mode for concurrent read
//! performance. The database stores:
//!
//! - **Agent definitions** — prompts, manifests, and metadata for each
//!   configured automation agent.
//! - **Execution logs** — step-by-step audit trail of every agent run.
//!
//! The database file is stored at:
//! `<data_local_dir>/rpa-agent-platform/data.db`

use chrono::Utc;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during database operations.
#[derive(Error, Debug)]
pub enum DatabaseError {
    /// An underlying SQLite error.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// The application data directory could not be determined.
    #[error("Could not determine application data directory")]
    NoDataDir,

    /// An I/O error (e.g., creating parent directories).
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// The requested record was not found.
    #[error("Record not found: {0}")]
    NotFound(String),
}

// =============================================================================
// Data Models
// =============================================================================

/// Persistent record for a configured RPA agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecord {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// Human-readable agent name.
    pub name: String,
    /// Free-text description of what the agent does.
    pub description: String,
    /// The natural-language prompt that drives the agent's behaviour.
    pub prompt: String,
    /// JSON-serialized manifest defining steps, selectors, and configuration.
    pub manifest_json: String,
    /// Current status: `idle`, `running`, `paused`, or `error`.
    pub status: String,
    /// ISO-8601 timestamp of initial creation.
    pub created_at: String,
    /// ISO-8601 timestamp of the most recent update.
    pub updated_at: String,
}

impl AgentRecord {
    /// Create a new `AgentRecord` with a fresh UUID and timestamps set to now.
    pub fn new(name: String, description: String, prompt: String, manifest_json: String) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            prompt,
            manifest_json,
            status: "idle".to_string(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

/// A single step in an agent's execution log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionLog {
    /// Unique identifier for this log entry.
    pub id: String,
    /// The agent that produced this log entry.
    pub agent_id: String,
    /// Human-readable name of the execution step.
    pub step_name: String,
    /// Step status: `pending`, `running`, `success`, `error`, `skipped`.
    pub status: String,
    /// JSON-serialized input data for this step.
    pub input_json: String,
    /// JSON-serialized output data from this step.
    pub output_json: String,
    /// Optional error message if the step failed.
    pub error_message: Option<String>,
    /// ISO-8601 timestamp when the step began.
    pub started_at: String,
    /// ISO-8601 timestamp when the step finished (if completed).
    pub completed_at: Option<String>,
}

// =============================================================================
// Database Handle
// =============================================================================

/// Thread-safe handle wrapping a SQLite connection.
///
/// This struct is designed to be stored inside a `Mutex` in the Tauri
/// application state. All methods take `&self` and operate on the inner
/// `Connection`.
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open (or create) the SQLite database and enable WAL mode.
    ///
    /// The database file is placed at
    /// `<data_local_dir>/rpa-agent-platform/data.db`.
    pub fn new() -> Result<Self, DatabaseError> {
        let db_path = Self::db_path()?;

        // Ensure the parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;

        // Enable WAL journal mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        // Enable foreign keys
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        tracing::info!("Database opened at {}", db_path.display());

        Ok(Self { conn })
    }

    /// Resolve the database file path.
    fn db_path() -> Result<PathBuf, DatabaseError> {
        let data_dir = dirs::data_local_dir().ok_or(DatabaseError::NoDataDir)?;
        Ok(data_dir.join("rpa-agent-platform").join("data.db"))
    }

    // =========================================================================
    // Schema Management
    // =========================================================================

    /// Create all required tables if they do not already exist.
    ///
    /// This method is idempotent and safe to call on every application launch.
    pub fn initialize_schema(&self) -> Result<(), DatabaseError> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS agents (
                id          TEXT PRIMARY KEY NOT NULL,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                prompt      TEXT NOT NULL DEFAULT '',
                manifest_json TEXT NOT NULL DEFAULT '{}',
                status      TEXT NOT NULL DEFAULT 'idle',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS execution_logs (
                id            TEXT PRIMARY KEY NOT NULL,
                agent_id      TEXT NOT NULL,
                step_name     TEXT NOT NULL,
                status        TEXT NOT NULL DEFAULT 'pending',
                input_json    TEXT NOT NULL DEFAULT '{}',
                output_json   TEXT NOT NULL DEFAULT '{}',
                error_message TEXT,
                started_at    TEXT NOT NULL,
                completed_at  TEXT,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_execution_logs_agent_id
                ON execution_logs(agent_id);

            CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at
                ON execution_logs(started_at);
            ",
        )?;

        tracing::info!("Database schema initialized");
        Ok(())
    }

    // =========================================================================
    // Agent CRUD
    // =========================================================================

    /// Insert or replace an agent record (upsert semantics).
    pub fn save_agent(&self, agent: &AgentRecord) -> Result<(), DatabaseError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO agents
                (id, name, description, prompt, manifest_json, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                agent.id,
                agent.name,
                agent.description,
                agent.prompt,
                agent.manifest_json,
                agent.status,
                agent.created_at,
                agent.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Retrieve all agent records, ordered by creation time (newest first).
    pub fn list_agents(&self) -> Result<Vec<AgentRecord>, DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, prompt, manifest_json, status, created_at, updated_at
             FROM agents
             ORDER BY created_at DESC",
        )?;

        let agents = stmt
            .query_map([], |row| {
                Ok(AgentRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    prompt: row.get(3)?,
                    manifest_json: row.get(4)?,
                    status: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(agents)
    }

    /// Retrieve a single agent by its UUID.
    pub fn get_agent_by_id(&self, id: &str) -> Result<AgentRecord, DatabaseError> {
        self.conn
            .query_row(
                "SELECT id, name, description, prompt, manifest_json, status, created_at, updated_at
                 FROM agents
                 WHERE id = ?1",
                params![id],
                |row| {
                    Ok(AgentRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        prompt: row.get(3)?,
                        manifest_json: row.get(4)?,
                        status: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    DatabaseError::NotFound(format!("Agent {id} not found"))
                }
                other => DatabaseError::Sqlite(other),
            })
    }

    /// Update only the status field of an existing agent.
    ///
    /// Also bumps the `updated_at` timestamp.
    pub fn update_agent_status(&self, id: &str, status: &str) -> Result<(), DatabaseError> {
        let now = Utc::now().to_rfc3339();
        let rows = self.conn.execute(
            "UPDATE agents SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, id],
        )?;

        if rows == 0 {
            return Err(DatabaseError::NotFound(format!("Agent {id} not found")));
        }
        Ok(())
    }

    /// Delete an agent and all associated execution logs.
    pub fn delete_agent(&self, id: &str) -> Result<(), DatabaseError> {
        self.conn.execute(
            "DELETE FROM agents WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    // =========================================================================
    // Execution Logs
    // =========================================================================

    /// Record a new execution step in the audit log.
    ///
    /// Returns the generated log entry UUID.
    pub fn log_execution_step(
        &self,
        agent_id: &str,
        step_name: &str,
        status: &str,
        input_json: &str,
        output_json: &str,
        error_message: Option<&str>,
    ) -> Result<String, DatabaseError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let completed_at: Option<String> = if status == "success" || status == "error" {
            Some(now.clone())
        } else {
            None
        };

        self.conn.execute(
            "INSERT INTO execution_logs
                (id, agent_id, step_name, status, input_json, output_json, error_message, started_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                agent_id,
                step_name,
                status,
                input_json,
                output_json,
                error_message,
                now,
                completed_at,
            ],
        )?;

        Ok(id)
    }

    /// Retrieve the execution history for a given agent, newest first.
    ///
    /// Returns up to 500 log entries to prevent unbounded memory usage.
    pub fn get_execution_history(
        &self,
        agent_id: &str,
    ) -> Result<Vec<ExecutionLog>, DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, agent_id, step_name, status, input_json, output_json,
                    error_message, started_at, completed_at
             FROM execution_logs
             WHERE agent_id = ?1
             ORDER BY started_at DESC
             LIMIT 500",
        )?;

        let logs = stmt
            .query_map(params![agent_id], |row| {
                Ok(ExecutionLog {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    step_name: row.get(2)?,
                    status: row.get(3)?,
                    input_json: row.get(4)?,
                    output_json: row.get(5)?,
                    error_message: row.get(6)?,
                    started_at: row.get(7)?,
                    completed_at: row.get(8)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(logs)
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory database for testing.
    fn test_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        let db = Database { conn };
        db.initialize_schema().unwrap();
        db
    }

    #[test]
    fn test_save_and_list_agents() {
        let db = test_db();
        let agent = AgentRecord::new(
            "Test Agent".into(),
            "A test agent".into(),
            "Do the thing".into(),
            "{}".into(),
        );

        db.save_agent(&agent).unwrap();
        let agents = db.list_agents().unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "Test Agent");
    }

    #[test]
    fn test_get_agent_by_id() {
        let db = test_db();
        let agent = AgentRecord::new(
            "Lookup Agent".into(),
            "desc".into(),
            "prompt".into(),
            "{}".into(),
        );
        let id = agent.id.clone();

        db.save_agent(&agent).unwrap();
        let found = db.get_agent_by_id(&id).unwrap();
        assert_eq!(found.name, "Lookup Agent");
    }

    #[test]
    fn test_get_agent_not_found() {
        let db = test_db();
        let result = db.get_agent_by_id("nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn test_update_agent_status() {
        let db = test_db();
        let agent = AgentRecord::new(
            "Status Agent".into(),
            "desc".into(),
            "prompt".into(),
            "{}".into(),
        );
        let id = agent.id.clone();

        db.save_agent(&agent).unwrap();
        db.update_agent_status(&id, "running").unwrap();

        let updated = db.get_agent_by_id(&id).unwrap();
        assert_eq!(updated.status, "running");
    }

    #[test]
    fn test_execution_log_crud() {
        let db = test_db();

        // Create an agent first (FK constraint)
        let agent = AgentRecord::new(
            "Log Agent".into(),
            "desc".into(),
            "prompt".into(),
            "{}".into(),
        );
        let agent_id = agent.id.clone();
        db.save_agent(&agent).unwrap();

        // Log a step
        let log_id = db
            .log_execution_step(
                &agent_id,
                "navigate",
                "success",
                r#"{"url":"https://example.com"}"#,
                r#"{"title":"Example"}"#,
                None,
            )
            .unwrap();

        assert!(!log_id.is_empty());

        // Retrieve history
        let history = db.get_execution_history(&agent_id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].step_name, "navigate");
        assert_eq!(history[0].status, "success");
        assert!(history[0].error_message.is_none());
        assert!(history[0].completed_at.is_some()); // success → auto-completed
    }

    #[test]
    fn test_execution_log_with_error() {
        let db = test_db();
        let agent = AgentRecord::new("Err Agent".into(), "d".into(), "p".into(), "{}".into());
        let agent_id = agent.id.clone();
        db.save_agent(&agent).unwrap();

        db.log_execution_step(
            &agent_id,
            "click",
            "error",
            "{}",
            "{}",
            Some("Element not found"),
        )
        .unwrap();

        let history = db.get_execution_history(&agent_id).unwrap();
        assert_eq!(history[0].error_message.as_deref(), Some("Element not found"));
    }

    #[test]
    fn test_upsert_agent() {
        let db = test_db();
        let mut agent =
            AgentRecord::new("Original".into(), "desc".into(), "prompt".into(), "{}".into());
        let id = agent.id.clone();

        db.save_agent(&agent).unwrap();

        // Update the name and re-save (upsert)
        agent.name = "Updated".into();
        db.save_agent(&agent).unwrap();

        let agents = db.list_agents().unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "Updated");
        assert_eq!(agents[0].id, id);
    }
}
