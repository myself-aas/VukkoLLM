//! Chat domain model.
//!
//! Field-for-field mirror of `src/types/chat.ts` and of the Kotlin
//! `ChatMessage.kt` / `ChatMessageEntity.kt`. The JSON column format written by
//! `RoomConverters` is what `serde` must keep reading, so field names use
//! camelCase on the wire and enums use the Kotlin constant names.

use serde::{Deserialize, Serialize};

/// Unix milliseconds. Kotlin `Long` maps to `i64`; values are validated to fit
/// in a JavaScript safe integer by the bridge before they are handed to JS.
pub type Timestamp = i64;

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageSender {
// The variants are already upper case, and `rename_all` would re-case the
// *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
// every persisted value. An explicit rename is a no-op for Rust and a contract
// for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "USER")]
    USER,
    #[serde(rename = "ASSISTANT")]
    ASSISTANT,
    #[serde(rename = "SYSTEM")]
    SYSTEM,
}

impl MessageSender {
    /// Reads the stored value, falling back to `ASSISTANT` like
    /// `ChatMessageEntity.toDomain()` did on an unrecognised value.
    pub fn from_wire(value: &str) -> Self {
        match value {
            "USER" => Self::USER,
            "SYSTEM" => Self::SYSTEM,
            _ => Self::ASSISTANT,
        }
    }

    pub fn as_wire(self) -> &'static str {
        match self {
            Self::USER => "USER",
            Self::ASSISTANT => "ASSISTANT",
            Self::SYSTEM => "SYSTEM",
        }
    }
}

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentStepStatus {
// The variants are already upper case, and `rename_all` would re-case the
// *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
// every persisted value. An explicit rename is a no-op for Rust and a contract
// for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "PENDING")]
    PENDING,
    #[serde(rename = "RUNNING")]
    RUNNING,
    #[serde(rename = "COMPLETED")]
    COMPLETED,
    #[serde(rename = "FAILED")]
    FAILED,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub title: String,
    pub source: String,
    pub snippet: String,
    /// Retrieval score in [0, 1]; Kotlin `Float`.
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub tool_name: String,
    pub description: String,
    pub input: String,
    pub output: String,
    pub is_success: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    /// Pre-formatted display size ("184 KB"), as produced by the Kotlin client.
    pub size_display: String,
    pub preview_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub step_index: u32,
    pub title: String,
    pub description: String,
    pub tool_name: String,
    pub status: AgentStepStatus,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub execution_time_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub thread_id: String,
    pub sender: MessageSender,
    pub content: String,
    pub timestamp: Timestamp,
    pub thinking: Option<String>,
    pub thinking_duration_ms: Option<i64>,
    pub citations: Vec<Citation>,
    pub tools_used: Vec<ToolCall>,
    pub attachments: Vec<MessageAttachment>,
    pub is_streaming: bool,
    pub is_agent_execution: bool,
    pub agent_steps: Vec<AgentStep>,
    pub created_document_id: Option<String>,
    pub created_document_name: Option<String>,
    pub is_favorite: bool,
    pub is_pinned: bool,
    pub tags: Vec<String>,
}

impl ChatMessage {
    /// A new user turn. Mirrors what `DataRepository.executeSendMessage` stored.
    pub fn user_turn(id: String, thread_id: String, content: String, timestamp: Timestamp) -> Self {
        Self {
            id,
            thread_id,
            sender: MessageSender::USER,
            content,
            timestamp,
            thinking: None,
            thinking_duration_ms: None,
            citations: Vec::new(),
            tools_used: Vec::new(),
            attachments: Vec::new(),
            is_streaming: false,
            is_agent_execution: false,
            agent_steps: Vec::new(),
            created_document_id: None,
            created_document_name: None,
            is_favorite: false,
            is_pinned: false,
            tags: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sender_serializes_with_kotlin_names() {
        assert_eq!(
            serde_json::to_string(&MessageSender::USER).unwrap(),
            "\"USER\""
        );
        assert_eq!(
            serde_json::to_string(&MessageSender::ASSISTANT).unwrap(),
            "\"ASSISTANT\""
        );
    }

    #[test]
    fn message_round_trips_in_camel_case() {
        let message = ChatMessage::user_turn(
            "msg_1".into(),
            "th_default".into(),
            "hello".into(),
            1_700_000_000_000,
        );
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["threadId"], "th_default");
        assert_eq!(json["isStreaming"], false);
        assert!(json.get("thread_id").is_none());

        let parsed: ChatMessage = serde_json::from_value(json).unwrap();
        assert_eq!(parsed, message);
    }

    #[test]
    fn reads_room_converters_json_columns() {
        // Exact bytes a shipped install has in chat_messages.citationsJson.
        let raw = r#"[{"title":"vukko-getting-started.pdf","source":"Section 1.1","snippet":"Vukko is local-first.","score":0.95}]"#;
        let citations: Vec<Citation> = serde_json::from_str(raw).unwrap();
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].score, 0.95);

        let steps = r#"[{"stepIndex":1,"title":"Plan","description":"d","toolName":"Planner","status":"COMPLETED","toolInput":null,"toolOutput":"ok","executionTimeMs":420}]"#;
        let parsed: Vec<AgentStep> = serde_json::from_str(steps).unwrap();
        assert_eq!(parsed[0].status, AgentStepStatus::COMPLETED);
        assert_eq!(parsed[0].execution_time_ms, Some(420));
    }
}
