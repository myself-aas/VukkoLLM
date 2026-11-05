//! Structured error contract (MIGRATION_PLAN.md §5 Step 2.2).
//!
//! Every fallible operation returns [`VukkoError`]. It serialises to exactly the
//! `VukkoError` shape in `src/types/errors.ts`:
//!
//! ```json
//! { "code": "NETWORK", "message": "...", "retryable": true, "details": { "status": "503" } }
//! ```
//!
//! Rules this type enforces:
//! - no error carries credential material: [`VukkoError::with_detail`] redacts
//!   key/token/secret-named details;
//! - `CANCELLED` is never retryable, whatever a caller passes;
//! - a failure is never reported as a success value.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

// Variant names are the Kotlin enum names, and the serde wire values are
// part of the persisted contract; renaming any of them changes stored data.
#[allow(
    clippy::upper_case_acronyms,
    clippy::enum_variant_names,
    non_camel_case_types
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    // The variants are already upper case, and `rename_all` would re-case the
    // *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
    // every persisted value. An explicit rename is a no-op for Rust and a contract
    // for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "NOT_INITIALIZED")]
    NOT_INITIALIZED,
    #[serde(rename = "NOT_FOUND")]
    NOT_FOUND,
    #[serde(rename = "VALIDATION")]
    VALIDATION,
    #[serde(rename = "NETWORK")]
    NETWORK,
    #[serde(rename = "AUTHENTICATION")]
    AUTHENTICATION,
    #[serde(rename = "STORAGE")]
    STORAGE,
    #[serde(rename = "CANCELLED")]
    CANCELLED,
    #[serde(rename = "UNSUPPORTED")]
    UNSUPPORTED,
}

impl ErrorCode {
    /// Default retryability, matching `RETRYABLE_BY_DEFAULT` in errors.ts.
    pub fn retryable_by_default(self) -> bool {
        matches!(self, ErrorCode::NETWORK | ErrorCode::STORAGE)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VukkoError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<BTreeMap<String, String>>,
}

impl VukkoError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: code.retryable_by_default(),
            details: None,
        }
    }

    pub fn retryable(mut self, retryable: bool) -> Self {
        // A cancelled request is never retried, regardless of the caller.
        self.retryable = retryable && self.code != ErrorCode::CANCELLED;
        self
    }

    /// Attaches non-secret context. Values whose key looks like a credential
    /// are redacted instead of stored.
    pub fn with_detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        let key = key.into();
        let value = if looks_secret(&key) {
            "[redacted]".to_string()
        } else {
            value.into()
        };
        self.details
            .get_or_insert_with(BTreeMap::new)
            .insert(key, value);
        self
    }

    pub fn not_found(what: impl fmt::Display) -> Self {
        Self::new(ErrorCode::NOT_FOUND, format!("{} not found", what))
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::VALIDATION, message)
    }

    pub fn not_initialized() -> Self {
        Self::new(
            ErrorCode::NOT_INITIALIZED,
            "The storage engine is not initialized yet",
        )
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorCode::CANCELLED, "Request cancelled").retryable(false)
    }

    pub fn unsupported(what: impl fmt::Display) -> Self {
        Self::new(ErrorCode::UNSUPPORTED, format!("{} is not supported", what))
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::STORAGE, message)
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NETWORK, message)
    }

    pub fn authentication(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AUTHENTICATION, message)
    }
}

impl fmt::Display for VukkoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for VukkoError {}

fn looks_secret(key: &str) -> bool {
    let lowered = key.to_ascii_lowercase();
    [
        "key",
        "token",
        "secret",
        "password",
        "authorization",
        "credential",
        "cookie",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

impl From<rusqlite::Error> for VukkoError {
    fn from(error: rusqlite::Error) -> Self {
        match &error {
            rusqlite::Error::QueryReturnedNoRows => {
                VukkoError::new(ErrorCode::NOT_FOUND, "Record not found")
            }
            // Corruption is surfaced as STORAGE with a retry hint, never hidden.
            rusqlite::Error::SqliteFailure(_, message) => VukkoError::storage(
                message
                    .clone()
                    .unwrap_or_else(|| "SQLite failure".to_string()),
            ),
            other => VukkoError::storage(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for VukkoError {
    fn from(error: serde_json::Error) -> Self {
        VukkoError::validation(format!("Malformed JSON: {}", error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairs_of_code_and_retryability_match_typescript() {
        assert!(ErrorCode::NETWORK.retryable_by_default());
        assert!(ErrorCode::STORAGE.retryable_by_default());
        assert!(!ErrorCode::VALIDATION.retryable_by_default());
        assert!(!ErrorCode::NOT_FOUND.retryable_by_default());
        assert!(!ErrorCode::CANCELLED.retryable_by_default());
    }

    #[test]
    fn cancellation_can_never_be_retryable() {
        let error = VukkoError::cancelled().retryable(true);
        assert!(!error.retryable);
    }

    #[test]
    fn secrets_are_redacted_from_details() {
        let error = VukkoError::network("boom")
            .with_detail("apiKey", "sk-live-123")
            .with_detail("status", "503");
        let details = error.details.unwrap();
        assert_eq!(details.get("apiKey").unwrap(), "[redacted]");
        assert_eq!(details.get("status").unwrap(), "503");
    }

    #[test]
    fn serializes_to_the_typescript_shape() {
        let error = VukkoError::validation("name is required");
        let json: serde_json::Value = serde_json::to_value(&error).unwrap();
        assert_eq!(json["code"], "VALIDATION");
        assert_eq!(json["retryable"], false);
        assert!(json.get("details").is_none());
    }
}
