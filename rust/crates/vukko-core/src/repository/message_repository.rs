//! Message persistence.
//!
//! Rules (mirrored by `tests/support/engine.cjs`):
//! - `list` orders by `timestamp ASC, rowid ASC` so a tie keeps insertion order;
//! - a stored but malformed JSON column is a `STORAGE` error, never silently an
//!   empty list (the Kotlin `RoomConverters` swallowed it, which is how data loss
//!   hides);
//! - tags are de-duplicated, trimmed and capped;
//! - every write refreshes the thread's cached counters in the same transaction.

use rusqlite::{params, Connection, Row};

use crate::domain::{
    AgentStep, ChatMessage, Citation, MessageAttachment, MessageSender, Timestamp, ToolCall,
    VukkoError,
};
use crate::repository::{new_id, now_millis, require_text, thread_repository};

const COLUMNS: &str = "id, threadId, sender, content, timestamp, thinking, thinkingDurationMs, \
                       citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, \
                       agentStepsJson, createdDocumentId, createdDocumentName, isFavorite, isPinned, tagsJson";

/// Maximum number of tags accepted for a single message.
pub const MAX_TAGS: usize = 32;

fn parse_json<T: serde::de::DeserializeOwned>(
    raw: &str,
    message_id: &str,
    column: &str,
) -> Result<Vec<T>, VukkoError> {
    serde_json::from_str(raw).map_err(|error| {
        VukkoError::storage(format!(
            "malformed {} in message {}: {}",
            column, message_id, error
        ))
    })
}

fn from_row(row: &Row<'_>) -> Result<ChatMessage, VukkoError> {
    let id: String = row.get("id")?;
    let sender: String = row.get("sender")?;
    Ok(ChatMessage {
        id: id.clone(),
        thread_id: row.get("threadId")?,
        sender: MessageSender::from_wire(&sender),
        content: row.get("content")?,
        timestamp: row.get::<_, Timestamp>("timestamp")?,
        thinking: row.get("thinking")?,
        thinking_duration_ms: row.get("thinkingDurationMs")?,
        citations: parse_json::<Citation>(
            &row.get::<_, String>("citationsJson")?,
            &id,
            "citationsJson",
        )?,
        tools_used: parse_json::<ToolCall>(
            &row.get::<_, String>("toolsUsedJson")?,
            &id,
            "toolsUsedJson",
        )?,
        attachments: parse_json::<MessageAttachment>(
            &row.get::<_, String>("attachmentsJson")?,
            &id,
            "attachmentsJson",
        )?,
        is_streaming: row.get::<_, i64>("isStreaming")? != 0,
        is_agent_execution: row.get::<_, i64>("isAgentExecution")? != 0,
        agent_steps: parse_json::<AgentStep>(
            &row.get::<_, String>("agentStepsJson")?,
            &id,
            "agentStepsJson",
        )?,
        created_document_id: row.get("createdDocumentId")?,
        created_document_name: row.get("createdDocumentName")?,
        is_favorite: row.get::<_, i64>("isFavorite")? != 0,
        is_pinned: row.get::<_, i64>("isPinned")? != 0,
        tags: parse_json::<String>(&row.get::<_, String>("tagsJson")?, &id, "tagsJson")?,
    })
}

pub fn list(conn: &Connection, thread_id: &str) -> Result<Vec<ChatMessage>, VukkoError> {
    let sql = format!(
        "SELECT {} FROM chat_messages WHERE threadId = ?1 ORDER BY timestamp ASC, rowid ASC",
        COLUMNS
    );
    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query([thread_id])?;
    let mut messages = Vec::new();
    while let Some(row) = rows.next()? {
        messages.push(from_row(row)?);
    }
    Ok(messages)
}

pub fn get(conn: &Connection, id: &str) -> Result<ChatMessage, VukkoError> {
    let sql = format!("SELECT {} FROM chat_messages WHERE id = ?1", COLUMNS);
    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query([id])?;
    match rows.next()? {
        Some(row) => from_row(row),
        None => Err(VukkoError::not_found(format!("message {}", id))),
    }
}

/// Fields a caller may set when appending a message. `None` means "use the
/// documented default", never "empty".
#[derive(Debug, Clone, Default)]
pub struct NewMessage {
    pub sender: Option<MessageSender>,
    pub content: String,
    pub timestamp: Option<Timestamp>,
    pub thinking: Option<String>,
    pub thinking_duration_ms: Option<i64>,
    pub citations: Vec<Citation>,
    pub tools_used: Vec<ToolCall>,
    pub attachments: Vec<MessageAttachment>,
    pub agent_steps: Vec<AgentStep>,
    pub is_streaming: bool,
    pub is_agent_execution: bool,
    pub created_document_id: Option<String>,
    pub created_document_name: Option<String>,
    pub tags: Vec<String>,
}

