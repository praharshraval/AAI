//! # OS Keyring Integration with AES-256-GCM Fallback Vault
//!
//! This module provides secure storage for the Gemini API key using the
//! operating system's native credential manager (macOS Keychain, Windows
//! Credential Manager, Linux Secret Service / libsecret).
//!
//! When the OS keyring is unavailable (e.g., headless Linux without a
//! secret service daemon), the module falls back to an AES-256-GCM
//! encrypted local vault stored as a JSON file in the application's
//! data directory.
//!
//! ## Fallback Vault Design
//!
//! - **Key derivation**: SHA-256 hash of a machine-specific identifier
//!   (hostname + OS + username) produces the 256-bit encryption key.
//! - **Encryption**: AES-256-GCM with a random 96-bit nonce per write.
//! - **Storage format**: Base64-encoded ciphertext + nonce in a JSON file
//!   at `<data_local_dir>/rpa-agent-platform/vault.json`.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

/// Keyring service identifier used for OS credential lookups.
const SERVICE_NAME: &str = "rpa-agent-platform";
/// Username / account label under which the API key is stored.
const USERNAME: &str = "gemini-api-key";

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during keyring or vault operations.
#[derive(Error, Debug)]
pub enum KeyringError {
    /// The OS keyring backend returned an error.
    #[error("OS keyring error: {0}")]
    OsKeyring(String),

    /// An I/O error occurred while reading or writing the fallback vault file.
    #[error("Vault I/O error: {0}")]
    VaultIo(#[from] std::io::Error),

    /// AES-GCM encryption or decryption failed.
    #[error("Encryption/decryption error: {0}")]
    Crypto(String),

    /// Failed to decode Base64 data from the vault file.
    #[error("Base64 decoding error: {0}")]
    Base64(#[from] base64::DecodeError),

    /// Failed to parse or serialize the vault JSON structure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// The application data directory could not be determined.
    #[error("Could not determine application data directory")]
    NoDataDir,
}

// =============================================================================
// Fallback Vault Types
// =============================================================================

/// On-disk representation of the encrypted vault file.
#[derive(Serialize, Deserialize)]
struct VaultFile {
    /// Base64-encoded AES-256-GCM ciphertext (includes auth tag).
    ciphertext: String,
    /// Base64-encoded 96-bit nonce used for encryption.
    nonce: String,
}

// =============================================================================
// Public API
// =============================================================================

/// Store the Gemini API key securely.
///
/// Attempts the OS keyring first; falls back to the local encrypted vault
/// if the keyring is not available.
///
/// # Arguments
/// * `key` — The plaintext API key to persist.
pub fn store_gemini_key(key: &str) -> Result<(), KeyringError> {
    // 1. Always persist to the local AES-256-GCM encrypted vault as guaranteed local storage
    let vault_res = store_in_vault(key);

    // 2. Also attempt OS keyring
    let os_res = try_os_keyring_store(key);

    tracing::info!("store_gemini_key: OS keyring={:?}, vault={:?}", os_res, vault_res);

    match (os_res, vault_res) {
        (Err(e), Err(_)) => Err(e),
        _ => Ok(()),
    }
}

/// Retrieve the Gemini API key.
///
/// Returns `Ok(None)` if no key has been stored yet.
pub fn get_gemini_key() -> Result<Option<String>, KeyringError> {
    // 1. Try OS keyring first if available and populated
    if let Ok(Some(key)) = try_os_keyring_get() {
        if !key.trim().is_empty() {
            return Ok(Some(key));
        }
    }
    // 2. Fall back to encrypted local vault
    get_from_vault()
}

/// Delete the stored Gemini API key from both the keyring and vault.
pub fn delete_gemini_key() -> Result<(), KeyringError> {
    // Attempt to remove from OS keyring (ignore errors if not present)
    let _ = try_os_keyring_delete();

    // Also remove the vault file if it exists
    let vault_path = vault_file_path()?;
    if vault_path.exists() {
        fs::remove_file(&vault_path)?;
        tracing::info!("Vault file removed");
    }

    Ok(())
}

/// Check whether a Gemini API key is currently stored.
///
/// This does **not** reveal the key value — only its existence.
pub fn has_gemini_key() -> Result<bool, KeyringError> {
    match get_gemini_key() {
        Ok(Some(_)) => Ok(true),
        Ok(None) => Ok(false),
        Err(e) => Err(e),
    }
}

// =============================================================================
// OS Keyring Helpers
// =============================================================================

/// Attempt to store a secret in the OS keyring.
fn try_os_keyring_store(secret: &str) -> Result<(), KeyringError> {
    let entry =
        keyring::Entry::new(SERVICE_NAME, USERNAME).map_err(|e| KeyringError::OsKeyring(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| KeyringError::OsKeyring(e.to_string()))
}

/// Attempt to retrieve a secret from the OS keyring.
///
/// Returns `Ok(None)` when the entry does not exist (as opposed to a real error).
fn try_os_keyring_get() -> Result<Option<String>, KeyringError> {
    let entry =
        keyring::Entry::new(SERVICE_NAME, USERNAME).map_err(|e| KeyringError::OsKeyring(e.to_string()))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(KeyringError::OsKeyring(e.to_string())),
    }
}

/// Attempt to delete a secret from the OS keyring.
fn try_os_keyring_delete() -> Result<(), KeyringError> {
    let entry =
        keyring::Entry::new(SERVICE_NAME, USERNAME).map_err(|e| KeyringError::OsKeyring(e.to_string()))?;
    entry
        .delete_credential()
        .map_err(|e| KeyringError::OsKeyring(e.to_string()))
}

// =============================================================================
// AES-256-GCM Encrypted Vault (Fallback)
// =============================================================================

/// Derive a 256-bit encryption key from machine-specific identifiers.
///
/// Uses SHA-256 over the concatenation of hostname, OS family, and username
/// to produce a deterministic key unique to this machine + user account.
fn derive_vault_key() -> [u8; 32] {
    let mut hasher = Sha256::new();

    // Hostname from environment
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("HOST"))
        .unwrap_or_else(|_| "localhost".to_string());
    hasher.update(hostname.as_bytes());

    // OS family
    hasher.update(std::env::consts::OS.as_bytes());

    // Current username from environment
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown-user".to_string());
    hasher.update(username.as_bytes());

    // Additional static salt to avoid collisions with other apps
    hasher.update(b"rpa-agent-platform-vault-key-v1");

    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// Resolve the path to the vault JSON file.
fn vault_file_path() -> Result<PathBuf, KeyringError> {
    let data_dir = dirs::data_local_dir().ok_or(KeyringError::NoDataDir)?;
    Ok(data_dir.join("rpa-agent-platform").join("vault.json"))
}

/// Encrypt and persist a secret to the local vault file.
fn store_in_vault(secret: &str) -> Result<(), KeyringError> {
    let key_bytes = derive_vault_key();
    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| KeyringError::Crypto(e.to_string()))?;

    // Generate a random 96-bit nonce
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, secret.as_bytes())
        .map_err(|e| KeyringError::Crypto(e.to_string()))?;

