//! Provider abstraction (MIGRATION_PLAN.md §8 Steps 5.1–5.3).
//!
//! Every backend — hosted API, local Ollama, or the Vukko instance server —
//! implements [`LlmProvider`], and every one of them produces the same
//! [`ProviderChunk`] vocabulary. Nothing above this module ever sees a vendor's
//! streaming format, so adding a provider never touches the UI.
//!
//! Parsing is tested against the recorded payloads in
//! `tests/providers/fixtures.js`, which the TypeScript twin
//! (`src/services/providers`) is tested against as well.

pub mod anthropic;
pub mod factory;
pub mod gemini;
pub mod instance;
pub mod mock;
pub mod ollama;
pub mod openai_compatible;
pub mod parser;
#[cfg(test)]
pub mod test_support;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::domain::{Citation, ProviderType, VukkoError};

pub use factory::{select, stream as stream_selection, ProviderSelection};

/// Which execution path a provider uses (Step 5.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackendKind {
    Remote,
    Ollama,
    Embedded,
}

/// Configuration for a hosted provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteProviderConfig {
    pub provider: ProviderType,
    pub base_url: String,
    pub api_key: String,
}

/// Configuration for a local Ollama server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OllamaConfig {
    pub base_url: String,
}

/// Configuration for on-device inference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedModelConfig {
    pub model_path: String,
}

/// How a request is executed: the path *and* its configuration.
///
/// The variant is the contract — there is no implicit fallback from embedded to
/// remote, and no request ever silently changes backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionMode {
    Remote(RemoteProviderConfig),
    Ollama(OllamaConfig),
    Embedded(EmbeddedModelConfig),
}

impl ExecutionMode {
    pub fn kind(&self) -> BackendKind {
        match self {
            ExecutionMode::Remote(_) => BackendKind::Remote,
            ExecutionMode::Ollama(_) => BackendKind::Ollama,
            ExecutionMode::Embedded(_) => BackendKind::Embedded,
        }
    }

    /// The provider this mode speaks for, when it is a networked one.
    pub fn provider(&self) -> Option<ProviderType> {
        match self {
            ExecutionMode::Remote(config) => Some(config.provider),
            ExecutionMode::Ollama(_) => Some(ProviderType::OLLAMA),
            ExecutionMode::Embedded(_) => None,
        }
    }
}

/// The wire protocol a provider speaks; selects the parser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    OpenAiSse,
    AnthropicSse,
    GeminiStream,
    OllamaNdjson,
    InstanceNdjson,
}

/// Static facts about a provider.
#[derive(Debug, Clone, Copy)]
pub struct ProviderDescriptor {
    pub provider: ProviderType,
    pub backend: BackendKind,
    pub protocol: Protocol,
    pub default_base_url: &'static str,
    pub supports_vision: bool,
    pub supports_tools: bool,
    pub requires_api_key: bool,
}

pub const DESCRIPTORS: &[ProviderDescriptor] = &[
    ProviderDescriptor {
        provider: ProviderType::GEMINI,
        backend: BackendKind::Remote,
        protocol: Protocol::GeminiStream,
        default_base_url: "https://generativelanguage.googleapis.com/v1beta",
        supports_vision: true,
        supports_tools: true,
        requires_api_key: true,
    },
    ProviderDescriptor {
        provider: ProviderType::OPENAI,
        backend: BackendKind::Remote,
        protocol: Protocol::OpenAiSse,
        default_base_url: "https://api.openai.com/v1",
        supports_vision: true,
        supports_tools: true,
        requires_api_key: true,
    },
    ProviderDescriptor {
        provider: ProviderType::ANTHROPIC,
        backend: BackendKind::Remote,
        protocol: Protocol::AnthropicSse,
        default_base_url: "https://api.anthropic.com/v1",
        supports_vision: true,
        supports_tools: true,
        requires_api_key: true,
    },
    ProviderDescriptor {
        provider: ProviderType::DEEPSEEK,
        backend: BackendKind::Remote,
        protocol: Protocol::OpenAiSse,
        default_base_url: "https://api.deepseek.com/v1",
        supports_vision: false,
        supports_tools: true,
        requires_api_key: true,
    },
    ProviderDescriptor {
        provider: ProviderType::GROQ,
        backend: BackendKind::Remote,
        protocol: Protocol::OpenAiSse,
        default_base_url: "https://api.groq.com/openai/v1",
        supports_vision: false,
        supports_tools: true,
        requires_api_key: true,
    },
    ProviderDescriptor {
        provider: ProviderType::OLLAMA,
        backend: BackendKind::Ollama,
        protocol: Protocol::OllamaNdjson,
        default_base_url: "http://127.0.0.1:11434",
        supports_vision: false,
        supports_tools: false,
        requires_api_key: false,
    },
    ProviderDescriptor {
        provider: ProviderType::INSTANCE,
        backend: BackendKind::Remote,
        protocol: Protocol::InstanceNdjson,
        default_base_url: "http://10.0.2.2:3001",
        supports_vision: true,
        supports_tools: true,
        requires_api_key: false,
    },
];

