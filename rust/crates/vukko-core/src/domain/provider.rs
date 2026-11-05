//! Provider domain model and registry.
//!
//! Mirror of `src/types/provider.ts` and `LLMProvider.kt`. Provider and model
//! IDs are persisted in user databases and preferences, so they are stable:
//! models may be added, never renamed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderType {
    GEMINI,
    OPENAI,
    ANTHROPIC,
    DEEPSEEK,
    GROQ,
    OLLAMA,
    INSTANCE,
}

impl ProviderType {
    pub fn all() -> &'static [ProviderType] {
        &[
            ProviderType::GEMINI,
            ProviderType::OPENAI,
            ProviderType::ANTHROPIC,
            ProviderType::DEEPSEEK,
            ProviderType::GROQ,
            ProviderType::OLLAMA,
            ProviderType::INSTANCE,
        ]
    }

    pub fn display_name(self) -> &'static str {
        match self {
            ProviderType::GEMINI => "Google Gemini",
            ProviderType::OPENAI => "OpenAI",
            ProviderType::ANTHROPIC => "Anthropic",
            ProviderType::DEEPSEEK => "DeepSeek",
            ProviderType::GROQ => "Groq",
            ProviderType::OLLAMA => "Ollama (Local/LAN)",
            ProviderType::INSTANCE => "Vukko Server",
        }
    }

    pub fn is_local(self) -> bool {
        matches!(self, ProviderType::OLLAMA)
    }

    /// Suffix used for the preference key that stores this provider's API key.
    pub fn preference_suffix(self) -> &'static str {
        match self {
            ProviderType::GEMINI => "GEMINI",
            ProviderType::OPENAI => "OPENAI",
            ProviderType::ANTHROPIC => "ANTHROPIC",
            ProviderType::DEEPSEEK => "DEEPSEEK",
            ProviderType::GROQ => "GROQ",
            ProviderType::OLLAMA => "OLLAMA",
            ProviderType::INSTANCE => "INSTANCE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMModel {
    pub id: String,
    pub name: String,
    pub provider: ProviderType,
    pub context_window: String,
    pub supports_vision: bool,
    pub supports_reasoning: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: ProviderType,
    /// Opaque handle or empty string. The bridge never sends raw keys to JS.
    pub api_key: String,
    pub base_url: String,
    pub selected_model_id: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub is_connected: bool,
}

fn model(
    id: &str,
    name: &str,
    provider: ProviderType,
    context_window: &str,
    supports_vision: bool,
    supports_reasoning: bool,
) -> LLMModel {
    LLMModel {
        id: id.to_string(),
        name: name.to_string(),
        provider,
        context_window: context_window.to_string(),
        supports_vision,
        supports_reasoning,
    }
}

/// The shipped model catalogue, in the order the picker shows it.
pub fn default_models() -> Vec<LLMModel> {
    use ProviderType::*;
    vec![
        model(
            "gemini-2.5-flash",
            "Gemini 2.5 Flash",
            GEMINI,
            "1M",
            true,
            true,
        ),
        model("gemini-2.5-pro", "Gemini 2.5 Pro", GEMINI, "2M", true, true),
        model(
            "gemini-1.5-flash",
            "Gemini 1.5 Flash",
            GEMINI,
            "1M",
            true,
            false,
        ),
        model(
            "deepseek-chat",
            "DeepSeek-V3",
            DEEPSEEK,
            "64k",
            false,
            false,
        ),
        model(
            "deepseek-reasoner",
            "DeepSeek-R1 (Reasoning)",
            DEEPSEEK,
            "64k",
            false,
            true,
        ),
        model("gpt-4o", "GPT-4o", OPENAI, "128k", true, false),
        model("gpt-4o-mini", "GPT-4o mini", OPENAI, "128k", true, false),
        model(
            "o3-mini",
            "o3-mini (Reasoning)",
            OPENAI,
            "128k",
            false,
            true,
        ),
        model(
            "claude-3-5-sonnet-20241022",
            "Claude 3.5 Sonnet",
            ANTHROPIC,
            "200k",
            true,
            false,
        ),
        model(
            "claude-3-5-haiku-20241022",
            "Claude 3.5 Haiku",
            ANTHROPIC,
            "200k",
            false,
            false,
        ),
        model(
            "llama-3.3-70b-versatile",
            "Llama 3.3 70B (Groq)",
            GROQ,
            "128k",
            false,
            false,
        ),
        model(
            "mixtral-8x7b-32768",
            "Mixtral 8x7B (Groq)",
            GROQ,
            "32k",
            false,
            false,
        ),
        model(
            "llama3.2:latest",
            "Llama 3.2 3B (Local)",
            OLLAMA,
            "8k",
            false,
            false,
        ),
        model(
            "deepseek-r1:8b",
            "DeepSeek R1 8B (Local)",
            OLLAMA,
            "8k",
            false,
            true,
        ),
        model(
            "vukko-workspace-default",
            "Instance Workspace LLM",
            INSTANCE,
            "Dynamic",
            true,
            false,
        ),
    ]
}

pub fn models_for(provider: ProviderType) -> Vec<LLMModel> {
    default_models()
        .into_iter()
        .filter(|model| model.provider == provider)
        .collect()
}

/// Looks a model up by id, falling back to the first catalogue entry exactly
/// like `ProviderRegistry.findModel`.
pub fn find_model(model_id: &str) -> LLMModel {
    default_models()
        .into_iter()
        .find(|model| model.id == model_id)
        .unwrap_or_else(|| default_models().remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_order_and_names_match_kotlin() {
        let names: Vec<&str> = ProviderType::all()
            .iter()
            .map(|p| p.display_name())
            .collect();
        assert_eq!(
            names,
            vec![
                "Google Gemini",
                "OpenAI",
                "Anthropic",
                "DeepSeek",
                "Groq",
                "Ollama (Local/LAN)",
                "Vukko Server",
            ]
        );
        assert!(ProviderType::OLLAMA.is_local());
        assert!(!ProviderType::GEMINI.is_local());
    }

    #[test]
    fn catalogue_is_stable_and_grouped() {
        let models = default_models();
        assert_eq!(models.len(), 15);
        assert_eq!(models[0].id, "gemini-2.5-flash");
        assert_eq!(models_for(ProviderType::GEMINI).len(), 3);
        assert_eq!(models_for(ProviderType::OLLAMA).len(), 2);
        assert_eq!(models_for(ProviderType::INSTANCE).len(), 1);
    }

    #[test]
    fn unknown_model_falls_back_to_the_first_entry() {
        assert_eq!(find_model("nope").id, "gemini-2.5-flash");
        assert_eq!(find_model("gpt-4o").id, "gpt-4o");
    }

    #[test]
    fn provider_serializes_with_kotlin_names() {
        assert_eq!(
            serde_json::to_string(&ProviderType::ANTHROPIC).unwrap(),
            "\"ANTHROPIC\""
        );
    }
}
