//! # Zero-CLI Auto-Bootstrap & Pre-flight System
//!
//! This module handles automatic detection and provisioning of runtime
//! dependencies required by the RPA engine. It provides:
//!
//! - **Pre-flight checks**: Detect OS/arch, locate Python 3.11+, pip,
//!   Playwright browsers, and the managed virtual environment.
//! - **Auto-provisioning**: Create a Python venv, install pip dependencies,
//!   and install Playwright Chromium — all without requiring the user to
//!   open a terminal.
//!
//! All runtime artifacts are stored under:
//! `<data_local_dir>/rpa-agent-platform/runtime/`

use serde::Serialize;
use std::path::PathBuf;
use thiserror::Error;
use tokio::process::Command;

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during bootstrap operations.
#[derive(Error, Debug)]
pub enum BootstrapError {
    /// A subprocess invocation failed.
    #[error("Command execution error: {0}")]
    CommandFailed(String),

    /// An I/O error (file system, process pipes, etc.).
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// The application data directory could not be resolved.
    #[error("Could not determine application data directory")]
    NoDataDir,

    /// The requested provisioning component is not recognized.
    #[error("Unknown provisioning component: {0}")]
    UnknownComponent(String),

    /// Python is not available on this system.
    #[error("Python 3.11+ is required but was not found")]
    PythonNotFound,

    /// A provisioning step produced an error exit code.
    #[error("Provisioning failed: {0}")]
    ProvisioningFailed(String),
}

// =============================================================================
// Pre-flight Report
// =============================================================================

/// Structured diagnostics report returned to the frontend after pre-flight checks.
#[derive(Debug, Clone, Serialize)]
pub struct PreflightReport {
    /// Human-readable OS name (e.g., "macos", "windows", "linux").
    pub os_info: String,
    /// CPU architecture (e.g., "x86_64", "aarch64").
    pub arch: String,
    /// Whether a suitable Python interpreter (≥ 3.11) was found.
    pub python_available: bool,
    /// The detected Python version string (e.g., "3.12.1").
    pub python_version: Option<String>,
    /// Absolute path to the detected Python executable.
    pub python_path: Option<String>,
    /// Whether pip (or pip3) is available.
    pub pip_available: bool,
    /// Whether Playwright browsers appear to be installed.
    pub playwright_installed: bool,
    /// Whether the managed virtual environment exists.
    pub venv_exists: bool,
    /// `true` only when every prerequisite is satisfied.
    pub all_ready: bool,
}

// =============================================================================
// Public API
// =============================================================================

/// Run a complete pre-flight diagnostics sweep.
///
/// This function is intentionally non-destructive — it only inspects the
/// system and never modifies it.
pub async fn run_preflight() -> Result<PreflightReport, BootstrapError> {
    let os_info = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    // Detect Python
    let (python_available, python_version, python_path) = detect_python().await;

    // Detect pip
    let pip_available = detect_pip().await;

    // Check for Playwright browsers
    let playwright_installed = detect_playwright().await;

    // Check managed venv
    let venv_path = runtime_dir()?.join("venv");
    let venv_exists = venv_path.exists() && venv_path.join(venv_bin_subdir()).join(python_bin_name()).exists();

    let all_ready = python_available && pip_available && playwright_installed && venv_exists;

    let report = PreflightReport {
        os_info,
        arch,
        python_available,
        python_version,
        python_path,
        pip_available,
        playwright_installed,
        venv_exists,
        all_ready,
    };

    tracing::info!("Pre-flight report: {:?}", report);
    Ok(report)
}

/// Auto-provision a specific component.
///
/// # Supported components
///
/// | Value          | Action                                       |
/// |----------------|----------------------------------------------|
/// | `"venv"`       | Create a Python virtual environment           |
/// | `"pip-deps"`   | Install `requirements.txt` into the venv      |
/// | `"playwright"` | Install Playwright Chromium browser            |
/// | `"all"`        | Run all of the above in sequence               |
pub async fn auto_provision(component: &str) -> Result<String, BootstrapError> {
    match component {
        "venv" => provision_venv().await,
        "pip-deps" => provision_pip_deps().await,
        "playwright" => provision_playwright().await,
        "all" => {
            provision_venv().await?;
            provision_pip_deps().await?;
            provision_playwright().await
        }
        other => Err(BootstrapError::UnknownComponent(other.to_string())),
    }
}

// =============================================================================
// Detection Helpers
// =============================================================================