pub fn descriptor(provider: ProviderType) -> &'static ProviderDescriptor {
    DESCRIPTORS
        .iter()
        .find(|descriptor| descriptor.provider == provider)
        .expect("every ProviderType has a descriptor; the parity test enforces it")
}

/// One logical chat request, independent of provider.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCompletionRequest {
    pub model: String,
    pub system_prompt: String,
    pub messages: Vec<ProviderMessage>,
    pub temperature: f32,
    pub max_tokens: u32,
    #[serde(default)]
    pub attachments: Vec<RequestAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMessage {
    pub role: String,
    pub content: String,
}

/// An attachment ready to send: bytes inlined as a data URI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestAttachment {
    pub name: String,
    pub mime_type: String,
    pub data_uri: String,
}

/// The only chunk shapes that leave this layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProviderChunk {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "reasoning")]
    Reasoning { text: String },
    #[serde(rename = "tool_call")]
    ToolCall { tool_name: String, input: String },
    #[serde(rename = "citation")]
    Citation { citation: Citation },
    #[serde(rename = "usage")]
    Usage {
        input_tokens: u32,
        output_tokens: u32,
    },
    #[serde(rename = "done")]
    Done { finish_reason: String },
}

/// Where chunks go. Implementations must be cheap to clone (the streaming task
/// holds one for the life of a request).
pub trait ChunkSink: Send + Sync {
    fn send(&self, chunk: ProviderChunk);
    fn is_cancelled(&self) -> bool;
}

/// A sink that collects chunks in memory, for tests and for one-shot calls.
#[derive(Default)]
pub struct CollectingSink {
    chunks: std::sync::Mutex<Vec<ProviderChunk>>,
    cancelled: AtomicBool,
}

impl CollectingSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn collected(&self) -> Vec<ProviderChunk> {
        self.chunks
            .lock()
            .map(|chunks| chunks.clone())
            .unwrap_or_default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
}

impl ChunkSink for CollectingSink {
    fn send(&self, chunk: ProviderChunk) {
        if let Ok(mut chunks) = self.chunks.lock() {
            chunks.push(chunk);
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Normalised provider failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub code: crate::domain::ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<std::collections::BTreeMap<String, String>>,
}

impl ProviderError {
    pub fn authentication(message: impl Into<String>) -> Self {
        Self {
            code: crate::domain::ErrorCode::AUTHENTICATION,
            message: message.into(),
            retryable: false,
            details: None,
        }
    }

    pub fn network(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: crate::domain::ErrorCode::NETWORK,
            message: message.into(),
            retryable,
            details: None,
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: crate::domain::ErrorCode::VALIDATION,
            message: message.into(),
            retryable: false,
            details: None,
        }
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: crate::domain::ErrorCode::UNSUPPORTED,
            message: message.into(),
            retryable: false,
            details: None,
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: crate::domain::ErrorCode::NOT_FOUND,
            message: message.into(),
            retryable: false,
            details: None,
        }
    }

