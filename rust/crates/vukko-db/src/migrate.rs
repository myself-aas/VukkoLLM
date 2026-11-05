//! Numbered, forward-only migrations.
//!
//! The SQL lives in `migrations/*.sql` and is embedded at compile time, so a
//! shipped binary can never disagree with the schema it was built against. Each
//! migration runs in its own transaction together with the `user_version`
//! bump: a crash mid-migration leaves the version where it was, and the whole
//! migration is replayed on the next launch.
//!
//! Adoption sequence (MIGRATION_PLAN.md §6 Step 3.3) — the test oracle in
//! `tests/migration/support/adopt.cjs` performs the identical sequence against a
//! real SQLite engine, so the two cannot drift silently:
//!
//! 1. detect the database file;
//! 2. copy it to `<db>.premigration-backup` before any write;
//! 3. read `PRAGMA user_version` and detect the legacy Room schema;
//! 4. apply pending migrations transactionally;
//! 5. validate: `integrity_check`, `foreign_key_check`, unchanged row counts;
//! 6. persist completion (`user_version`);
//! 7. retain the backup until the next successful launch;
//! 8. on failure: restore the backup and report which step failed.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::{DbError, DbResult};

/// One schema step.
#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Every migration that has ever shipped, in order. Never reorder or edit an
/// entry that has been released: append a new one.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_legacy_room_schema",
        sql: include_str!("../migrations/0001_legacy_room_schema.sql"),
    },
    Migration {
        version: 2,
        name: "0002_add_indexes",
        sql: include_str!("../migrations/0002_add_indexes.sql"),
    },
    Migration {
        version: 3,
        name: "0003_add_backup_metadata",
        sql: include_str!("../migrations/0003_add_backup_metadata.sql"),
    },
    Migration {
        version: 4,
        name: "0004_add_provider_secrets_metadata",
        sql: include_str!("../migrations/0004_add_provider_secrets_metadata.sql"),
    },
    Migration {
        version: 5,
        name: "0005_add_app_settings",
        sql: include_str!("../migrations/0005_add_app_settings.sql"),
    },
];

/// The schema version this build writes.
pub const LATEST_VERSION: u32 = 5;

/// Tables the Kotlin application wrote. Their contents must survive adoption
/// unchanged, so their row counts are the validation contract.
pub const LEGACY_TABLES: &[&str] = &[
    "workspaces",
    "chat_threads",
    "chat_messages",
    "workspace_documents",
];

pub const BACKUP_SUFFIX: &str = ".premigration-backup";
pub const STATE_SUFFIX: &str = ".migration-state.json";

/// Result of opening (and possibly upgrading) a database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionReport {
    pub from_version: u32,
    pub to_version: u32,
    pub migrations_applied: usize,
    pub migrated_from_legacy: bool,
    pub backup_path: Option<PathBuf>,
    pub backup_retained: bool,
    pub recovered: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrationState {
    status: String,
    from_version: u32,
    to_version: u32,
    backup_path: PathBuf,
    started_at: i64,
}

impl MigrationState {
    const MIGRATING: &'static str = "MIGRATING";
}

/// Reads `PRAGMA user_version`.
pub fn schema_version(conn: &Connection) -> DbResult<u32> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    Ok(version.max(0) as u32)
}

/// True when a table exists.
pub fn table_exists(conn: &Connection, table: &str) -> DbResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn row_count(conn: &Connection, table: &str) -> DbResult<i64> {
    if !table_exists(conn, table)? {
        return Ok(0);
    }
    let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", table), [], |row| {
        row.get(0)
    })?;
    Ok(count)
}

fn snapshot_counts(conn: &Connection) -> DbResult<Vec<(&'static str, i64)>> {
    let mut counts = Vec::with_capacity(LEGACY_TABLES.len());
    for table in LEGACY_TABLES {
        counts.push((*table, row_count(conn, table)?));
    }
    Ok(counts)
}

fn backup_path_for(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(BACKUP_SUFFIX);
    PathBuf::from(name)
}

fn state_path_for(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(STATE_SUFFIX);
    PathBuf::from(name)
}

