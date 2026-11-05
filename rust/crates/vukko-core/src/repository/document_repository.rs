//! Document persistence.
//!
//! The Kotlin client derived `size`, `contentSummary` and `vectorCount` at write
//! time; these rules reproduce that exactly so the storage inspector shows the
//! same numbers after the migration:
//! - `size` is a display string ("0 B", "2 KB", "1.8 MB");
//! - `contentSummary` is the first 160 characters of the content;
//! - `vectorCount` is `ceil(bytes / 512)`, the chunking constant the client used.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{DocumentItem, DocumentType, Timestamp, VukkoError};
use crate::repository::{new_id, now_millis, require_text, workspace_repository};

const COLUMNS: &str = "id, workspaceId, name, type, size, vectorCount, contentSummary, \
                       fullContent, dateAdded";

/// Bytes per embedding chunk, matching the Kotlin client's chunker.
pub const CHUNK_SIZE: usize = 512;

/// Characters kept in `contentSummary`.
pub const SUMMARY_CHARS: usize = 160;

fn from_row(row: &Row<'_>) -> rusqlite::Result<DocumentItem> {
    let document_type: String = row.get("type")?;
    Ok(DocumentItem {
        id: row.get("id")?,
        workspace_id: row.get("workspaceId")?,
        name: row.get("name")?,
        document_type: DocumentType::from_wire(&document_type),
        size: row.get("size")?,
        vector_count: row.get::<_, i64>("vectorCount")?.max(0) as u32,
        content_summary: row.get("contentSummary")?,
        full_content: row.get("fullContent")?,
        date_added: row.get("dateAdded")?,
    })
}

/// Human-readable byte size in the format the client displayed.
pub fn format_bytes(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{} KB", bytes / 1024)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Number of chunks a body produces.
pub fn chunk_count(bytes: usize) -> u32 {
    bytes.div_ceil(CHUNK_SIZE) as u32
}

pub fn list(conn: &Connection, workspace_id: &str) -> Result<Vec<DocumentItem>, VukkoError> {
    let sql = format!(
        "SELECT {} FROM workspace_documents WHERE workspaceId = ?1 ORDER BY dateAdded DESC, id ASC",
        COLUMNS
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([workspace_id], from_row)?;
    let mut documents = Vec::new();
    for document in rows {
        documents.push(document?);
    }
    Ok(documents)
}

pub fn get(conn: &Connection, id: &str) -> Result<DocumentItem, VukkoError> {
    let sql = format!("SELECT {} FROM workspace_documents WHERE id = ?1", COLUMNS);
    conn.query_row(&sql, [id], from_row)
        .optional()?
        .ok_or_else(|| VukkoError::not_found(format!("document {}", id)))
}

#[derive(Debug, Clone)]
pub struct NewDocument {
    pub workspace_id: String,
    pub name: String,
    pub document_type: DocumentType,
    pub content: String,
}

pub fn create(conn: &Connection, input: &NewDocument) -> Result<DocumentItem, VukkoError> {
    let workspace = workspace_repository::get(conn, &input.workspace_id)?;
    let name = require_text(&input.name, "name", 255)?;
    let bytes = input.content.len();
    let id = new_id("doc");
    let added_at: Timestamp = now_millis();
    let summary: String = input.content.chars().take(SUMMARY_CHARS).collect();

    conn.execute(
        "INSERT INTO workspace_documents (id, workspaceId, name, type, size, vectorCount, \
         contentSummary, fullContent, dateAdded) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            workspace.id,
            name,
            input.document_type.as_wire(),
            format_bytes(bytes),
            chunk_count(bytes),
            summary,
            input.content,
            added_at,
        ],
    )?;

    workspace_repository::refresh_counters(conn, &workspace.id)?;
    get(conn, &id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), VukkoError> {
    let document = get(conn, id)?;
    conn.execute("DELETE FROM workspace_documents WHERE id = ?1", [id])?;
    workspace_repository::refresh_counters(conn, &document.workspace_id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;
    use crate::repository::workspace_repository;

    fn workspace(conn: &Connection) -> crate::domain::Workspace {
        workspace_repository::create(
            conn,
            &workspace_repository::NewWorkspace {
                name: "Docs".into(),
                ..Default::default()
            },
        )
        .expect("workspace")
    }

    #[test]
    fn sizes_match_the_client_formats() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1023), "1023 B");
        assert_eq!(format_bytes(2048), "2 KB");
        assert_eq!(format_bytes(1024 * 1024 * 3 / 2), "1.5 MB");
    }

    #[test]
    fn chunk_counts_round_up() {
        assert_eq!(chunk_count(0), 0);
        assert_eq!(chunk_count(1), 1);
        assert_eq!(chunk_count(512), 1);
        assert_eq!(chunk_count(513), 2);
    }

    #[test]
    fn create_derives_metadata_and_updates_workspace_counters() {
        let conn = fresh_db("doc_create");
        let workspace = workspace(&conn);
        let document = create(
            &conn,
            &NewDocument {
                workspace_id: workspace.id.clone(),
                name: "notes.md".into(),
                document_type: DocumentType::MARKDOWN,
                content: "a".repeat(2048),
            },
        )
        .unwrap();

        assert_eq!(document.size, "2 KB");
        assert_eq!(document.vector_count, 4);
        assert_eq!(document.content_summary.len(), SUMMARY_CHARS);
        assert!(document.id.starts_with("doc_"));

        let reloaded = workspace_repository::get(&conn, &workspace.id).unwrap();
        assert_eq!(reloaded.document_count, 1);
        assert_eq!(reloaded.vector_count, 4);
    }

    #[test]
    fn delete_decrements_the_counters() {
        let conn = fresh_db("doc_delete");
        let workspace = workspace(&conn);
        let document = create(
            &conn,
            &NewDocument {
                workspace_id: workspace.id.clone(),
                name: "notes.md".into(),
                document_type: DocumentType::MARKDOWN,
                content: "x".repeat(1024),
            },
        )
        .unwrap();

        delete(&conn, &document.id).unwrap();
        let reloaded = workspace_repository::get(&conn, &workspace.id).unwrap();
        assert_eq!(reloaded.document_count, 0);
        assert_eq!(reloaded.vector_count, 0);
        assert!(list(&conn, &workspace.id).unwrap().is_empty());
    }

    #[test]
    fn empty_metadata_stays_an_empty_string_not_null() {
        let conn = fresh_db("doc_empty");
        let workspace = workspace(&conn);
        let document = create(
            &conn,
            &NewDocument {
                workspace_id: workspace.id.clone(),
                name: "link".into(),
                document_type: DocumentType::WEB_LINK,
                content: String::new(),
            },
        )
        .unwrap();

        assert_eq!(document.content_summary, "");
        assert_eq!(document.full_content, "");
        assert_eq!(document.size, "0 B");
    }
}
