//! Storage-facing use cases: stats and integrity, with the backup-present flag
//! the inspector shows.

use rusqlite::Connection;

use crate::domain::{IntegrityCheckResult, SovereignStorageStats, VukkoError};
use crate::repository::storage_repository;

/// Statistics for the storage inspector.
pub fn stats(conn: &Connection) -> Result<SovereignStorageStats, VukkoError> {
    storage_repository::stats(conn)
}

/// Integrity check, reporting whether a pre-migration backup is still on disk.
pub fn integrity(
    conn: &Connection,
    backup_present: bool,
) -> Result<IntegrityCheckResult, VukkoError> {
    storage_repository::run_integrity_check(conn, backup_present)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;

    #[test]
    fn a_fresh_database_is_healthy() {
        let conn = fresh_db("service_storage");
        let stats = stats(&conn).unwrap();
        assert_eq!(stats.total_workspaces, 0);

        let integrity = integrity(&conn, true).unwrap();
        assert!(integrity.ok);
        assert!(integrity.backup_present);
    }
}