    pub fn cancelled() -> Self {
        Self {
            code: crate::domain::ErrorCode::CANCELLED,
            message: "Request cancelled".to_string(),
            retryable: false,
            details: None,
        }
    }

    pub fn with_detail(mut self, key: &str, value: impl Into<String>) -> Self {
        self.details
            .get_or_insert_with(std::collections::BTreeMap::new)
            .insert(key.to_string(), value.into());
        self
    }
}

impl From<ProviderError> for VukkoError {
    fn from(error: ProviderError) -> Self {
        let mut vukko = VukkoError::new(error.code, error.message).retryable(error.retryable);
        if let Some(details) = error.details {
            for (key, value) in details {
                vukko = vukko.with_detail(key, value);
            }
        }
        vukko
    }
}

/// Maps an HTTP status and body to the structured error contract. Both the
/// TypeScript and Rust implementations follow the same table (see
/// `src/services/providers/errors.ts`).
///
/// Rules:
/// - 401/403, or key/auth wording → `AUTHENTICATION` (never retryable)
/// - 404 with model wording → `NOT_FOUND`, otherwise `UNSUPPORTED`
/// - 400 with a context-limit message → `VALIDATION` + `reason`
/// - 408/429/5xx → `NETWORK`, retryable
/// - anything else → `UNSUPPORTED`
pub fn error_from_response(status: u16, body: &str) -> ProviderError {
    let extracted = extract_message(body);
    let scrubbed = scrub(&extracted);
    let message = if status == 0 {
        if scrubbed.is_empty() {
            "network unreachable".to_string()
        } else {
            scrubbed
        }
    } else if scrubbed.is_empty() {
        format!("HTTP {}", status)
    } else {
        scrubbed
    };
    let lower = extracted.to_ascii_lowercase();
    let mentions = |needles: &[&str]| needles.iter().any(|needle| lower.contains(needle));

    let context_limit = mentions(&[
        "context length",
        "context_length_exceeded",
        "maximum context",
        "too many tokens",
        "prompt is too long",
    ]);
    let auth_wording = mentions(&[
        "api key",
        "api_key",
        "api-key",
        "unauthorized",
        "unauthorised",
        "authentication",
        "permission",
        "invalid x-api-key",
        "invalid token",
    ]);
    let model_wording = mentions(&["model", "not found", "does not exist"]);

    let error = match status {
        401 | 403 => ProviderError::authentication(message),
        404 if model_wording => ProviderError::not_found(message),
        404 => ProviderError::unsupported(message),
        400 | 422 if context_limit => {
            ProviderError::validation(message).with_detail("reason", "CONTEXT_LENGTH_EXCEEDED")
        }
        400 | 422 if auth_wording => ProviderError::authentication(message),
        400 | 422 => ProviderError::validation(message),
        408 | 429 => ProviderError::network(message, true).with_detail(
            "reason",
            if status == 429 {
                "RATE_LIMITED"
            } else {
                "UPSTREAM"
            },
        ),
        status if status >= 500 => ProviderError::network(message, true),
        0 => ProviderError::network(message, true),
        _ => ProviderError::unsupported(message),
    };

    error.with_detail("status", status.to_string())
}

fn extract_message(body: &str) -> String {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.lines().next().unwrap_or_default().to_string();
    };

    // `{"error": {"message": ...}}`, `{"error": "..."}`, `{"message": "..."}`.
    if let Some(error) = parsed.get("error") {
        if let Some(text) = error.as_str() {
            return text.to_string();
        }
        if let Some(text) = error.get("message").and_then(|value| value.as_str()) {
            return text.to_string();
        }
    }
    if let Some(text) = parsed.get("message").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    String::new()
}

