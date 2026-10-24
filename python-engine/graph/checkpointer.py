"""SQLite-backed checkpointer for LangGraph state persistence.

Enables Human-in-the-Loop (HITL) by persisting graph state at
interrupt points, allowing execution to resume after human review.
"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from langgraph.checkpoint.base import BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple


class SQLiteCheckpointer(BaseCheckpointSaver):
    """Persists LangGraph checkpoints to a local SQLite database.
    
    Supports the HITL flow by saving state when the graph hits an
    interrupt() node, allowing the frontend to collect human feedback
    and resume execution.
    """
    
    def __init__(self, db_path: Optional[str] = None):
        super().__init__()
        if db_path is None:
            data_dir = os.path.join(
                os.environ.get("RPA_DATA_DIR", os.path.expanduser("~/.rpa-agent-platform")),
                "checkpoints"
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
                checkpoint BLOB NOT NULL,
                metadata BLOB NOT NULL,
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
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: Optional[dict] = None,
    ) -> dict:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = checkpoint["id"]
        parent_id = config["configurable"].get("checkpoint_id")
        
        self.conn.execute(
            """INSERT OR REPLACE INTO checkpoints 
               (thread_id, checkpoint_id, parent_checkpoint_id, checkpoint, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                thread_id,
                checkpoint_id,
                parent_id,
                json.dumps(checkpoint),
                json.dumps(metadata),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        self.conn.commit()
        
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id,
            }
        }
    
    def get_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = config["configurable"].get("checkpoint_id")
        
        if checkpoint_id:
            row = self.conn.execute(
                "SELECT checkpoint, metadata, parent_checkpoint_id FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?",
                (thread_id, checkpoint_id),
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT checkpoint, metadata, parent_checkpoint_id, checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1",
                (thread_id,),
            ).fetchone()
            if row:
                checkpoint_id = row[3]
                row = row[:3]
        
        if row is None:
            return None
        
        checkpoint = json.loads(row[0])
        metadata = json.loads(row[1])
        parent_id = row[2]
        
        parent_config = None
        if parent_id:
            parent_config = {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_id": parent_id,
                }
            }
        
        return CheckpointTuple(
            config={
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_id": checkpoint_id,
                }
            },
            checkpoint=checkpoint,
            metadata=metadata,
            parent_config=parent_config,
        )
    
    def list(self, config: dict, *, filter: Optional[dict] = None, before: Optional[dict] = None, limit: Optional[int] = None):
        thread_id = config["configurable"]["thread_id"]
        query = "SELECT checkpoint, metadata, checkpoint_id, parent_checkpoint_id FROM checkpoints WHERE thread_id = ?"
        params: list[Any] = [thread_id]
        
        if before:
            query += " AND created_at < (SELECT created_at FROM checkpoints WHERE checkpoint_id = ? AND thread_id = ?)"
            params.extend([before["configurable"]["checkpoint_id"], thread_id])
        
        query += " ORDER BY created_at DESC"
        
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        
        for row in self.conn.execute(query, params):
            checkpoint = json.loads(row[0])
            metadata = json.loads(row[1])
            cid = row[2]
            parent_id = row[3]
            
            parent_config = None
            if parent_id:
                parent_config = {"configurable": {"thread_id": thread_id, "checkpoint_id": parent_id}}
            
            yield CheckpointTuple(
                config={"configurable": {"thread_id": thread_id, "checkpoint_id": cid}},
                checkpoint=checkpoint,
                metadata=metadata,
                parent_config=parent_config,
            )
    
    def close(self):
        self.conn.close()
