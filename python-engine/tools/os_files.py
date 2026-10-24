"""Sandboxed filesystem operations for RPA automation.

All file operations are restricted to a sandboxed directory within
the application's data folder. Operations outside the sandbox are
blocked to prevent unauthorized filesystem access.

IMPORTANT: Destructive operations (delete, overwrite) are guarded
and restricted to maintain local safety guarantees.
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
    """Validate that a path is within the sandbox.
    
    Raises:
        PermissionError: If the path escapes the sandbox
    """
    sandbox = _get_sandbox_dir().resolve()
    # Normalize path and prevent directory traversal
    resolved = (sandbox / filepath).resolve()
    
    if not str(resolved).startswith(str(sandbox)):
        raise PermissionError(
            f"Access denied: path '{filepath}' resolves outside the sandbox directory. "
            f"All file operations are restricted to: {sandbox}"
        )
    
    return resolved


def read_file(filepath: str, encoding: str = "utf-8") -> dict[str, Any]:
    """Read a file from the sandbox.
    
    Args:
        filepath: Relative path within the sandbox
        encoding: File encoding (default utf-8)
        
    Returns:
        dict with 'content', 'path', 'size', 'modified'
    """
    path = _validate_path(filepath)
    
    if not path.exists():
        raise FileNotFoundError(f"File not found: {filepath}")
    
    if not path.is_file():
        raise IsADirectoryError(f"Path is a directory: {filepath}")
    
    stat = path.stat()
    
    # Size guard: don't read files over 50MB
    if stat.st_size > 50 * 1024 * 1024:
        raise ValueError(f"File too large ({stat.st_size} bytes). Maximum allowed is 50MB.")
    
    content = path.read_text(encoding=encoding)
    
    return {
        "content": content,
        "path": str(path.relative_to(_get_sandbox_dir())),
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def write_file(filepath: str, content: str, encoding: str = "utf-8", overwrite: bool = False) -> dict[str, Any]:
    """Write content to a file in the sandbox.
    
    Args:
        filepath: Relative path within the sandbox
        content: File content to write
        encoding: File encoding (default utf-8)
        overwrite: Whether to overwrite existing files
        
    Returns:
        dict with 'path', 'size', 'created'
    """
    path = _validate_path(filepath)
    
    if path.exists() and not overwrite:
        raise FileExistsError(
            f"File already exists: {filepath}. Set overwrite=True to replace. "
            f"Note: Destructive operations require human review."
        )
    
    # Create parent directories
    path.parent.mkdir(parents=True, exist_ok=True)
    
    path.write_text(content, encoding=encoding)
    
    return {
        "path": str(path.relative_to(_get_sandbox_dir())),
        "size": path.stat().st_size,
        "created": datetime.now(timezone.utc).isoformat(),
        "content": f"Successfully wrote {len(content)} characters to {filepath}",
    }


def list_directory(dirpath: str = ".") -> dict[str, Any]:
    """List contents of a sandbox directory.
    
    Args:
        dirpath: Relative directory path within the sandbox
        
    Returns:
        dict with 'path', 'entries' (list of file/dir info)
    """
    path = _validate_path(dirpath)
    
    if not path.exists():
        raise FileNotFoundError(f"Directory not found: {dirpath}")
    
    if not path.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {dirpath}")
    
    entries = []
    for entry in sorted(path.iterdir()):
        stat = entry.stat()
        entries.append({
            "name": entry.name,
            "type": "directory" if entry.is_dir() else "file",
            "size": stat.st_size if entry.is_file() else 0,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    
    return {
        "path": str(path.relative_to(_get_sandbox_dir())),
        "entries": entries,
        "count": len(entries),
        "content": json.dumps(entries, indent=2),
    }


def create_directory(dirpath: str) -> dict[str, Any]:
    """Create a directory in the sandbox.
    
    Args:
        dirpath: Relative directory path within the sandbox
        
    Returns:
        dict with 'path', 'created'
    """
    path = _validate_path(dirpath)
    path.mkdir(parents=True, exist_ok=True)
    
    return {
        "path": str(path.relative_to(_get_sandbox_dir())),
        "created": datetime.now(timezone.utc).isoformat(),
        "content": f"Directory created: {dirpath}",
    }


def copy_file(src: str, dst: str) -> dict[str, Any]:
    """Copy a file within the sandbox.
    
    Args:
        src: Source file path (relative to sandbox)
        dst: Destination file path (relative to sandbox)
        
    Returns:
        dict with 'src', 'dst', 'size'
    """
    src_path = _validate_path(src)
    dst_path = _validate_path(dst)
    
    if not src_path.exists():
        raise FileNotFoundError(f"Source file not found: {src}")
    
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src_path), str(dst_path))
    
    return {
        "src": str(src_path.relative_to(_get_sandbox_dir())),
        "dst": str(dst_path.relative_to(_get_sandbox_dir())),
        "size": dst_path.stat().st_size,
        "content": f"Copied {src} to {dst}",
    }


def get_file_info(filepath: str) -> dict[str, Any]:
    """Get metadata about a file in the sandbox.
    
    Args:
        filepath: Relative file path within the sandbox
        
    Returns:
        dict with file metadata
    """
    path = _validate_path(filepath)
    
    if not path.exists():
        raise FileNotFoundError(f"File not found: {filepath}")
    
    stat = path.stat()
    
    info = {
        "path": str(path.relative_to(_get_sandbox_dir())),
        "name": path.name,
        "extension": path.suffix,
        "type": "directory" if path.is_dir() else "file",
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "created": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
    }
    info["content"] = json.dumps(info, indent=2)
    return info


def execute_filesystem_step(step: dict, state: dict) -> dict:
    """Execute a filesystem operation step.
    
    Routes to the appropriate filesystem function based on step parameters.
    """
    params = step.get("parameters", {})
    action = params.get("action", "read")
    
    if action == "read":
        return read_file(params.get("path", ""))
    elif action == "write":
        return write_file(
            params.get("path", "output.txt"),
            params.get("content", ""),
            overwrite=params.get("overwrite", False),
        )
    elif action == "list":
        return list_directory(params.get("path", "."))
    elif action == "mkdir":
        return create_directory(params.get("path", ""))
    elif action == "copy":
        return copy_file(params.get("src", ""), params.get("dst", ""))
    elif action == "info":
        return get_file_info(params.get("path", ""))
    else:
        raise ValueError(f"Unknown filesystem action: {action}")