/// Removes anything that could be a credential from a provider message.
///
/// Mirrors `scrub()` in `src/services/providers/errors.ts`: provider keys and
/// bearer tokens are replaced, everything else is preserved verbatim.
fn scrub(message: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut redact_next = false;

    for token in message.split_whitespace() {
        if redact_next {
            let suffix = trailing_punctuation(token);
            out.push(format!("[redacted]{}", suffix));
            redact_next = false;
            continue;
        }

        let trimmed = token.trim_end_matches(['.', ',', ';', ':']);
        let suffix = &token[trimmed.len()..];
        let lower = trimmed.to_ascii_lowercase();

        if lower == "bearer" {
            redact_next = true;
            out.push(token.to_string());
            continue;
        }
        if lower.starts_with("bearer ") {
            out.push(format!("Bearer [redacted]{}", suffix));
            continue;
        }
        let looks_like_key = ["sk-", "rk-", "ghp_", "gho_", "ghs_", "xoxb-", "aiza"]
            .iter()
            .any(|prefix| lower.starts_with(prefix));
        if looks_like_key {
            out.push(format!("[redacted key]{}", suffix));
            continue;
        }
        out.push(token.to_string());
    }

    out.join(" ")
}

fn trailing_punctuation(token: &str) -> &str {
    let trimmed = token.trim_end_matches(['.', ',', ';', ':']);
    &token[trimmed.len()..]
}

/// A provider: one logical request in, one normalised chunk stream out.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn descriptor(&self) -> &'static ProviderDescriptor;

    /// Streams a chat completion into `sink`.
    ///
    /// Contract:
    /// - chunks arrive in the order the backend produced them;
    /// - cancellation via [`ChunkSink::is_cancelled`] stops the stream and
    ///   returns `ProviderError::cancelled()`;
    /// - an error is returned instead of a fabricated completion, always.
    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError>;
}

/// What a finished (or cancelled) request reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCompletionResult {
    pub text: String,
    pub reasoning: Option<String>,
    pub citations: Vec<Citation>,
    pub tool_calls: Vec<(String, String)>,
    pub usage: Option<(u32, u32)>,
    pub finish_reason: Option<String>,
}

impl ChatCompletionResult {
    pub fn empty() -> Self {
        Self {
            text: String::new(),
            reasoning: None,
            citations: Vec::new(),
            tool_calls: Vec::new(),
            usage: None,
            finish_reason: None,
        }
    }
}

/// A provider-specific HTTP request, ready to send.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl PreparedRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// The wire role for a UI role. Gemini calls the assistant `model`.
pub fn wire_role(role: &str, assistant_role: &str) -> String {
    if role.eq_ignore_ascii_case("ASSISTANT") {
        assistant_role.to_string()
    } else {
        role.to_ascii_lowercase()
    }
}

/// `data:<mime>;base64,<data>` split into its parts.
pub fn split_data_uri(data_uri: &str) -> Result<(&str, &str), ProviderError> {
    let rest = data_uri
        .strip_prefix("data:")
        .ok_or_else(|| ProviderError::validation("attachment is not a base64 data URI"))?;
    let (meta, data) = rest
        .split_once(',')
        .ok_or_else(|| ProviderError::validation("attachment is not a base64 data URI"))?;
    let mime_type = meta.split(';').next().unwrap_or_default();
    if mime_type.is_empty() || !meta.contains("base64") {
        return Err(ProviderError::validation(
            "attachment is not a base64 data URI",
        ));
    }
    Ok((mime_type, data))
}

/// Validates a request against a provider's capabilities, then sends it and
/// normalises the stream. Every provider funnels through here so the contract
/// (cancellation, error mapping, chunk order) exists in exactly one place.
pub async fn execute(
    descriptor: &ProviderDescriptor,
    transport: &dyn HttpTransport,
    prepared: PreparedRequest,
    sink: &dyn ChunkSink,
) -> Result<ChatCompletionResult, ProviderError> {
    let (status, body) = transport
        .post(&prepared.url, prepared.headers, prepared.body)
        .await?;

    if !(200..300).contains(&status) {
        return Err(error_from_response(status, &body));
    }

    let parsed = parser::parse_stream(descriptor.protocol, &body);
    for chunk in &parsed.chunks {
        if sink.is_cancelled() {
            return Err(ProviderError::cancelled());
        }
        sink.send(chunk.clone());
    }
    if sink.is_cancelled() {
        return Err(ProviderError::cancelled());
    }
    if let Some(error) = parsed.error {
        return Err(error);
    }
    Ok(fold_chunks(&parsed.chunks))
}

