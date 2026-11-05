//! Thread persistence and the cached counters the drawer renders.
//!
//! Rules (mirrored by `tests/support/engine.cjs`):
//! - `list` orders by `isPinned DESC, updatedAt DESC, createdAt DESC, id ASC`;
//! - `create` requires an existing workspace (`NOT_FOUND` otherwise);
//! - every message write refreshes `messageCount`, `lastMessageSnippet` and
//!   `updatedAt` inside the same transaction as the message itself;
//! - slugs are stable for the lifetime of a thread; renaming does not change one.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{Timestamp, VukkoError, WorkspaceThread};
use crate::repository::{new_id, now_millis, require_text, unique_slug, workspace_repository};

const COLUMNS: &str = "id, workspaceId, name, slug, createdAt, updatedAt, messageCount, \
                       lastMessageSnippet, isPinned";

/// Longest snippet kept for the drawer preview.
pub const SNIPPET_LEN: usize = 120;

fn from_row(row: &Row<'_>) -> rusqlite::Result<WorkspaceThread> {
    Ok(WorkspaceThread {
        id: row.get("id")?,
        workspace_id: row.get("workspaceId")?,
        name: row.get("name")?,
        slug: row.get("slug")?,
        created_at: row.get("createdAt")?,
        updated_at: row.get("updatedAt")?,
        message_count: row.get::<_, i64>("messageCount")?.max(0) as u32,
        last_message_snippet: row.get("lastMessageSnippet")?,
        is_pinned: row.get::<_, i64>("isPinned")? != 0,
    })
}

