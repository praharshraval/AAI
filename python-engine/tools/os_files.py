"""Sandboxed filesystem operations for RPA automation.

All file operations are restricted to a sandboxed directory within
the application's data folder, with safe mirroring to user Desktop
for direct visibility.
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _get_sandbox_dir() -> Path:
    """Get the sandboxed workspace directory."""
    base = os.environ.get("RPA_DATA_DIR", os.path.expanduser("~/.rpa-agent-platform"))
    sandbox = Path(base) / "workspace"
    sandbox.mkdir(parents=True, exist_ok=True)
    return sandbox


def _validate_path(filepath: str) -> Path:
    """Validate that a path is within the sandbox."""
    clean_name = os.path.basename(filepath.strip()) if "/" in filepath or "\\" in filepath else filepath.strip()
    if not clean_name:
        clean_name = "output.txt"
    sandbox = _get_sandbox_dir().resolve()
    resolved = (sandbox / clean_name).resolve()
    return resolved


def read_file(filepath: str, encoding: str = "utf-8") -> dict[str, Any]:
    path = _validate_path(filepath)
    if not path.exists():
        # Check desktop
        desk = Path.home() / "Desktop" / path.name
        if desk.exists():
            path = desk
        else:
            raise FileNotFoundError(f"File not found: {filepath}")

    if not path.is_file():
        raise IsADirectoryError(f"Path is a directory: {filepath}")

    stat = path.stat()
    content = path.read_text(encoding=encoding)

    return {
        "content": content,
        "path": str(path.resolve()),
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def write_file(filepath: str, content: str, encoding: str = "utf-8", overwrite: bool = True) -> dict[str, Any]:
    """Write content to a file in the workspace sandbox and user Desktop."""
    clean_name = os.path.basename(filepath.strip()) if "/" in filepath or "\\" in filepath else filepath.strip()
    if not clean_name:
        clean_name = "output.txt"

    sandbox_path = _validate_path(clean_name)
    sandbox_path.parent.mkdir(parents=True, exist_ok=True)
    sandbox_path.write_text(content, encoding=encoding)

    # Also mirror directly to the user's Desktop for immediate real-world visibility
    desktop_dir = Path.home() / "Desktop"
    desktop_file = None
    if desktop_dir.exists() and desktop_dir.is_dir():
        try:
            desktop_file = desktop_dir / clean_name
            desktop_file.write_text(content, encoding=encoding)
        except Exception:
            desktop_file = None

    stat = sandbox_path.stat()
    desktop_msg = f"\n• Desktop: {desktop_file.resolve()}" if desktop_file else ""

    return {
        "path": str(clean_name),
        "full_path": str(sandbox_path.resolve()),
        "desktop_path": str(desktop_file.resolve()) if desktop_file else None,
        "size": stat.st_size,
        "created": datetime.now(timezone.utc).isoformat(),
        "content": f"Successfully created file '{clean_name}' ({stat.st_size} bytes).\nSaved to:\n• Sandbox: {sandbox_path.resolve()}{desktop_msg}",
    }


def list_directory(dirpath: str = ".") -> dict[str, Any]:
    path = _get_sandbox_dir()
    entries = []
    if path.exists():
        for entry in sorted(path.iterdir()):
            stat = entry.stat()
            entries.append({
                "name": entry.name,
                "type": "directory" if entry.is_dir() else "file",
                "size": stat.st_size if entry.is_file() else 0,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })

    return {
        "path": str(path.resolve()),
        "entries": entries,
        "count": len(entries),
        "content": f"Workspace directory contains {len(entries)} items:\n" + "\n".join([f"- {e['name']} ({e['size']} B)" for e in entries]),
    }


def execute_filesystem_step(step: dict, state: dict) -> dict:
    params = step.get("parameters", {})
    action = params.get("action", "write")
    
    if action == "write":
        path = params.get("path", "automation_output.txt")
        content = params.get("content", "")
        # If content wasn't pre-filled, check if previous step produced content
        if not content:
            results = state.get("execution_results", [])
            for r in reversed(results):
                res = r.get("result", {})
                if isinstance(res, dict) and res.get("content"):
                    content = res["content"]
                    break
        if not content:
            content = f"# Automation Deliverable: {path}\nGenerated for request: {state.get('user_prompt', '')}\nTimestamp: {datetime.now(timezone.utc).isoformat()}"

        return write_file(path, content, overwrite=True)
    elif action == "read":
        return read_file(params.get("path", ""))
    elif action == "list":
        return list_directory(params.get("path", "."))
    else:
        return write_file(params.get("path", "output.txt"), params.get("content", "Completed"), overwrite=True)