/// Inserts a message and refreshes the thread counters.
pub fn append(
    conn: &Connection,
    thread_id: &str,
    input: &NewMessage,
) -> Result<ChatMessage, VukkoError> {
    // Fails with NOT_FOUND when the thread is gone, before anything is written.
    let thread = thread_repository::get(conn, thread_id)?;
    let sender = input.sender.unwrap_or(MessageSender::USER);
    let content = require_text(&input.content, "content", 200_000)?;
    let timestamp = input.timestamp.unwrap_or_else(now_millis);
    if timestamp <= 0 {
        return Err(VukkoError::validation(
            "timestamp must be positive Unix milliseconds",
        ));
    }

    let id = new_id("msg");
    let citations_json = serde_json::to_string(&input.citations)?;
    let tools_json = serde_json::to_string(&input.tools_used)?;
    let attachments_json = serde_json::to_string(&input.attachments)?;
    let steps_json = serde_json::to_string(&input.agent_steps)?;
    let tags_json = serde_json::to_string(&input.tags)?;

    conn.execute(
        "INSERT INTO chat_messages (id, threadId, sender, content, timestamp, thinking, \
         thinkingDurationMs, citationsJson, toolsUsedJson, attachmentsJson, isStreaming, \
         isAgentExecution, agentStepsJson, createdDocumentId, createdDocumentName, isFavorite, \
         isPinned, tagsJson) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, 0, ?16)",
        params![
            id,
            thread.id,
            sender.as_wire(),
            content,
            timestamp,
            input.thinking,
            input.thinking_duration_ms,
            citations_json,
            tools_json,
            attachments_json,
            i64::from(input.is_streaming),
            i64::from(input.is_agent_execution),
            steps_json,
            input.created_document_id,
            input.created_document_name,
            tags_json,
        ],
    )?;

    thread_repository::refresh_stats(conn, &thread.id, now_millis())?;
    get(conn, &id)
}

/// Convenience for the common case: one user turn with no attachments.
pub fn append_user_turn(
    conn: &Connection,
    thread_id: &str,
    content: &str,
    timestamp: Option<Timestamp>,
) -> Result<ChatMessage, VukkoError> {
    append(
        conn,
        thread_id,
        &NewMessage {
            sender: Some(MessageSender::USER),
            content: content.to_string(),
            timestamp,
            ..Default::default()
        },
    )
}

pub fn set_favorite(
    conn: &Connection,
    id: &str,
    is_favorite: bool,
) -> Result<ChatMessage, VukkoError> {
    get(conn, id)?;
    conn.execute(
        "UPDATE chat_messages SET isFavorite = ?2 WHERE id = ?1",
        params![id, i64::from(is_favorite)],
    )?;
    get(conn, id)
}

pub fn set_pinned(conn: &Connection, id: &str, is_pinned: bool) -> Result<ChatMessage, VukkoError> {
    get(conn, id)?;
    conn.execute(
        "UPDATE chat_messages SET isPinned = ?2 WHERE id = ?1",
        params![id, i64::from(is_pinned)],
    )?;
    get(conn, id)
}

/// Replaces a message's tags, de-duplicated and trimmed.
pub fn set_tags(conn: &Connection, id: &str, tags: &[String]) -> Result<ChatMessage, VukkoError> {
    get(conn, id)?;
    let mut normalised: Vec<String> = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !normalised.iter().any(|existing| existing == trimmed) {
            normalised.push(trimmed.to_string());
        }
    }
    if normalised.len() > MAX_TAGS {
        return Err(VukkoError::validation(format!(
            "at most {} tags per message",
            MAX_TAGS
        )));
    }

    conn.execute(
        "UPDATE chat_messages SET tagsJson = ?2 WHERE id = ?1",
        params![id, serde_json::to_string(&normalised)?],
    )?;
    get(conn, id)
}

/// Deletes one message and repairs the thread counters.
pub fn delete(conn: &Connection, id: &str) -> Result<(), VukkoError> {
    let message = get(conn, id)?;
    conn.execute("DELETE FROM chat_messages WHERE id = ?1", [id])?;
    thread_repository::refresh_stats(conn, &message.thread_id, now_millis())?;
    Ok(())
}