    // Serialize to JSON
    let vault = VaultFile {
        ciphertext: BASE64.encode(&ciphertext),
        nonce: BASE64.encode(nonce_bytes),
    };
    let json = serde_json::to_string_pretty(&vault)?;

    // Write file (create parent directories if needed)
    let path = vault_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, json)?;

    tracing::info!("API key stored in encrypted vault at {}", path.display());
    Ok(())
}

/// Read and decrypt a secret from the local vault file.
///
/// Returns `Ok(None)` if the vault file does not exist.
fn get_from_vault() -> Result<Option<String>, KeyringError> {
    let path = vault_file_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(&path)?;
    let vault: VaultFile = serde_json::from_str(&json)?;

    let key_bytes = derive_vault_key();
    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| KeyringError::Crypto(e.to_string()))?;

    let ciphertext = BASE64.decode(&vault.ciphertext)?;
    let nonce_bytes = BASE64.decode(&vault.nonce)?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| KeyringError::Crypto(e.to_string()))?;

    let secret =
        String::from_utf8(plaintext).map_err(|e| KeyringError::Crypto(e.to_string()))?;

    Ok(Some(secret))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_get_key() {
        let test_key = "AIzaSyTestKey123456789";
        let res_store = store_gemini_key(test_key);
        assert!(res_store.is_ok(), "Failed to store key: {:?}", res_store.err());

        let has_key = has_gemini_key().unwrap();
        assert!(has_key);

        let retrieved = get_gemini_key().unwrap();
        assert_eq!(retrieved, Some(test_key.to_string()));

        let _ = delete_gemini_key();
    }
}