/// Validates a migrated database: integrity, referential integrity, and that no
/// legacy row disappeared.
fn validate(conn: &Connection, expected: &[(&'static str, i64)]) -> DbResult<()> {
    let integrity: String =
        conn.pragma_query_value(None, "integrity_check", |row| row.get(0))?;
    if integrity != "ok" {
        return Err(DbError::Validation {
            message: format!("integrity_check returned: {}", integrity),
            restored: false,
        });
    }

    let mut violations = 0i64;
    {
        let mut statement = conn.prepare("PRAGMA foreign_key_check")?;
        let mut rows = statement.query([])?;
        while rows.next()?.is_some() {
            violations += 1;
        }
    }
    if violations > 0 {
        return Err(DbError::Validation {
            message: format!("{} foreign key violation(s)", violations),
            restored: false,
        });
    }

    let actual = snapshot_counts(conn)?;
    for (table, before) in expected {
        let after = actual
            .iter()
            .find(|(name, _)| name == table)
            .map(|(_, count)| *count)
            .unwrap_or_default();
        if after != *before {
            return Err(DbError::Validation {
                message: format!("row count changed for {}: {} -> {}", table, before, after),
                restored: false,
            });
        }
    }
    Ok(())
}

/// Applies one migration and records the version in the same transaction.
fn apply(conn: &mut Connection, migration: &Migration) -> DbResult<()> {
    // `BEGIN IMMEDIATE` takes the write lock up front: two processes starting at
    // once must serialise here, not half-apply a migration each.
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> DbResult<()> {
        conn.execute_batch(migration.sql)?;
        conn.pragma_update(None, "user_version", migration.version)?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(error) => {
            // A failed rollback means SQLite already unwound; the original error
            // is the one worth reporting.
            let _ = conn.execute_batch("ROLLBACK;");
            Err(DbError::Migration {
                version: migration.version,
                message: error.to_string(),
                restored: false,
            })
        }
    }
}

/// Opens and adopts the database at `path`.
///
/// Creates the file when it is absent (fresh install), upgrades a legacy Room
/// database in place when it is present, and refuses anything it cannot do
/// safely. On any failure the file is left byte-identical to how it was found.
pub fn adopt(path: &Path) -> DbResult<(Connection, AdoptionReport)> {
    let existed = path.exists();
    let backup_path = backup_path_for(path);
    let state_path = state_path_for(path);
    let mut warnings = Vec::new();
    let mut recovered = false;

    // Step 8a: a previous run died between the backup and the commit.
    if existed && state_path.exists() {
        if let Ok(raw) = fs::read_to_string(&state_path) {
            if let Ok(state) = serde_json::from_str::<MigrationState>(&raw) {
                if state.status == MigrationState::MIGRATING {
                    let restore_from = if state.backup_path.exists() {
                        state.backup_path.clone()
                    } else {
                        backup_path.clone()
                    };
                    if restore_from.exists() {
                        fs::copy(&restore_from, path)?;
                        recovered = true;
                        warnings.push(format!(
                            "restored database from {} after an interrupted migration",
                            restore_from.display()
                        ));
                    } else {
                        warnings.push(
                            "interrupted migration found but its backup is missing; database untouched"
                                .to_string(),
                        );
                    }
                }
            }
        }
        let _ = fs::remove_file(&state_path);
    }

    // Step 2: back the file up before writing anything.
    let mut backup_written = false;
    if existed {
        fs::copy(path, &backup_path)?;
        backup_written = true;
    }

    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // `journal_mode` returns a row, so it cannot go through pragma_update.
    let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;

    let from_version = schema_version(&conn)?;

    // Step 3: refuse the impossible instead of guessing.
    if from_version > LATEST_VERSION {
        drop(conn);
        if backup_written {
            let _ = fs::remove_file(&backup_path);
        }
        return Err(DbError::Unsupported {
            found: from_version,
            supported: LATEST_VERSION,
        });
    }

    let legacy_tables = table_exists(&conn, "workspaces")?;
    let room_metadata = table_exists(&conn, "room_master_table")?;
    if legacy_tables && !room_metadata {
        warnings.push(
            "legacy database has no room_master_table; treated as an interrupted Room write"
                .to_string(),
        );
    }
    let migrated_from_legacy = existed && legacy_tables && from_version < LATEST_VERSION;

    // A corrupt file raises here, before any write.
    let before = match snapshot_counts(&conn) {
        Ok(counts) => counts,
        Err(error) => {
            drop(conn);
            if backup_written {
                let _ = fs::remove_file(&backup_path);
            }
            return Err(DbError::Corrupted {
                path: path.to_path_buf(),
                message: error.to_string(),
            });
        }
    };

    let pending: Vec<&Migration> = MIGRATIONS
        .iter()
        .filter(|migration| migration.version > from_version)
        .collect();

    if !pending.is_empty() && existed {
        let state = MigrationState {
            status: MigrationState::MIGRATING.to_string(),
            from_version,
            to_version: LATEST_VERSION,
            backup_path: backup_path.clone(),
            started_at: now_millis(),
        };
        fs::write(&state_path, serde_json::to_vec(&state).unwrap_or_default())?;
    }

    for migration in &pending {
        if let Err(error) = apply(&mut conn, migration) {
            drop(conn);
            let restored = restore(&path, &backup_path);
            let _ = fs::remove_file(&state_path);
            return Err(DbError::Migration {
                version: migration.version,
                message: error.to_string(),
                restored,
            });
        }
    }

    if let Err(error) = validate(&conn, &before) {
        drop(conn);
        let restored = restore(&path, &backup_path);
        let _ = fs::remove_file(&state_path);
        return Err(match error {
            DbError::Validation { message, .. } => DbError::Validation { message, restored },
            other => other,
        });
    }

    let to_version = schema_version(&conn)?;
    let _ = fs::remove_file(&state_path);

    // Step 7: retire a pre-existing backup only after a fully successful run.
    // A migration performed in this call keeps its backup until the next
    // successful launch, which is what gives an upgrade a recovery path.
    let retire = recovered || (existed && !migrated_from_legacy);
    let mut backup_retained = false;
    if backup_written {
        if retire {
            let _ = fs::remove_file(&backup_path);
        } else {
            backup_retained = true;
        }
    }

    Ok((
        conn,
        AdoptionReport {
            from_version,
            to_version,
            migrations_applied: pending.len(),
            migrated_from_legacy,
            backup_path: if backup_written {
                Some(backup_path)
            } else {
                None
            },
            backup_retained,
            recovered,
            warnings,
        },
    ))
}

fn restore(path: &Path, backup: &Path) -> bool {
    if !backup.exists() {
        return false;
    }
    fs::copy(backup, path).is_ok()
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "vukko-db-test-{}-{}.db",
            name,
            now_millis()
        ));
        let _ = fs::remove_file(&path);
        path
    }

    /// Builds a database that looks exactly like a shipped Room v1 install.
    fn legacy_database(name: &str) -> PathBuf {
        let path = temp_db(name);
        let conn = Connection::open(&path).expect("open");
        conn.execute_batch(MIGRATIONS[0].sql).expect("legacy schema");
        conn.pragma_update(None, "user_version", 1).expect("version");
        conn.execute(
            "INSERT INTO workspaces (id, name, slug, description, systemPrompt, temperature, queryMode, vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch, agentAllowFileCreation, agentAllowDocumentSearch) VALUES ('ws_default', 'Default', 'default', '', 'prompt', 0.7, 'CHAT', 5, 1, 1700000000000, 5, 1, 1, 1)",
            [],
        )
        .expect("workspace");
        conn.execute(
            "INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, lastMessageSnippet, isPinned) VALUES ('th_default', 'ws_default', 'General', 'general', 1700000000000, 1700000000000, 1, NULL, 0)",
            [],
        )
        .expect("thread");
        conn.execute(
            "INSERT INTO chat_messages (id, threadId, sender, content, timestamp, citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, agentStepsJson, isFavorite, isPinned, tagsJson) VALUES ('msg_1', 'th_default', 'USER', 'hello', 1700000000000, '[]', '[]', '[]', 0, 0, '[]', 0, 0, '[]')",
            [],
        )
        .expect("message");
        drop(conn);
        path
    }

    #[test]
    fn latest_version_matches_the_last_migration() {
        assert_eq!(
            MIGRATIONS.last().map(|migration| migration.version),
            Some(LATEST_VERSION)
        );
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            assert_eq!(migration.version, index as u32 + 1);
        }
    }

    #[test]
    fn fresh_install_creates_the_schema_at_the_latest_version() {
        let path = temp_db("fresh");
        let (conn, report) = adopt(&path).expect("adopt");

        assert_eq!(report.from_version, 0);
        assert_eq!(report.to_version, LATEST_VERSION);
        assert_eq!(report.migrations_applied, MIGRATIONS.len());
        assert!(!report.migrated_from_legacy);
        assert!(report.backup_path.is_none());
        assert_eq!(schema_version(&conn).unwrap(), LATEST_VERSION);
        assert!(table_exists(&conn, "backup_runs").unwrap());
        assert!(table_exists(&conn, "provider_secrets").unwrap());
        drop(conn);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn adopting_twice_applies_nothing() {
        let path = temp_db("twice");
        adopt(&path).expect("first adopt");
        let (_, report) = adopt(&path).expect("second adopt");
        assert_eq!(report.migrations_applied, 0);
        assert_eq!(report.from_version, LATEST_VERSION);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn legacy_database_is_upgraded_in_place_and_keeps_its_rows() {
        let path = legacy_database("legacy");
        let (conn, report) = adopt(&path).expect("adopt");

        assert!(report.migrated_from_legacy);
        assert_eq!(report.from_version, 1);
        assert_eq!(report.to_version, LATEST_VERSION);
        assert!(report.backup_retained);
        assert!(table_exists(&conn, "backup_runs").unwrap());

        let messages: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(messages, 1);
        drop(conn);

        // Second launch retires the backup.
        let backup = backup_path_for(&path);
        assert!(backup.exists(), "backup must survive the upgrading launch");
        adopt(&path).expect("second adopt");
        assert!(!backup.exists(), "next launch retires the backup");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn unknown_senders_are_repaired_by_the_repair_migration() {
        let path = legacy_database("repair");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute("UPDATE chat_messages SET sender = 'ROBOT'", [])
                .unwrap();
        }

        let (conn, _) = adopt(&path).expect("adopt");
        let sender: String = conn
            .query_row("SELECT sender FROM chat_messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(sender, "ASSISTANT");

        // After migration the domain is enforced.
        let rejected = conn.execute(
            "INSERT INTO chat_messages (id, threadId, sender, content, timestamp, citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, agentStepsJson, isFavorite, isPinned, tagsJson) VALUES ('m', 'th_default', 'ROBOT', 'x', 1, '[]', '[]', '[]', 0, 0, '[]', 0, 0, '[]')",
            [],
        );
        assert!(rejected.is_err(), "invalid sender must be rejected");
        drop(conn);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_newer_schema_is_refused_without_touching_the_file() {
        let path = legacy_database("newer");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", 99).unwrap();
        }

        let error = adopt(&path).expect_err("must refuse");
        assert!(matches!(
            error,
            DbError::Unsupported {
                found: 99,
                supported: LATEST_VERSION
            }
        ));

        let conn = Connection::open(&path).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 99);
        drop(conn);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn orphan_rows_are_refused_and_the_backup_is_restored() {
        let path = legacy_database("orphan");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            conn.execute(
                "INSERT INTO chat_messages (id, threadId, sender, content, timestamp, citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, agentStepsJson, isFavorite, isPinned, tagsJson) VALUES ('orphan', 'th_gone', 'USER', 'x', 1, '[]', '[]', '[]', 0, 0, '[]', 0, 0, '[]')",
                [],
            )
            .unwrap();
        }

        let error = adopt(&path).expect_err("must refuse orphans");
        assert!(matches!(
            error,
            DbError::Validation {
                restored: true,
                ..
            }
        ));

        let conn = Connection::open(&path).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 1, "version must be untouched");
        let orphans: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chat_messages WHERE id = 'orphan'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 1, "the user's row must still exist");
        drop(conn);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_garbage_file_is_reported_as_corrupt_and_left_alone() {
        let path = temp_db("garbage");
        fs::write(&path, vec![0xffu8; 8192]).unwrap();

        let error = adopt(&path).expect_err("must refuse");
        assert!(error.is_corruption());

        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 8192);
        assert!(bytes.iter().all(|byte| *byte == 0xff));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn migration_files_are_embedded_verbatim() {
        // A file that failed to embed would be an empty string here, which would
        // silently produce a migration that does nothing.
        for migration in MIGRATIONS {
            assert!(
                migration.sql.contains("CREATE") || migration.sql.contains("UPDATE"),
                "migration {} appears empty",
                migration.name
            );
        }
    }
}