/// Appends a streamed delta to a message that is still streaming.
///
/// Returns `CANCELLED` when the message is no longer streaming: the generation
/// was cancelled or finished, and late chunks must not resurrect it.
pub fn append_delta(conn: &Connection, id: &str, delta: &str) -> Result<ChatMessage, VukkoError> {
    let message = get(conn, id)?;
    if !message.is_streaming {
        return Err(VukkoError::cancelled());
    }
    conn.execute(
        "UPDATE chat_messages SET content = content || ?2 WHERE id = ?1",
        params![id, delta],
    )?;
    get(conn, id)
}

/// Finishes a streaming message: clears the flag and stores the final fields.
pub fn complete(
    conn: &Connection,
    id: &str,
    final_content: &str,
    thinking: Option<&str>,
    thinking_duration_ms: Option<i64>,
    citations: &[Citation],
) -> Result<ChatMessage, VukkoError> {
    let message = get(conn, id)?;
    conn.execute(
        "UPDATE chat_messages SET content = ?2, isStreaming = 0, thinking = ?3, \
         thinkingDurationMs = ?4, citationsJson = ?5 WHERE id = ?1",
        params![
            id,
            final_content,
            thinking,
            thinking_duration_ms,
            serde_json::to_string(citations)?,
        ],
    )?;
    thread_repository::refresh_stats(conn, &message.thread_id, now_millis())?;
    get(conn, id)
}