/// An HTTP transport, injectable so providers can be tested without a network.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    /// POSTs `body` to `url` and returns the raw (possibly streamed) body.
    async fn post(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        body: String,
    ) -> Result<(u16, String), ProviderError>;
}

/// Folds a sequence of chunks into a completion result.
pub fn fold_chunks(chunks: &[ProviderChunk]) -> ChatCompletionResult {
    let mut result = ChatCompletionResult::empty();
    for chunk in chunks {
        match chunk {
            ProviderChunk::Text { text } => result.text.push_str(text),
            ProviderChunk::Reasoning { text } => {
                result
                    .reasoning
                    .get_or_insert_with(String::new)
                    .push_str(text);
            }
            ProviderChunk::ToolCall { tool_name, input } => {
                result.tool_calls.push((tool_name.clone(), input.clone()));
            }
            ProviderChunk::Citation { citation } => result.citations.push(citation.clone()),
            ProviderChunk::Usage {
                input_tokens,
                output_tokens,
            } => result.usage = Some((*input_tokens, *output_tokens)),
            ProviderChunk::Done { finish_reason } => {
                result.finish_reason = Some(finish_reason.clone());
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_type_has_a_descriptor() {
        for provider in ProviderType::all() {
            assert_eq!(descriptor(*provider).provider, *provider);
        }
    }

    #[test]
    fn only_ollama_is_local() {
        assert_eq!(
            descriptor(ProviderType::OLLAMA).backend,
            BackendKind::Ollama
        );
        assert_eq!(
            descriptor(ProviderType::GEMINI).backend,
            BackendKind::Remote
        );
        assert!(!descriptor(ProviderType::OLLAMA).requires_api_key);
        assert!(descriptor(ProviderType::OPENAI).requires_api_key);
    }

    #[test]
    fn http_statuses_map_to_the_structured_contract() {
        assert_eq!(
            error_from_response(401, r#"{"error":{"message":"Incorrect API key provided"}}"#).code,
            crate::domain::ErrorCode::AUTHENTICATION
        );
        assert_eq!(
            error_from_response(429, "rate limited").code,
            crate::domain::ErrorCode::NETWORK
        );
        assert!(error_from_response(503, "down").retryable);
        assert_eq!(
            error_from_response(
                400,
                r#"{"error":{"message":"maximum context length is 128000 tokens"}}"#
            )
            .details
            .unwrap()["reason"],
            "CONTEXT_LENGTH_EXCEEDED"
        );
        assert_eq!(
            error_from_response(404, r#"{"error":{"message":"model not found"}}"#).code,
            crate::domain::ErrorCode::NOT_FOUND
        );
    }

    #[test]
    fn credentials_never_echo_back_from_an_error() {
        let error = error_from_response(
            401,
            r#"{"error":{"message":"bad key sk-live-abcdef123456"}}"#,
        );
        assert!(!error.message.contains("sk-live-abcdef123456"));
        assert!(error.message.contains("[redacted key]"));
    }

    #[test]
    fn folding_chunks_rebuilds_the_answer() {
        let chunks = vec![
            ProviderChunk::Text { text: "Hel".into() },
            ProviderChunk::Text { text: "lo".into() },
            ProviderChunk::Reasoning {
                text: "think".into(),
            },
            ProviderChunk::Usage {
                input_tokens: 3,
                output_tokens: 2,
            },
            ProviderChunk::Done {
                finish_reason: "stop".into(),
            },
        ];
        let result = fold_chunks(&chunks);
        assert_eq!(result.text, "Hello");
        assert_eq!(result.reasoning.as_deref(), Some("think"));
        assert_eq!(result.usage, Some((3, 2)));
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
    }

    #[test]
    fn a_collecting_sink_records_chunks_and_cancellation() {
        let sink = CollectingSink::new();
        sink.send(ProviderChunk::Text { text: "a".into() });
        assert!(!sink.is_cancelled());
        sink.cancel();
        assert!(sink.is_cancelled());
        assert_eq!(sink.collected().len(), 1);
    }
}
