//! Workspace and thread domain model.
//!
//! Mirror of `src/types/workspace.ts`, `Workspace.kt`, and the Room entities
//! `WorkspaceEntity.kt` / `ChatThreadEntity.kt`.

use serde::{Deserialize, Serialize};

use super::chat::Timestamp;

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QueryMode {
// The variants are already upper case, and `rename_all` would re-case the
// *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
// every persisted value. An explicit rename is a no-op for Rust and a contract
// for the wire, so the shape cannot drift with a serde default.
    /// Standard conversation with the workspace prompt as context.
    #[serde(rename = "CHAT")]
    CHAT,
    /// Strict RAG: answer only from embedded documents.
    #[serde(rename = "QUERY")]
    QUERY,
    /// Autonomous multi-step planning and tool execution.
    #[serde(rename = "AGENT")]
    AGENT,
}

impl Default for QueryMode {
    fn default() -> Self {
        Self::CHAT
    }
}

impl QueryMode {
    /// Reads the stored wire value, falling back to `CHAT` exactly like
    /// `WorkspaceEntity.toDomain()` did on an unrecognised value.
    pub fn from_wire(value: &str) -> Self {
        match value {
            "QUERY" => Self::QUERY,
            "AGENT" => Self::AGENT,
            _ => Self::CHAT,
        }
    }

    /// The value written back to the `queryMode` column.
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::CHAT => "CHAT",
            Self::QUERY => "QUERY",
            Self::AGENT => "AGENT",
        }
    }
}

/// The default prompt the Kotlin app stored for a workspace created without one.
pub const DEFAULT_SYSTEM_PROMPT: &str =
    "You are a helpful, versatile AI assistant powered by Vukko.";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub system_prompt: String,
    pub temperature: f32,
    pub query_mode: QueryMode,
    pub vector_count: u32,
    pub document_count: u32,
    pub created_at: Timestamp,
    pub agent_max_steps: u32,
    pub agent_allow_web_search: bool,
    pub agent_allow_file_creation: bool,
    pub agent_allow_document_search: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceThread {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub slug: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub message_count: u32,
    pub last_message_snippet: Option<String>,
    pub is_pinned: bool,
}

/// Turns a display name into the slug format the Kotlin client used
/// (`lowercase`, non-alphanumerics collapsed to `-`, trimmed).
pub fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut last_was_dash = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_mode_uses_kotlin_names() {
        assert_eq!(
            serde_json::to_string(&QueryMode::AGENT).unwrap(),
            "\"AGENT\""
        );
        assert_eq!(
            serde_json::to_string(&QueryMode::QUERY).unwrap(),
            "\"QUERY\""
        );
    }

    #[test]
    fn slugify_matches_kotlin_behaviour() {
        assert_eq!(slugify("Default Workspace"), "default-workspace");
        assert_eq!(slugify("Engineering & Code"), "engineering-code");
        assert_eq!(slugify("  spaced  out  "), "spaced-out");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn workspace_round_trips_in_camel_case() {
        let workspace = Workspace {
            id: "ws_default".into(),
            name: "Default Workspace".into(),
            slug: "default-workspace".into(),
            description: String::new(),
            system_prompt: DEFAULT_SYSTEM_PROMPT.into(),
            temperature: 0.7,
            query_mode: QueryMode::CHAT,
            vector_count: 0,
            document_count: 0,
            created_at: 1_700_000_000_000,
            agent_max_steps: 5,
            agent_allow_web_search: true,
            agent_allow_file_creation: true,
            agent_allow_document_search: true,
        };
        let json = serde_json::to_value(&workspace).unwrap();
        assert_eq!(json["systemPrompt"], DEFAULT_SYSTEM_PROMPT);
        assert_eq!(json["queryMode"], "CHAT");
        assert_eq!(json["agentAllowWebSearch"], true);
    }
}