/// Try to locate a Python ≥ 3.11 interpreter on the system PATH.
///
/// Searches for `python3`, `python`, and `python3.11` in order.
/// Returns `(found, version_string, path)`.
async fn detect_python() -> (bool, Option<String>, Option<String>) {
    let candidates = ["python3", "python", "python3.11"];

    for candidate in &candidates {
        if let Ok(output) = Command::new(candidate)
            .arg("--version")
            .output()
            .await
        {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).to_string();
                // Python prints "Python 3.x.y" — may be on stdout or stderr
                let raw = if version_output.trim().is_empty() {
                    String::from_utf8_lossy(&output.stderr).to_string()
                } else {
                    version_output
                };

                if let Some(version) = parse_python_version(&raw) {
                    if is_version_sufficient(&version) {
                        // Resolve absolute path
                        let path = resolve_executable_path(candidate).await;
                        tracing::info!(
                            "Found Python {} at {}",
                            version,
                            path.as_deref().unwrap_or("(unresolved)")
                        );
                        return (true, Some(version), path);
                    }
                }
            }
        }
    }

    tracing::warn!("No suitable Python 3.11+ interpreter found");
    (false, None, None)
}

/// Check whether pip or pip3 is available on the system PATH.
async fn detect_pip() -> bool {
    for candidate in &["pip3", "pip"] {
        if let Ok(output) = Command::new(candidate)
            .arg("--version")
            .output()
            .await
        {
            if output.status.success() {
                tracing::info!("Found pip: {}", candidate);
                return true;
            }
        }
    }

    // Also check inside managed venv
    if let Ok(venv_pip) = venv_executable("pip") {
        if venv_pip.exists() {
            tracing::info!("Found pip in managed venv");
            return true;
        }
    }

    false
}

/// Heuristically detect whether Playwright Chromium browsers are installed.
///
/// Checks the standard Playwright browser cache directories and also tries
/// running `playwright --version` from the managed venv.
async fn detect_playwright() -> bool {
    // Check common Playwright browser cache locations
    if let Some(home) = dirs::home_dir() {
        let pw_cache = home.join(".cache").join("ms-playwright");
        if pw_cache.exists() && has_chromium_dir(&pw_cache) {
            tracing::info!("Playwright Chromium found in cache");
            return true;
        }

        // macOS alternative path
        let pw_cache_mac = home
            .join("Library")
            .join("Caches")
            .join("ms-playwright");
        if pw_cache_mac.exists() && has_chromium_dir(&pw_cache_mac) {
            tracing::info!("Playwright Chromium found in macOS cache");
            return true;
        }
    }

    // Try running playwright from venv
    if let Ok(pw_path) = venv_executable("playwright") {
        if let Ok(output) = Command::new(&pw_path).arg("--version").output().await {
            if output.status.success() {
                return true;
            }
        }
    }

    false
}

/// Check if a directory contains a chromium-* subdirectory.
fn has_chromium_dir(path: &PathBuf) -> bool {
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("chromium-") {
                    return true;
                }
            }
        }
    }
    false
}

// =============================================================================
// Provisioning Steps
// =============================================================================

/// Create a Python virtual environment inside the managed runtime directory.
async fn provision_venv() -> Result<String, BootstrapError> {
    let (python_available, _version, python_path) = detect_python().await;
    if !python_available {
        return Err(BootstrapError::PythonNotFound);
    }

    let python = python_path.unwrap_or_else(|| "python3".to_string());
    let venv_path = runtime_dir()?.join("venv");

    tracing::info!("Creating Python venv at {}", venv_path.display());

    let output = Command::new(&python)
        .args(["-m", "venv", &venv_path.to_string_lossy()])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BootstrapError::ProvisioningFailed(format!(
            "venv creation failed: {stderr}"
        )));
    }

    tracing::info!("Python venv created successfully");
    Ok(format!(
        "Virtual environment created at {}",
        venv_path.display()
    ))
}

/// Install Python dependencies from `requirements.txt` into the managed venv.
///
/// Looks for `requirements.txt` in several locations:
/// 1. The runtime directory itself
/// 2. The Tauri resource directory (bundled with the app)
/// 3. The project root (development mode)
async fn provision_pip_deps() -> Result<String, BootstrapError> {
    let pip = venv_executable("pip")?;

    if !pip.exists() {
        return Err(BootstrapError::ProvisioningFailed(
            "pip not found in venv — create the venv first".into(),
        ));
    }

    // Locate requirements.txt
    let requirements = find_requirements_txt()?;

    tracing::info!(
        "Installing pip dependencies from {}",
        requirements.display()
    );

    let output = Command::new(&pip)
        .args([
            "install",
            "-r",
            &requirements.to_string_lossy(),
            "--quiet",
        ])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BootstrapError::ProvisioningFailed(format!(
            "pip install failed: {stderr}"
        )));
    }

    tracing::info!("pip dependencies installed successfully");
    Ok("Python dependencies installed successfully".into())
}