pub fn list(conn: &Connection, workspace_id: &str) -> Result<Vec<WorkspaceThread>, VukkoError> {
    let sql = format!(
        "SELECT {} FROM chat_threads WHERE workspaceId = ?1 \
         ORDER BY isPinned DESC, updatedAt DESC, createdAt DESC, id ASC",
        COLUMNS
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([workspace_id], from_row)?;
    let mut threads = Vec::new();
    for thread in rows {
        threads.push(thread?);
    }
    Ok(threads)
}

pub fn get(conn: &Connection, id: &str) -> Result<WorkspaceThread, VukkoError> {
    let sql = format!("SELECT {} FROM chat_threads WHERE id = ?1", COLUMNS);
    conn.query_row(&sql, [id], from_row)
        .optional()?
        .ok_or_else(|| VukkoError::not_found(format!("thread {}", id)))
}

pub fn create(
    conn: &Connection,
    workspace_id: &str,
    name: &str,
) -> Result<WorkspaceThread, VukkoError> {
    let workspace = workspace_repository::get(conn, workspace_id)?;
    let name = require_text(name, "name", 120)?;
    let id = new_id("th");
    let timestamp: Timestamp = now_millis();
    let slug = unique_slug(conn, "chat_threads", &crate::domain::slugify(&name), None)?;

    conn.execute(
        "INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, \
         lastMessageSnippet, isPinned) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, NULL, 0)",
        params![id, workspace.id, name, slug, timestamp],
    )?;

    get(conn, &id)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<WorkspaceThread, VukkoError> {
    let thread = get(conn, id)?;
    let name = require_text(name, "name", 120)?;
    conn.execute(
        "UPDATE chat_threads SET name = ?2, updatedAt = ?3 WHERE id = ?1",
        params![thread.id, name, now_millis()],
    )?;
    get(conn, id)
}

pub fn set_pinned(
    conn: &Connection,
    id: &str,
    is_pinned: bool,
) -> Result<WorkspaceThread, VukkoError> {
    let thread = get(conn, id)?;
    conn.execute(
        "UPDATE chat_threads SET isPinned = ?2 WHERE id = ?1",
        params![thread.id, i64::from(is_pinned)],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), VukkoError> {
    get(conn, id)?;
    conn.execute("DELETE FROM chat_threads WHERE id = ?1", [id])?;
    Ok(())
}

/// Recomputes `messageCount`, `lastMessageSnippet` and `updatedAt`.
///
/// Called by every message mutation inside the same transaction, so the cached
/// counters can never disagree with the rows they summarise.
pub fn refresh_stats(
    conn: &Connection,
    thread_id: &str,
    updated_at: Timestamp,
) -> Result<(), VukkoError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_messages WHERE threadId = ?1",
        [thread_id],
        |row| row.get(0),
    )?;

    let snippet: Option<String> = conn
        .query_row(
            "SELECT content FROM chat_messages WHERE threadId = ?1 \
             ORDER BY timestamp DESC, rowid DESC LIMIT 1",
            [thread_id],
            |row| row.get(0),
        )
        .optional()?;

    let snippet = snippet.map(|content| {
        if content.chars().count() <= SNIPPET_LEN {
            content
        } else {
            content.chars().take(SNIPPET_LEN).collect()
        }
    });

    conn.execute(
        "UPDATE chat_threads SET messageCount = ?2, lastMessageSnippet = ?3, updatedAt = ?4 \
         WHERE id = ?1",
        params![thread_id, count, snippet, updated_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;
    use crate::repository::{message_repository, workspace_repository};

    fn workspace(conn: &Connection, name: &str) -> crate::domain::Workspace {
        workspace_repository::create(
            conn,
            &workspace_repository::NewWorkspace {
                name: name.to_string(),
                ..Default::default()
            },
        )
        .expect("workspace")
    }

    #[test]
    fn new_threads_are_newest_first_and_pinning_wins() {
        let conn = fresh_db("th_order");
        let workspace = workspace(&conn, "Threads");
        let older = create(&conn, &workspace.id, "Older").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let newer = create(&conn, &workspace.id, "Newer").unwrap();

        let ids: Vec<String> = list(&conn, &workspace.id)
            .unwrap()
            .into_iter()
            .map(|thread| thread.id)
            .collect();
        assert_eq!(ids, vec![newer.id.clone(), older.id.clone()]);

        set_pinned(&conn, &older.id, true).unwrap();
        let ids: Vec<String> = list(&conn, &workspace.id)
            .unwrap()
            .into_iter()
            .map(|thread| thread.id)
            .collect();
        assert_eq!(ids, vec![older.id, newer.id]);
    }

    #[test]
    fn renaming_keeps_the_slug_and_moves_updated_at() {
        let conn = fresh_db("th_rename");
        let workspace = workspace(&conn, "Threads");
        let thread = create(&conn, &workspace.id, "Plan").unwrap();
        let renamed = rename(&conn, &thread.id, "Plan v2").unwrap();

        assert_eq!(renamed.name, "Plan v2");
        assert_eq!(renamed.slug, thread.slug);
        assert!(renamed.updated_at >= thread.updated_at);
    }

    #[test]
    fn counters_track_message_writes() {
        let conn = fresh_db("th_counters");
        let workspace = workspace(&conn, "Threads");
        let thread = create(&conn, &workspace.id, "Counts").unwrap();

        message_repository::append_user_turn(&conn, &thread.id, "first message", None).unwrap();
        message_repository::append_user_turn(&conn, &thread.id, "second message", None).unwrap();

        let listed = list(&conn, &workspace.id).unwrap();
        assert_eq!(listed[0].message_count, 2);
        assert_eq!(
            listed[0].last_message_snippet.as_deref(),
            Some("second message")
        );
    }

    #[test]
    fn an_empty_thread_has_no_snippet() {
        let conn = fresh_db("th_empty");
        let workspace = workspace(&conn, "Threads");
        create(&conn, &workspace.id, "Empty").unwrap();
        let listed = list(&conn, &workspace.id).unwrap();
        assert!(listed[0].last_message_snippet.is_none());
    }

    #[test]
    fn a_thread_needs_an_existing_workspace() {
        let conn = fresh_db("th_orphan");
        let error = create(&conn, "ws_missing", "Orphan").unwrap_err();
        assert_eq!(error.code, crate::domain::ErrorCode::NOT_FOUND);
    }

    #[test]
    fn workspaces_do_not_leak_threads_into_each_other() {
        let conn = fresh_db("th_scope");
        let mine = workspace(&conn, "Mine");
        let theirs = workspace(&conn, "Theirs");
        create(&conn, &mine.id, "Mine").unwrap();
        create(&conn, &theirs.id, "Theirs").unwrap();

        let listed = list(&conn, &mine.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Mine");
    }

    #[test]
    fn snippets_are_truncated_to_the_drawer_width() {
        let conn = fresh_db("th_snippet");
        let workspace = workspace(&conn, "Threads");
        let thread = create(&conn, &workspace.id, "Long").unwrap();
        let long = "word ".repeat(60);
        message_repository::append_user_turn(&conn, &thread.id, &long, None).unwrap();

        let snippet = list(&conn, &workspace.id).unwrap()[0]
            .last_message_snippet
            .clone()
            .unwrap();
        assert_eq!(snippet.chars().count(), SNIPPET_LEN);
    }
}
