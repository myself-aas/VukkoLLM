//! Thread and database export.
//!
//! The three formats reproduce what the Kotlin client wrote, because users have
//! shared those files and tooling reads them (MIGRATION_PLAN.md §3 Step 0.3):
//!
//! * markdown — `# Vukko Chat Export (Local Sovereign Storage)` header, one
//!   `### SENDER` block per message, citations listed as `- [title] snippet`;
//! * json — `{ threadId, database, dataSovereignty, messages: [{sender, content}] }`;
//! * text — `SENDER: content` separated by blank lines.
//!
//! Unlike the Kotlin version, JSON is produced by a real serialiser: the old
//! implementation concatenated strings and only escaped `"` and `\n`, which
//! produced invalid JSON for any message containing a tab, a backslash or a
//! control character.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::domain::{ChatMessage, VukkoError, DATABASE_NAME};
use crate::repository::{message_repository, thread_repository};

/// Accepted export formats, matching the Kotlin `when (format.lowercase())`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Markdown,
    Json,
    Text,
}

impl ExportFormat {
    /// Parses the user-facing format name; `md` is an accepted alias.
    pub fn parse(value: &str) -> Result<Self, VukkoError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "markdown" | "md" => Ok(Self::Markdown),
            "json" => Ok(Self::Json),
            "text" | "txt" => Ok(Self::Text),
            other => Err(VukkoError::validation(format!(
                "unknown export format: {}",
                other
            ))),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Json => "json",
            Self::Text => "txt",
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Markdown => "text/markdown",
            Self::Json => "application/json",
            Self::Text => "text/plain",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub format: ExportFormat,
    pub file_name: String,
    pub mime_type: String,
    pub content: String,
    pub bytes: usize,
    pub message_count: usize,
    pub exported_at: i64,
}

fn sender_label(message: &ChatMessage) -> &'static str {
    message.sender.as_wire()
}

pub fn render_markdown(thread_id: &str, messages: &[ChatMessage]) -> String {
    let mut out = String::new();
    out.push_str("# Vukko Chat Export (Local Sovereign Storage)\n");
    out.push_str(&format!("*Thread ID: {}*\n", thread_id));
    out.push_str(&format!("*Storage: Rust SQLite (`{}`)*\n\n", DATABASE_NAME));

    for message in messages {
        out.push_str(&format!("### {}\n", sender_label(message)));
        out.push_str(&message.content);
        out.push_str("\n\n");
        if !message.citations.is_empty() {
            out.push_str("**Citations:**\n");
            for citation in &message.citations {
                out.push_str(&format!("- [{}] {}\n", citation.title, citation.snippet));
            }
            out.push('\n');
        }
    }
    out
}

pub fn render_json(thread_id: &str, messages: &[ChatMessage]) -> Result<String, VukkoError> {
    let payload = serde_json::json!({
        "threadId": thread_id,
        "database": DATABASE_NAME,
        "dataSovereignty": true,
        "messages": messages
            .iter()
            .map(|message| serde_json::json!({
                "sender": sender_label(message),
                "content": message.content,
            }))
            .collect::<Vec<_>>(),
    });
    // pretty-printed but valid: the Kotlin writer was not.
    Ok(serde_json::to_string_pretty(&payload)?)
}

