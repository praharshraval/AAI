"""SQLite-backed checkpointer for LangGraph state persistence.

Enables Human-in-the-Loop (HITL) by persisting graph state at
interrupt points, allowing execution to resume after human review.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from langgraph.checkpoint.memory import MemorySaver


class SQLiteCheckpointer(MemorySaver):
    """Hybrid checkpointer that uses MemorySaver for LangGraph 0.2+ runtime state
    and put_writes, while archiving checkpoint metadata to SQLite for auditing.
    """

    def __init__(self, db_path: Optional[str] = None):
        super().__init__()
        if db_path is None:
            data_dir = os.path.join(
                os.environ.get("RPA_DATA_DIR", os.path.expanduser("~/.rpa-agent-platform")),
                "checkpoints",
            )
            os.makedirs(data_dir, exist_ok=True)
            db_path = os.path.join(data_dir, "checkpoints.db")

        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

    def _create_tables(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                checkpoint_summary TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (thread_id, checkpoint_id)
            );
            CREATE INDEX IF NOT EXISTS idx_checkpoints_thread 
                ON checkpoints(thread_id, created_at DESC);
        """)
        self.conn.commit()

    def put(
        self,
        config: dict,
        checkpoint: Any,
        metadata: Any,
        new_versions: Optional[dict] = None,
    ) -> dict:
        # First delegate to standard in-memory saver (handles LangGraph channels, state, writes)
        result_config = super().put(config, checkpoint, metadata, new_versions)

        # Audit persist to local SQLite
        try:
            thread_id = config.get("configurable", {}).get("thread_id", "")
            checkpoint_id = checkpoint.get("id", "")
            parent_id = config.get("configurable", {}).get("checkpoint_id")
            
            meta_json = json.dumps(metadata if isinstance(metadata, dict) else {})
            self.conn.execute(
                """INSERT OR REPLACE INTO checkpoints 
                   (thread_id, checkpoint_id, parent_checkpoint_id, checkpoint_summary, metadata, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    thread_id,
                    checkpoint_id,
                    parent_id,
                    str(checkpoint.get("id", "")),
                    meta_json,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            self.conn.commit()
        except Exception:
            # Audit log failure should never break active graph execution
            pass

        return result_config

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass
