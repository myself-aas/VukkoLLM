//! Integrity checks surfaced by the storage inspector.
//!
//! The Kotlin client displayed hard-coded "Air-Gapped Sovereign Storage" text
//! with no verification behind it. These checks are real: they run SQLite's own
//! integrity and foreign-key checks and report what they found.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::DbResult;
use crate::migrate::LEGACY_TABLES;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCount {
    pub table: String,
    pub rows: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub ok: bool,
    pub integrity_check: String,
    pub foreign_key_violations: u32,
    pub table_counts: Vec<TableCount>,
}

/// Runs the checks. `ok` is true only when both SQLite checks pass.
pub fn check(conn: &Connection) -> DbResult<IntegrityReport> {
    let integrity_check: String =
        conn.pragma_query_value(None, "integrity_check", |row| row.get(0))?;

    let mut foreign_key_violations = 0u32;
    {
        let mut statement = conn.prepare("PRAGMA foreign_key_check")?;
        let mut rows = statement.query([])?;
        while rows.next()?.is_some() {
            foreign_key_violations += 1;
        }
    }

    let mut table_counts = Vec::with_capacity(LEGACY_TABLES.len());
    for table in LEGACY_TABLES {
        if !crate::migrate::table_exists(conn, table)? {
            table_counts.push(TableCount {
                table: (*table).to_string(),
                rows: 0,
            });
            continue;
        }
        let rows: i64 =
            conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", table), [], |row| {
                row.get(0)
            })?;
        table_counts.push(TableCount {
            table: (*table).to_string(),
            rows: rows.max(0) as u32,
        });
    }

    Ok(IntegrityReport {
        ok: integrity_check == "ok" && foreign_key_violations == 0,
        integrity_check,
        foreign_key_violations,
        table_counts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate::adopt;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "vukko-integrity-{}-{}.db",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn a_fresh_database_is_healthy_and_empty() {
        let path = temp_path("fresh");
        let (conn, _) = adopt(&path).expect("adopt");
        let report = check(&conn).expect("check");

        assert!(report.ok);
        assert_eq!(report.integrity_check, "ok");
        assert_eq!(report.foreign_key_violations, 0);
        assert_eq!(report.table_counts.len(), LEGACY_TABLES.len());
        assert!(report.table_counts.iter().all(|count| count.rows == 0));
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn counts_reflect_rows_written_in_the_same_connection() {
        let path = temp_path("rows");
        let (conn, _) = adopt(&path).expect("adopt");
        conn.execute(
            "INSERT INTO workspaces (id, name, slug, description, systemPrompt, temperature, queryMode, vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch, agentAllowFileCreation, agentAllowDocumentSearch) VALUES ('ws_1', 'W', 'w', '', 'p', 0.7, 'CHAT', 0, 0, 1, 5, 1, 1, 1)",
            [],
        )
        .expect("insert");

        let report = check(&conn).expect("check");
        let workspaces = report
            .table_counts
            .iter()
            .find(|count| count.table == "workspaces")
            .expect("workspaces row");
        assert_eq!(workspaces.rows, 1);
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