pub fn render_text(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .map(|message| format!("{}: {}", sender_label(message), message.content))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Exports one thread in the requested format.
pub fn export_thread(
    conn: &Connection,
    thread_id: &str,
    format: ExportFormat,
    exported_at: i64,
) -> Result<ExportResult, VukkoError> {
    // A missing thread is NOT_FOUND, not an empty export: silently producing a
    // file for a thread the database does not have hides the caller's bug.
    thread_repository::get(conn, thread_id)?;
    let messages = message_repository::list(conn, thread_id)?;
    let content = match format {
        ExportFormat::Markdown => render_markdown(thread_id, &messages),
        ExportFormat::Json => render_json(thread_id, &messages)?,
        ExportFormat::Text => render_text(&messages),
    };

    Ok(ExportResult {
        format,
        file_name: format!(
            "vukko_thread_{}_{}.{}",
            thread_id,
            exported_at,
            format.extension()
        ),
        mime_type: format.mime_type().to_string(),
        bytes: content.len(),
        content,
        message_count: messages.len(),
        exported_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Citation;
    use crate::repository::test_support::fresh_db;
    use crate::repository::{message_repository, thread_repository, workspace_repository};

    fn thread_with_messages(name: &str) -> (Connection, String) {
        let conn = fresh_db(name);
        let workspace = workspace_repository::create(
            &conn,
            &workspace_repository::NewWorkspace {
                name: "Exports".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let thread = thread_repository::create(&conn, &workspace.id, "Thread").unwrap();
        message_repository::append_user_turn(
            &conn,
            &thread.id,
            "Hello \"world\"\tand\\slash",
            None,
        )
        .unwrap();
        message_repository::append(
            &conn,
            &thread.id,
            &message_repository::NewMessage {
                sender: Some(crate::domain::MessageSender::ASSISTANT),
                content: "Answer\nwith lines".into(),
                citations: vec![Citation {
                    title: "doc.md".into(),
                    source: "s".into(),
                    snippet: "snip".into(),
                    score: 0.5,
                }],
                ..Default::default()
            },
        )
        .unwrap();
        (conn, thread.id)
    }

    #[test]
    fn markdown_keeps_the_documented_header_and_citations() {
        let (conn, thread_id) = thread_with_messages("export_md");
        let result =
            export_thread(&conn, &thread_id, ExportFormat::Markdown, 1_700_000_000_000).unwrap();

        assert!(result
            .content
            .starts_with("# Vukko Chat Export (Local Sovereign Storage)\n"));
        assert!(result.content.contains("*Thread ID: "));
        assert!(result.content.contains("### USER"));
        assert!(result.content.contains("### ASSISTANT"));
        assert!(result.content.contains("**Citations:**"));
        assert!(result.content.contains("- [doc.md] snip"));
        assert_eq!(result.message_count, 2);
        assert!(result.file_name.ends_with(".md"));
        assert_eq!(result.mime_type, "text/markdown");
    }

    #[test]
    fn json_is_valid_even_for_messages_with_control_characters() {
        let (conn, thread_id) = thread_with_messages("export_json");
        let result = export_thread(&conn, &thread_id, ExportFormat::Json, 1).unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&result.content).expect("valid JSON");
        assert_eq!(parsed["threadId"], serde_json::Value::String(thread_id));
        assert_eq!(parsed["database"], DATABASE_NAME);
        assert_eq!(parsed["dataSovereignty"], true);
        assert_eq!(
            parsed["messages"][0]["content"],
            "Hello \"world\"\tand\\slash"
        );
    }

    #[test]
    fn text_format_is_sender_prefixed_and_blank_line_separated() {
        let (conn, thread_id) = thread_with_messages("export_text");
        let result = export_thread(&conn, &thread_id, ExportFormat::Text, 1).unwrap();

        assert!(result.content.starts_with("USER: "));
        assert!(result.content.contains("\n\nASSISTANT: "));
        assert!(result.file_name.ends_with(".txt"));
    }

    #[test]
    fn format_names_parse_like_the_kotlin_client() {
        assert_eq!(ExportFormat::parse("md").unwrap(), ExportFormat::Markdown);
        assert_eq!(
            ExportFormat::parse("MARKDOWN").unwrap(),
            ExportFormat::Markdown
        );
        assert_eq!(ExportFormat::parse(" json ").unwrap(), ExportFormat::Json);
        assert_eq!(ExportFormat::parse("txt").unwrap(), ExportFormat::Text);
        assert_eq!(
            ExportFormat::parse("pdf").unwrap_err().code,
            crate::domain::ErrorCode::VALIDATION
        );
    }

    #[test]
    fn exporting_a_missing_thread_is_not_found() {
        let conn = fresh_db("export_missing");
        assert_eq!(
            export_thread(&conn, "th_missing", ExportFormat::Text, 1)
                .unwrap_err()
                .code,
            crate::domain::ErrorCode::NOT_FOUND
        );
    }
}
