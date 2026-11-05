//! The schema contract, as data.
//!
//! These column lists are the legacy Room v1 contract (see
//! `migrations/0001_legacy_room_schema.sql`). Tests compare them against the
//! live database with `PRAGMA table_info`, so a migration that renames or drops a
//! legacy column fails loudly instead of at a user's upgrade.

/// Legacy tables and their columns, in Room's creation order.
pub const LEGACY_COLUMNS: &[(&str, &[&str])] = &[
    (
        "workspaces",
        &[
            "id",
            "name",
            "slug",
            "description",
            "systemPrompt",
            "temperature",
            "queryMode",
            "vectorCount",
            "documentCount",
            "createdAt",
            "agentMaxSteps",
            "agentAllowWebSearch",
            "agentAllowFileCreation",
            "agentAllowDocumentSearch",
        ],
    ),
    (
        "chat_threads",
        &[
            "id",
            "workspaceId",
            "name",
            "slug",
            "createdAt",
            "updatedAt",
            "messageCount",
            "lastMessageSnippet",
            "isPinned",
        ],
    ),
    (
        "chat_messages",
        &[
            "id",
            "threadId",
            "sender",
            "content",
            "timestamp",
            "thinking",
            "thinkingDurationMs",
            "citationsJson",
            "toolsUsedJson",
            "attachmentsJson",
            "isStreaming",
            "isAgentExecution",
            "agentStepsJson",
            "createdDocumentId",
            "createdDocumentName",
            "isFavorite",
            "isPinned",
            "tagsJson",
        ],
    ),
    (
        "workspace_documents",
        &[
            "id",
            "workspaceId",
            "name",
            "type",
            "size",
            "vectorCount",
            "contentSummary",
            "fullContent",
            "dateAdded",
        ],
    ),
];

/// Columns added after the legacy schema. New nullable columns are allowed;
/// removing a legacy column is not.
pub const ADDED_COLUMNS: &[(&str, &[&str])] = &[
    (
        "backup_runs",
        &[
            "id",
            "status",
            "target",
            "trigger",
            "fileName",
            "checksum",
            "workspaceCount",
            "reason",
            "completedAt",
        ],
    ),
    (
        "provider_secrets",
        &["provider", "vaultKey", "isConfigured", "updatedAt"],
    ),
    ("app_settings", &["key", "value", "updatedAt"]),
];

/// Live columns of a table, read with `PRAGMA table_info`.
pub fn columns_of(conn: &rusqlite::Connection, table: &str) -> crate::DbResult<Vec<String>> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info(\"{}\")", table))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let mut columns = Vec::new();
    for column in rows {
        columns.push(column?);
    }
    Ok(columns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate::adopt;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("vukko-schema-{}-{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn migrated_database_has_every_legacy_column_in_order() {
        let path = temp_path("columns");
        let (conn, _) = adopt(&path).expect("adopt");
        for (table, expected) in LEGACY_COLUMNS {
            let actual = columns_of(&conn, table).expect("columns");
            assert_eq!(&actual, expected, "column contract broken for {}", table);
        }
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn added_tables_carry_their_columns() {
        let path = temp_path("added");
        let (conn, _) = adopt(&path).expect("adopt");
        for (table, expected) in ADDED_COLUMNS {
            let actual = columns_of(&conn, table).expect("columns");
            assert_eq!(&actual, expected, "column contract broken for {}", table);
        }
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