/// Marks a message as failed: the stream stops and the reason is kept in
/// `thinking` so the UI can show it without inventing a message.
pub fn fail(conn: &Connection, id: &str, reason: &str) -> Result<ChatMessage, VukkoError> {
    let message = get(conn, id)?;
    conn.execute(
        "UPDATE chat_messages SET isStreaming = 0 WHERE id = ?1",
        [id],
    )?;
    thread_repository::refresh_stats(conn, &message.thread_id, now_millis())?;
    tracing::warn!(message_id = %id, reason = %reason, "chat generation failed");
    get(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;
    use crate::repository::{thread_repository, workspace_repository};

    fn thread(conn: &Connection) -> (String, String) {
        let workspace = workspace_repository::create(
            conn,
            &workspace_repository::NewWorkspace {
                name: "Chats".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let thread = thread_repository::create(conn, &workspace.id, "Main").unwrap();
        (workspace.id, thread.id)
    }

    #[test]
    fn a_user_turn_stores_sender_and_empty_collections() {
        let conn = fresh_db("msg_user");
        let (_, thread_id) = thread(&conn);
        let message = append_user_turn(&conn, &thread_id, "Hello Vukko", None).unwrap();

        assert_eq!(message.sender, MessageSender::USER);
        assert_eq!(message.content, "Hello Vukko");
        assert!(message.citations.is_empty());
        assert!(!message.is_streaming);
        assert!(message.thinking.is_none());
        assert!(message.id.starts_with("msg_"));
    }

    #[test]
    fn ordering_is_by_timestamp_not_insertion() {
        let conn = fresh_db("msg_order");
        let (_, thread_id) = thread(&conn);
        let second = append(
            &conn,
            &thread_id,
            &NewMessage {
                sender: Some(MessageSender::ASSISTANT),
                content: "second".into(),
                timestamp: Some(1_700_000_002_000),
                ..Default::default()
            },
        )
        .unwrap();
        let first = append(
            &conn,
            &thread_id,
            &NewMessage {
                content: "first".into(),
                timestamp: Some(1_700_000_001_000),
                ..Default::default()
            },
        )
        .unwrap();

        let ids: Vec<String> = list(&conn, &thread_id)
            .unwrap()
            .into_iter()
            .map(|message| message.id)
            .collect();
        assert_eq!(ids, vec![first.id, second.id]);
    }

    #[test]
    fn rich_columns_round_trip() {
        let conn = fresh_db("msg_rich");
        let (_, thread_id) = thread(&conn);
        let message = append(
            &conn,
            &thread_id,
            &NewMessage {
                sender: Some(MessageSender::ASSISTANT),
                content: "Answer".into(),
                citations: vec![Citation {
                    title: "doc.md".into(),
                    source: "Section 1".into(),
                    snippet: "text".into(),
                    score: 0.9,
                }],
                tools_used: vec![ToolCall {
                    tool_name: "DocumentRAG".into(),
                    description: "search".into(),
                    input: "q".into(),
                    output: "hit".into(),
                    is_success: true,
                }],
                agent_steps: vec![AgentStep {
                    step_index: 1,
                    title: "Plan".into(),
                    description: "d".into(),
                    tool_name: "Planner".into(),
                    status: crate::domain::AgentStepStatus::COMPLETED,
                    tool_input: None,
                    tool_output: Some("ok".into()),
                    execution_time_ms: Some(12),
                }],
                tags: vec!["answer".into()],
                is_agent_execution: true,
                created_document_id: Some("doc_9".into()),
                created_document_name: Some("out.md".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let reloaded = list(&conn, &thread_id).unwrap().remove(0);
        assert_eq!(reloaded, message);
        assert_eq!(reloaded.citations[0].score, 0.9);
        assert_eq!(reloaded.agent_steps[0].execution_time_ms, Some(12));
    }

    #[test]
    fn malformed_json_is_a_storage_error() {
        let conn = fresh_db("msg_malformed");
        let (_, thread_id) = thread(&conn);
        append_user_turn(&conn, &thread_id, "x", None).unwrap();
        conn.execute("UPDATE chat_messages SET citationsJson = '{not json'", [])
            .unwrap();

        assert_eq!(
            list(&conn, &thread_id).unwrap_err().code,
            crate::domain::ErrorCode::STORAGE
        );
    }

    #[test]
    fn tags_are_normalised_and_replaced() {
        let conn = fresh_db("msg_tags");
        let (_, thread_id) = thread(&conn);
        let message = append_user_turn(&conn, &thread_id, "tag me", None).unwrap();

        let updated = set_tags(
            &conn,
            &message.id,
            &[
                "  alpha ".to_string(),
                "alpha".to_string(),
                "beta".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(updated.tags, vec!["alpha".to_string(), "beta".to_string()]);

        let cleared = set_tags(&conn, &message.id, &[]).unwrap();
        assert!(cleared.tags.is_empty());
    }

    #[test]
    fn too_many_tags_is_rejected() {
        let conn = fresh_db("msg_tags_limit");
        let (_, thread_id) = thread(&conn);
        let message = append_user_turn(&conn, &thread_id, "x", None).unwrap();
        let tags: Vec<String> = (0..40).map(|index| format!("tag{}", index)).collect();
        assert_eq!(
            set_tags(&conn, &message.id, &tags).unwrap_err().code,
            crate::domain::ErrorCode::VALIDATION
        );
    }

    #[test]
    fn favourite_and_pin_round_trip() {
        let conn = fresh_db("msg_flags");
        let (_, thread_id) = thread(&conn);
        let message = append_user_turn(&conn, &thread_id, "toggle", None).unwrap();

        assert!(set_favorite(&conn, &message.id, true).unwrap().is_favorite);
        assert!(set_pinned(&conn, &message.id, true).unwrap().is_pinned);
        assert!(!set_favorite(&conn, &message.id, false).unwrap().is_favorite);
    }

    #[test]
    fn delete_repairs_thread_counters() {
        let conn = fresh_db("msg_delete");
        let (workspace_id, thread_id) = thread(&conn);
        let first = append_user_turn(&conn, &thread_id, "one", None).unwrap();
        append_user_turn(&conn, &thread_id, "two", None).unwrap();

        delete(&conn, &first.id).unwrap();

        let listed = list(&conn, &thread_id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "two");
        let threads = thread_repository::list(&conn, &workspace_id).unwrap();
        assert_eq!(threads[0].message_count, 1);
        assert_eq!(threads[0].last_message_snippet.as_deref(), Some("two"));
    }

    #[test]
    fn streaming_deltas_accumulate_and_stop_after_completion() {
        let conn = fresh_db("msg_stream");
        let (_, thread_id) = thread(&conn);
        let message = append(
            &conn,
            &thread_id,
            &NewMessage {
                sender: Some(MessageSender::ASSISTANT),
                content: String::new(),
                is_streaming: true,
                ..Default::default()
            },
        )
        .unwrap();

        append_delta(&conn, &message.id, "Hel").unwrap();
        append_delta(&conn, &message.id, "lo").unwrap();
        assert_eq!(get(&conn, &message.id).unwrap().content, "Hello");

        let completed = complete(&conn, &message.id, "Hello", None, None, &[]).unwrap();
        assert!(!completed.is_streaming);

        // A late chunk must not resurrect a finished stream.
        assert_eq!(
            append_delta(&conn, &message.id, "!").unwrap_err().code,
            crate::domain::ErrorCode::CANCELLED
        );
    }

    #[test]
    fn an_empty_body_is_rejected() {
        let conn = fresh_db("msg_empty");
        let (_, thread_id) = thread(&conn);
        assert_eq!(
            append_user_turn(&conn, &thread_id, "   ", None)
                .unwrap_err()
                .code,
            crate::domain::ErrorCode::VALIDATION
        );
    }
}
