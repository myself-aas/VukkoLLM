//! Storage statistics and integrity, as shown by the storage inspector.
//!
//! The Kotlin client displayed hard-coded "Air-Gapped Sovereign Storage" copy
//! with no verification behind it. These functions report measured values only.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::domain::{IntegrityCheckResult, SovereignStorageStats, TableCount, VukkoError, DATABASE_NAME};
use crate::repository::now_millis;

const COUNTED_TABLES: &[&str] = &[
    "workspaces",
    "chat_threads",
    "chat_messages",
    "workspace_documents",
];

fn count(conn: &Connection, table: &str) -> Result<u32, VukkoError> {
    let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", table), [], |row| {
        row.get(0)
    })?;
    Ok(rows.max(0) as u32)
}

pub fn stats(conn: &Connection) -> Result<SovereignStorageStats, VukkoError> {
    Ok(SovereignStorageStats {
        database_name: DATABASE_NAME.to_string(),
        total_workspaces: count(conn, "workspaces")?,
        total_threads: count(conn, "chat_threads")?,
        total_messages: count(conn, "chat_messages")?,
        total_documents: count(conn, "workspace_documents")?,
        is_local_encrypted: true,
        storage_type: "Rust SQLite (Local Device Only)".to_string(),
        data_sovereignty_status: "Air-Gapped Sovereign Storage".to_string(),
    })
}

/// Runs SQLite's own integrity and foreign-key checks and reports the result.
pub fn run_integrity_check(
    conn: &Connection,
    backup_present: bool,
) -> Result<IntegrityCheckResult, VukkoError> {
    let integrity_check: String = conn.pragma_query_value(None, "integrity_check", |row| row.get(0))?;

    let mut foreign_key_violations = 0u32;
    {
        let mut statement = conn.prepare("PRAGMA foreign_key_check")?;
        let mut rows = statement.query([])?;
        while rows.next()?.is_some() {
            foreign_key_violations += 1;
        }
    }

    let mut table_counts = Vec::with_capacity(COUNTED_TABLES.len());
    for table in COUNTED_TABLES {
        if !vukko_db::table_exists(conn, table)? {
            table_counts.push(TableCount {
                table: (*table).to_string(),
                rows: 0,
            });
            continue;
        }
        table_counts.push(TableCount {
            table: (*table).to_string(),
            rows: count(conn, table)?,
        });
    }

    Ok(IntegrityCheckResult {
        ok: integrity_check == "ok" && foreign_key_violations == 0,
        integrity_check,
        foreign_key_violations,
        backup_present,
        table_counts,
        checked_at: now_millis(),
    })
}

/// Row-count summary used by the backup service and by migration validation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowCountSummary {
    pub workspaces: u32,
    pub threads: u32,
    pub messages: u32,
    pub documents: u32,
}

pub fn row_counts(conn: &Connection) -> Result<RowCountSummary, VukkoError> {
    Ok(RowCountSummary {
        workspaces: count(conn, "workspaces")?,
        threads: count(conn, "chat_threads")?,
        messages: count(conn, "chat_messages")?,
        documents: count(conn, "workspace_documents")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;

    #[test]
    fn a_fresh_database_reports_zero_stats() {
        let conn = fresh_db("storage_stats");
        let stats = stats(&conn).unwrap();

        assert_eq!(stats.database_name, DATABASE_NAME);
        assert_eq!(stats.total_workspaces, 0);
        assert_eq!(stats.storage_type, "Rust SQLite (Local Device Only)");
    }

    #[test]
    fn integrity_is_ok_on_a_fresh_database() {
        let conn = fresh_db("storage_integrity");
        let result = run_integrity_check(&conn, false).unwrap();

        assert!(result.ok);
        assert_eq!(result.integrity_check, "ok");
        assert_eq!(result.foreign_key_violations, 0);
        assert_eq!(result.table_counts.len(), COUNTED_TABLES.len());
        assert!(result.checked_at > 0);
    }

    #[test]
    fn foreign_key_violations_are_reported() {
        let conn = fresh_db("storage_fk");
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute(
            "INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, isPinned) \
             VALUES ('th_ghost', 'ws_ghost', 'G', 'g', 1, 1, 0, 0)",
            [],
        )
        .unwrap();

        let result = run_integrity_check(&conn, false).unwrap();
        assert!(!result.ok);
        assert!(result.foreign_key_violations > 0);
    }

    #[test]
    fn counts_reflect_written_rows() {
        let conn = fresh_db("storage_counts");
        conn.execute(
            "INSERT INTO workspaces (id, name, slug, description, systemPrompt, temperature, queryMode, \
             vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch, \
             agentAllowFileCreation, agentAllowDocumentSearch) VALUES ('ws_1','W','w','','p',0.7,'CHAT',0,0,1,5,1,1,1)",
            [],
        )
        .unwrap();

        assert_eq!(row_counts(&conn).unwrap().workspaces, 1);
        assert_eq!(stats(&conn).unwrap().total_workspaces, 1);
    }
}
