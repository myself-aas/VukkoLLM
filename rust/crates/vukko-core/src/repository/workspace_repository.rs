//! Workspace persistence.
//!
//! Rules (mirrored by `tests/support/engine.cjs` and asserted in
//! `tests/repository/repositories.test.js`):
//! - `list` returns workspaces ordered by `createdAt ASC, id ASC`;
//! - `create` generates the id (`ws_` + 12 hex chars), derives a unique slug,
//!   and applies the same defaults as the Kotlin client;
//! - validation rejects an empty name and a temperature outside 0..=2;
//! - a missing row is `NOT_FOUND`, never `None` leaking out of the public API.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{slugify, Timestamp, VukkoError, Workspace, DEFAULT_SYSTEM_PROMPT};
use crate::repository::{new_id, now_millis, require_range, require_text, unique_slug};

const COLUMNS: &str = "id, name, slug, description, systemPrompt, temperature, queryMode, \
                       vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch, \
                       agentAllowFileCreation, agentAllowDocumentSearch";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    let query_mode: String = row.get("queryMode")?;
    Ok(Workspace {
        id: row.get("id")?,
        name: row.get("name")?,
        slug: row.get("slug")?,
        description: row.get("description")?,
        system_prompt: row.get("systemPrompt")?,
        temperature: row.get("temperature")?,
        query_mode: crate::domain::workspace::QueryMode::from_wire(&query_mode),
        vector_count: row.get::<_, i64>("vectorCount")?.max(0) as u32,
        document_count: row.get::<_, i64>("documentCount")?.max(0) as u32,
        created_at: row.get("createdAt")?,
        agent_max_steps: row.get::<_, i64>("agentMaxSteps")?.max(0) as u32,
        agent_allow_web_search: row.get::<_, i64>("agentAllowWebSearch")? != 0,
        agent_allow_file_creation: row.get::<_, i64>("agentAllowFileCreation")? != 0,
        agent_allow_document_search: row.get::<_, i64>("agentAllowDocumentSearch")? != 0,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Workspace>, VukkoError> {
    let sql = format!(
        "SELECT {} FROM workspaces ORDER BY createdAt ASC, id ASC",
        COLUMNS
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], from_row)?;
    let mut workspaces = Vec::new();
    for workspace in rows {
        workspaces.push(workspace?);
    }
    Ok(workspaces)
}

pub fn get(conn: &Connection, id: &str) -> Result<Workspace, VukkoError> {
    let sql = format!("SELECT {} FROM workspaces WHERE id = ?1", COLUMNS);
    conn.query_row(&sql, [id], from_row)
        .optional()?
        .ok_or_else(|| VukkoError::not_found(format!("workspace {}", id)))
}

#[derive(Debug, Clone, Default)]
pub struct NewWorkspace {
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub temperature: Option<f32>,
}

pub fn create(conn: &Connection, input: &NewWorkspace) -> Result<Workspace, VukkoError> {
    let name = require_text(&input.name, "name", 120)?;
    let temperature = require_range(input.temperature.unwrap_or(0.7), "temperature", 0.0, 2.0)?;
    let id = new_id("ws");
    let slug = unique_slug(conn, "workspaces", &slugify(&name), None)?;
    let created_at: Timestamp = now_millis();

    conn.execute(
        "INSERT INTO workspaces (id, name, slug, description, systemPrompt, temperature, queryMode, \
         vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch, \
         agentAllowFileCreation, agentAllowDocumentSearch) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'CHAT', 0, 0, ?7, 5, 1, 1, 1)",
        params![
            id,
            name,
            slug,
            input.description.clone().unwrap_or_default().trim(),
            input
                .system_prompt
                .clone()
                .unwrap_or_else(|| DEFAULT_SYSTEM_PROMPT.to_string())
                .trim(),
            temperature,
            created_at,
        ],
    )?;

    get(conn, &id)
}

/// Applies an edited workspace. Slug and creation time are immutable.
pub fn update(conn: &Connection, workspace: &Workspace) -> Result<Workspace, VukkoError> {
    let existing = get(conn, &workspace.id)?;
    let name = require_text(&workspace.name, "name", 120)?;
    let temperature = require_range(workspace.temperature, "temperature", 0.0, 2.0)?;
    let max_steps =
        require_range(workspace.agent_max_steps as f32, "agentMaxSteps", 1.0, 20.0)? as u32;

    conn.execute(
        "UPDATE workspaces SET name = ?2, description = ?3, systemPrompt = ?4, temperature = ?5, \
         queryMode = ?6, agentMaxSteps = ?7, agentAllowWebSearch = ?8, agentAllowFileCreation = ?9, \
         agentAllowDocumentSearch = ?10 WHERE id = ?1",
        params![
            existing.id,
            name,
            workspace.description,
            workspace.system_prompt,
            temperature,
            workspace.query_mode.as_wire(),
            max_steps,
            i64::from(workspace.agent_allow_web_search),
            i64::from(workspace.agent_allow_file_creation),
            i64::from(workspace.agent_allow_document_search),
        ],
    )?;

    get(conn, &existing.id)
}

/// Deletes a workspace. Threads, messages and documents go with it through the
/// `ON DELETE CASCADE` foreign keys.
pub fn delete(conn: &Connection, id: &str) -> Result<(), VukkoError> {
    get(conn, id)?;
    conn.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
    Ok(())
}

/// Recomputes the cached document/vector counters the workspace list displays.
pub fn refresh_counters(conn: &Connection, workspace_id: &str) -> Result<(), VukkoError> {
    conn.execute(
        "UPDATE workspaces SET \
           documentCount = (SELECT COUNT(*) FROM workspace_documents WHERE workspaceId = ?1), \
           vectorCount = COALESCE((SELECT SUM(vectorCount) FROM workspace_documents WHERE workspaceId = ?1), 0) \
         WHERE id = ?1",
        [workspace_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;

    #[test]
    fn created_workspace_gets_generated_id_slug_and_defaults() {
        let conn = fresh_db("ws_create");
        let workspace = create(
            &conn,
            &NewWorkspace {
                name: "Research Notes".into(),
                ..Default::default()
            },
        )
        .expect("create");

        assert!(workspace.id.starts_with("ws_"));
        assert_eq!(workspace.id.len(), 3 + 12);
        assert_eq!(workspace.slug, "research-notes");
        assert_eq!(workspace.query_mode, crate::domain::QueryMode::CHAT);
        assert_eq!(workspace.agent_max_steps, 5);
        assert!(workspace.agent_allow_web_search);
        assert_eq!(workspace.document_count, 0);
        assert!(workspace.created_at > 0);
    }

    #[test]
    fn duplicates_get_unique_slugs() {
        let conn = fresh_db("ws_slug");
        let a = create(
            &conn,
            &NewWorkspace {
                name: "Work".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let b = create(
            &conn,
            &NewWorkspace {
                name: "Work".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(a.slug, "work");
        assert_eq!(b.slug, "work-2");
    }

    #[test]
    fn list_is_oldest_first() {
        let conn = fresh_db("ws_list");
        let first = create(
            &conn,
            &NewWorkspace {
                name: "First".into(),
                ..Default::default()
            },
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = create(
            &conn,
            &NewWorkspace {
                name: "Second".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let ids: Vec<String> = list(&conn).unwrap().into_iter().map(|w| w.id).collect();
        assert_eq!(ids, vec![first.id, second.id]);
    }

    #[test]
    fn validation_rejects_empty_names_and_bad_temperatures() {
        let conn = fresh_db("ws_validation");
        let empty = create(
            &conn,
            &NewWorkspace {
                name: "   ".into(),
                ..Default::default()
            },
        );
        assert_eq!(
            empty.unwrap_err().code,
            crate::domain::ErrorCode::VALIDATION
        );

        let hot = create(
            &conn,
            &NewWorkspace {
                name: "Hot".into(),
                temperature: Some(3.5),
                ..Default::default()
            },
        );
        assert_eq!(hot.unwrap_err().code, crate::domain::ErrorCode::VALIDATION);
    }

    #[test]
    fn missing_workspace_is_not_found() {
        let conn = fresh_db("ws_missing");
        assert_eq!(
            get(&conn, "ws_missing").unwrap_err().code,
            crate::domain::ErrorCode::NOT_FOUND
        );
    }

    #[test]
    fn delete_cascades_to_children() {
        let conn = fresh_db("ws_delete");
        let workspace = create(
            &conn,
            &NewWorkspace {
                name: "Doomed".into(),
                ..Default::default()
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, isPinned) \
             VALUES ('th_1', ?1, 'Chat', 'chat', 1, 1, 0, 0)",
            [&workspace.id],
        )
        .unwrap();

        delete(&conn, &workspace.id).unwrap();

        let threads: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(threads, 0);
        assert!(list(&conn).unwrap().is_empty());
    }
}
