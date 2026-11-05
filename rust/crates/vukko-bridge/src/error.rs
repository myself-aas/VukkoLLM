//! Error translation at the FFI boundary.
//!
//! The JavaScript side only ever sees the `VukkoError` JSON shape declared in
//! `src/types/errors.ts`. This module is the single place that decides how each
//! internal error is presented, so no SQLite message, file path or credential
//! can leak through an unrelated error kind.

use serde::Serialize;
use vukko_core::domain::{ErrorCode, VukkoError};
use vukko_db::DbError;

/// The payload a rejected promise carries.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<std::collections::BTreeMap<String, String>>,
}

impl From<VukkoError> for BridgeError {
    fn from(error: VukkoError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
        }
    }
}

impl From<DbError> for BridgeError {
    fn from(error: DbError) -> Self {
        let (code, retryable, detail) = match &error {
            DbError::Corrupted { .. } => (ErrorCode::STORAGE, false, Some("corrupt".to_string())),
            DbError::Unsupported { .. } => (ErrorCode::UNSUPPORTED, false, None),
            DbError::Migration { restored, .. } => (
                ErrorCode::STORAGE,
                !restored,
                Some(format!("restored={}", restored)),
            ),
            DbError::Validation { restored, .. } => (
                ErrorCode::STORAGE,
                !restored,
                Some(format!("restored={}", restored)),
            ),
            DbError::Sqlite(_) => (ErrorCode::STORAGE, error.is_retryable(), None),
            DbError::Io(_) => (ErrorCode::STORAGE, false, None),
        };

        let mut bridge = BridgeError {
            code,
            message: error.to_string(),
            retryable,
            details: None,
        };
        if let Some(detail) = detail {
            let mut map = std::collections::BTreeMap::new();
            map.insert("stage".to_string(), detail);
            bridge.details = Some(map);
        }
        bridge
    }
}

impl From<rusqlite::Error> for BridgeError {
    fn from(error: rusqlite::Error) -> Self {
        BridgeError::from(VukkoError::from(error))
    }
}

impl From<serde_json::Error> for BridgeError {
    fn from(error: serde_json::Error) -> Self {
        BridgeError::from(VukkoError::validation(format!("Malformed JSON: {}", error)))
    }
}

impl From<std::io::Error> for BridgeError {
    fn from(error: std::io::Error) -> Self {
        BridgeError {
            code: ErrorCode::STORAGE,
            message: format!("filesystem error: {}", error),
            retryable: false,
            details: None,
        }
    }
}

impl BridgeError {
    pub fn not_initialized() -> Self {
        Self::from(VukkoError::not_initialized())
    }

    pub fn cancelled() -> Self {
        Self::from(VukkoError::cancelled())
    }

    pub fn unsupported(what: &str) -> Self {
        Self::from(VukkoError::unsupported(what))
    }

    /// Serialised for the `reject` side of the promise.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            "{\"code\":\"UNSUPPORTED\",\"message\":\"error serialisation failed\",\"retryable\":false}"
                .to_string()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_busy_is_retryable_and_other_failures_are_not() {
        let busy: BridgeError = DbError::Sqlite(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        ))
        .into();
        assert!(busy.retryable);

        let corrupt: BridgeError = DbError::Unsupported {
            found: 9,
            supported: 5,
        }
        .into();
        assert_eq!(corrupt.code, ErrorCode::UNSUPPORTED);
        assert!(!corrupt.retryable);
    }

    #[test]
    fn migration_failures_expose_whether_the_data_was_restored() {
        let restored: BridgeError = DbError::Migration {
            version: 3,
            message: "boom".into(),
            restored: true,
        }
        .into();
        assert_eq!(restored.details.unwrap()["stage"], "restored=true");
        // Restored means the user's data is intact, so a retry is pointless
        // until the build changes: not retryable.
        assert!(!restored.retryable);
    }

    #[test]
    fn json_payload_matches_the_typescript_shape() {
        let error = BridgeError::not_initialized();
        let parsed: serde_json::Value = serde_json::from_str(&error.to_json()).unwrap();
        assert_eq!(parsed["code"], "NOT_INITIALIZED");
        assert_eq!(parsed["retryable"], false);
        assert!(parsed.get("details").is_none());
    }

    #[test]
    fn cancellation_is_never_retryable() {
        let error = BridgeError::cancelled();
        assert!(!error.retryable);
        assert_eq!(error.code, ErrorCode::CANCELLED);
    }
}
