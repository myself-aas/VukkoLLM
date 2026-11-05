//! Error type for the storage layer.
//!
//! `vukko-db` does not depend on `vukko-core`, so it carries its own error and
//! `vukko-core` maps it into [`vukko_core::domain::VukkoError`]. The kinds are
//! deliberately coarse: they exist so the caller can decide "retry", "refuse to
//! start", or "refuse and keep the user's data".

use std::fmt;
use std::path::PathBuf;

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug)]
pub enum DbError {
    /// The file exists but cannot be read as a SQLite database.
    Corrupted { path: PathBuf, message: String },
    /// The database was written by a newer schema than this build knows.
    Unsupported { found: u32, supported: u32 },
    /// A migration failed. `restored` says whether the pre-migration bytes are
    /// back in place, which is what the caller needs to know before retrying.
    Migration {
        version: u32,
        message: String,
        restored: bool,
    },
    /// Referential or integrity validation failed after migrating.
    Validation { message: String, restored: bool },
    /// Any other SQLite failure.
    Sqlite(rusqlite::Error),
    /// Filesystem failure while backing up or restoring.
    Io(std::io::Error),
}

impl DbError {
    pub fn is_corruption(&self) -> bool {
        matches!(self, DbError::Corrupted { .. })
    }

    /// True when the caller may safely retry: the database is intact and the
    /// previous attempt was rolled back.
    pub fn is_retryable(&self) -> bool {
        match self {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(failure, _)) => matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            ),
            _ => false,
        }
    }
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Corrupted { path, message } => {
                write!(
                    f,
                    "database at {} cannot be read: {}",
                    path.display(),
                    message
                )
            }
            DbError::Unsupported { found, supported } => write!(
                f,
                "database schema version {} is newer than this build supports ({})",
                found, supported
            ),
            DbError::Migration {
                version,
                message,
                restored,
            } => write!(
                f,
                "migration {} failed ({}); database {}",
                version,
                message,
                if *restored {
                    "restored from its pre-migration backup"
                } else {
                    "left untouched"
                }
            ),
            DbError::Validation { message, restored } => write!(
                f,
                "validation failed after migration ({}); database {}",
                message,
                if *restored {
                    "restored from its pre-migration backup"
                } else {
                    "left untouched"
                }
            ),
            DbError::Sqlite(error) => write!(f, "sqlite error: {}", error),
            DbError::Io(error) => write!(f, "filesystem error: {}", error),
        }
    }
}

impl std::error::Error for DbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DbError::Sqlite(error) => Some(error),
            DbError::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(error: rusqlite::Error) -> Self {
        DbError::Sqlite(error)
    }
}

impl From<std::io::Error> for DbError {
    fn from(error: std::io::Error) -> Self {
        DbError::Io(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corruption_is_detected_by_kind() {
        let error = DbError::Corrupted {
            path: PathBuf::from("/tmp/x.db"),
            message: "malformed".into(),
        };
        assert!(error.is_corruption());
        assert!(!error.is_retryable());
        assert!(error.to_string().contains("/tmp/x.db"));
    }

    #[test]
    fn busy_databases_are_retryable() {
        let error = DbError::Sqlite(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            Some("database is locked".into()),
        ));
        assert!(error.is_retryable());
    }

    #[test]
    fn unsupported_versions_name_both_numbers() {
        let error = DbError::Unsupported {
            found: 99,
            supported: 4,
        };
        let message = error.to_string();
        assert!(message.contains("99"));
        assert!(message.contains("4"));
    }
}
