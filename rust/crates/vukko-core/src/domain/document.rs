//! Document domain model and quick actions.
//!
//! Mirror of `src/types/document.ts` and `DocumentItem.kt`.

use serde::{Deserialize, Serialize};

use super::chat::Timestamp;

// Variant names are the Kotlin enum names, and the serde wire values are
// part of the persisted contract; renaming any of them changes stored data.
#[allow(
    clippy::upper_case_acronyms,
    clippy::enum_variant_names,
    non_camel_case_types
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentType {
    // The variants are already upper case, and `rename_all` would re-case the
    // *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
    // every persisted value. An explicit rename is a no-op for Rust and a contract
    // for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "TEXT")]
    TEXT,
    #[serde(rename = "PDF")]
    PDF,
    #[serde(rename = "WEB_LINK")]
    WEB_LINK,
    #[serde(rename = "MARKDOWN")]
    MARKDOWN,
}

impl DocumentType {
    /// Best-effort fallback for legacy rows whose stored value is unknown, the
    /// same way `WorkspaceDocumentEntity.toDomain()` falls back to `TEXT`.
    pub fn from_wire(value: &str) -> Self {
        match value {
            "PDF" => Self::PDF,
            "WEB_LINK" => Self::WEB_LINK,
            "MARKDOWN" => Self::MARKDOWN,
            _ => Self::TEXT,
        }
    }

    /// The value written back to the `type` column.
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::TEXT => "TEXT",
            Self::PDF => "PDF",
            Self::WEB_LINK => "WEB_LINK",
            Self::MARKDOWN => "MARKDOWN",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentItem {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub document_type: DocumentType,
    /// Pre-formatted display size as written by the Kotlin client ("420 KB").
    pub size: String,
    pub vector_count: u32,
    pub content_summary: String,
    pub full_content: String,
    pub date_added: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickActionItem {
    pub id: String,
    pub title: String,
    pub description: String,
    /// Prompt template with one `%s` placeholder for the selected text.
    pub prompt_template: String,
    pub icon_name: String,
}

/// The five quick actions the Kotlin client shipped, verbatim.
pub fn default_quick_actions() -> Vec<QuickActionItem> {
    vec![
        QuickActionItem {
            id: "summarize".into(),
            title: "Summarize".into(),
            description: "Key takeaways and bullet points".into(),
            prompt_template: "Provide a clear and concise summary of the following text with 3-5 key bullet points:\n\n%s".into(),
            icon_name: "text_snippet".into(),
        },
        QuickActionItem {
            id: "fix_grammar".into(),
            title: "Fix & Polish".into(),
            description: "Correct grammar, spelling, and tone".into(),
            prompt_template: "Proofread, fix grammatical mistakes, and polish the wording of the following text while keeping its original meaning:\n\n%s".into(),
            icon_name: "auto_fix_high".into(),
        },
        QuickActionItem {
            id: "explain".into(),
            title: "Explain Simply".into(),
            description: "Simplify concepts for quick understanding".into(),
            prompt_template: "Explain the following text in simple terms so anyone can understand it easily:\n\n%s".into(),
            icon_name: "psychology".into(),
        },
        QuickActionItem {
            id: "formalize".into(),
            title: "Make Formal".into(),
            description: "Transform text into a professional tone".into(),
            prompt_template: "Rewrite the following text into professional, polished business communication:\n\n%s".into(),
            icon_name: "business_center".into(),
        },
        QuickActionItem {
            id: "translate".into(),
            title: "Translate".into(),
            description: "Translate into fluent English or target language".into(),
            prompt_template: "Translate the following text into fluent English:\n\n%s".into(),
            icon_name: "translate".into(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_type_uses_kotlin_names_and_falls_back_to_text() {
        assert_eq!(
            serde_json::to_string(&DocumentType::WEB_LINK).unwrap(),
            "\"WEB_LINK\""
        );
        assert_eq!(DocumentType::from_wire("PDF"), DocumentType::PDF);
        assert_eq!(DocumentType::from_wire("nonsense"), DocumentType::TEXT);
    }

    #[test]
    fn document_serializes_type_as_lowercase_field_name() {
        let doc = DocumentItem {
            id: "doc_1".into(),
            workspace_id: "ws_default".into(),
            name: "guide.pdf".into(),
            document_type: DocumentType::PDF,
            size: "420 KB".into(),
            vector_count: 16,
            content_summary: "Setup guide".into(),
            full_content: String::new(),
            date_added: 1_700_000_000_000,
        };
        let json = serde_json::to_value(&doc).unwrap();
        assert_eq!(json["type"], "PDF");
        assert_eq!(json["workspaceId"], "ws_default");
        assert!(json.get("documentType").is_none());
    }

    #[test]
    fn quick_actions_keep_their_ids_and_single_placeholder() {
        let actions = default_quick_actions();
        assert_eq!(actions.len(), 5);
        assert_eq!(actions[0].id, "summarize");
        for action in &actions {
            assert_eq!(action.prompt_template.matches("%s").count(), 1);
        }
    }
}
