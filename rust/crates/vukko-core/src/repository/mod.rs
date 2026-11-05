//! Repository layer: the only code in `vukko-core` that issues SQL.
//!
//! One module per aggregate. Every public function takes `&Connection` (the
//! caller owns the transaction boundary), returns domain values, and reports
//! failures as [`crate::domain::VukkoError`].

pub mod document_repository;
pub mod message_repository;
pub mod settings_repository;
pub mod storage_repository;
pub mod thread_repository;
pub mod workspace_repository;

use rusqlite::Connection;

use crate::domain::{slugify, VukkoError};

/// Generates a prefixed id: the Kotlin client used `msg_` + 8 hex chars for
/// messages and `doc_` etc.; the Rust layer uses the same prefixes with 12 hex
/// chars so ids stay collision-resistant without a UUID dependency in SQL.
pub fn new_id(prefix: &str) -> String {
    let uuid = uuid::Uuid::new_v4().simple().to_string();
    format!("{}_{}", prefix, &uuid[..12])
}

/// Unix milliseconds, the single timestamp representation of the system.
pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// Trims and validates a required text field.
pub fn require_text(value: &str, field: &str, max_len: usize) -> Result<String, VukkoError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(VukkoError::validation(format!("{} is required", field)));
    }
    if value.len() > max_len {
        return Err(VukkoError::validation(format!(
            "{} is longer than {} bytes",
            field, max_len
        )));
    }
    Ok(trimmed.to_string())
}

/// Validates a bounded numeric field.
pub fn require_range(value: f32, field: &str, min: f32, max: f32) -> Result<f32, VukkoError> {
    if value.is_nan() || value < min || value > max {
        return Err(VukkoError::validation(format!(
            "{} must be between {} and {}",
            field, min, max
        )));
    }
    Ok(value)
}

/// Derives a slug that no other row in `table` uses.
pub fn unique_slug(
    conn: &Connection,
    table: &str,
    desired: &str,
    ignore_id: Option<&str>,
) -> Result<String, VukkoError> {
    let base = if desired.is_empty() {
        "unnamed"
    } else {
        desired
    };
    let mut candidate = base.to_string();
    let mut attempt = 2;
    loop {
        let sql = format!(
            "SELECT COUNT(*) FROM \"{}\" WHERE slug = ?1 AND id IS NOT ?2",
            table
        );
        let clashes: i64 =
            conn.query_row(&sql, rusqlite::params![candidate, ignore_id], |row| {
                row.get(0)
            })?;
        if clashes == 0 {
            return Ok(candidate);
        }
        candidate = format!("{}-{}", base, attempt);
        attempt += 1;
    }
}

/// Re-derives a slug from a display name (used on create only; slugs are stable).
pub fn slug_for(name: &str) -> String {
    slugify(name)
}

/// Opens a throwaway database in the system temp directory for repository tests.
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::PathBuf;

    use rusqlite::Connection;

    /// Migrated database with no rows. The caller is expected to keep the path
    /// unique per test (`name`) and let the OS clean up its temp directory.
    pub fn fresh_db(name: &str) -> Connection {
        let mut path: PathBuf = std::env::temp_dir();
        path.push(format!(
            "vukko-repo-{}-{}-{}.db",
            name,
            std::process::id(),
            super::now_millis()
        ));
        let _ = std::fs::remove_file(&path);
        let (conn, _) = vukko_db::adopt(&path).expect("adopt test database");
        conn
    }
}