/// Install Playwright Chromium browser.
async fn provision_playwright() -> Result<String, BootstrapError> {
    let python = venv_executable(python_bin_name())?;

    if !python.exists() {
        return Err(BootstrapError::ProvisioningFailed(
            "Python venv not found — create the venv first".into(),
        ));
    }

    tracing::info!("Installing Playwright Chromium browser...");

    let output = Command::new(&python)
        .args(["-m", "playwright", "install", "chromium"])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BootstrapError::ProvisioningFailed(format!(
            "Playwright install failed: {stderr}"
        )));
    }

    tracing::info!("Playwright Chromium installed successfully");
    Ok("Playwright Chromium browser installed successfully".into())
}

// =============================================================================
// Path Utilities
// =============================================================================

/// Resolve the managed runtime directory, creating it if necessary.
///
/// Returns `<data_local_dir>/rpa-agent-platform/runtime/`.
fn runtime_dir() -> Result<PathBuf, BootstrapError> {
    let data_dir = dirs::data_local_dir().ok_or(BootstrapError::NoDataDir)?;
    let runtime = data_dir.join("rpa-agent-platform").join("runtime");
    std::fs::create_dir_all(&runtime)?;
    Ok(runtime)
}

/// Return the platform-specific subdirectory inside a venv that contains
/// executables (`bin` on Unix, `Scripts` on Windows).
fn venv_bin_subdir() -> &'static str {
    if cfg!(windows) {
        "Scripts"
    } else {
        "bin"
    }
}

/// Return the platform-specific name of the Python executable inside a venv.
fn python_bin_name() -> &'static str {
    if cfg!(windows) {
        "python.exe"
    } else {
        "python3"
    }
}

/// Build the path to an executable inside the managed venv.
fn venv_executable(name: &str) -> Result<PathBuf, BootstrapError> {
    let venv_path = runtime_dir()?.join("venv");
    let bin_name = if cfg!(windows) && !name.ends_with(".exe") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    Ok(venv_path.join(venv_bin_subdir()).join(bin_name))
}

/// Attempt to find `requirements.txt` in known locations.
fn find_requirements_txt() -> Result<PathBuf, BootstrapError> {
    // 1. Runtime directory
    let runtime = runtime_dir()?;
    let candidate = runtime.join("requirements.txt");
    if candidate.exists() {
        return Ok(candidate);
    }

    // 2. Project root (development — two levels up from src-tauri/src/)
    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("requirements.txt"));
    if let Some(ref path) = dev_root {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // 3. Fallback: create a minimal requirements.txt in the runtime dir
    tracing::warn!(
        "requirements.txt not found; creating a default one in the runtime directory"
    );
    let default_requirements = runtime.join("requirements.txt");
    std::fs::write(
        &default_requirements,
        "# RPA Agent Platform - Python Dependencies\n\
         playwright>=1.40\n\
         google-generativeai>=0.3\n\
         pillow>=10.0\n\
         pydantic>=2.0\n",
    )?;
    Ok(default_requirements)
}

/// Use `which` (Unix) or `where` (Windows) to resolve the absolute path of
/// a command on the system PATH.
async fn resolve_executable_path(cmd: &str) -> Option<String> {
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    Command::new(which_cmd)
        .arg(cmd)
        .output()
        .await
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
                // `where` on Windows may return multiple lines — take the first
                path.lines().next().map(|s| s.to_string())
            } else {
                None
            }
        })
}

/// Parse a version string like "Python 3.12.1" into "3.12.1".
fn parse_python_version(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    // Expected format: "Python X.Y.Z"
    if let Some(version) = trimmed.strip_prefix("Python ") {
        Some(version.trim().to_string())
    } else {
        // Try to extract any semver-like pattern
        trimmed
            .split_whitespace()
            .find(|token| token.contains('.') && token.chars().next().map_or(false, |c| c.is_ascii_digit()))
            .map(|s| s.to_string())
    }
}

/// Check whether a parsed version string is ≥ 3.11.
fn is_version_sufficient(version: &str) -> bool {
    let parts: Vec<u32> = version
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();

    match (parts.first(), parts.get(1)) {
        (Some(&major), Some(&minor)) => major > 3 || (major == 3 && minor >= 11),
        (Some(&major), None) => major > 3,
        _ => false,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_python_version() {
        assert_eq!(
            parse_python_version("Python 3.12.1"),
            Some("3.12.1".to_string())
        );
        assert_eq!(
            parse_python_version("Python 3.11.0\n"),
            Some("3.11.0".to_string())
        );
    }

    #[test]
    fn test_is_version_sufficient() {
        assert!(is_version_sufficient("3.11.0"));
        assert!(is_version_sufficient("3.12.1"));
        assert!(is_version_sufficient("3.13.0"));
        assert!(!is_version_sufficient("3.10.9"));
        assert!(!is_version_sufficient("3.9.0"));
        assert!(!is_version_sufficient("2.7.18"));
    }
}
