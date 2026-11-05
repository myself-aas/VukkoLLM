//! Provider selection (MIGRATION_PLAN.md §8 Step 5.2).
//!
//! Construction is the only place that knows which concrete client serves which
//! provider. Everything above it holds an `Arc<dyn LlmProvider>`, so the UI can
//! never depend on a vendor's streaming format — and there is no implicit
//! fallback: an unsupported provider is an `UNSUPPORTED` error, never a
//! silently substituted one.

use std::sync::Arc;

use super::anthropic::Anthropic;
use super::gemini::Gemini;
use super::instance::InstanceServer;
use super::ollama::Ollama;
use super::openai_compatible::OpenAiCompatible;
use super::{
    descriptor, BackendKind, ChatCompletionRequest, ChatCompletionResult, EmbeddedModelConfig,
    ExecutionMode, HttpTransport, LlmProvider, OllamaConfig, ProviderError, RemoteProviderConfig,
};
use crate::domain::{ErrorCode, ProviderType};

/// A provider selected for one request.
pub struct ProviderSelection {
    provider: Arc<dyn LlmProvider>,
    mode: ExecutionMode,
}

impl std::fmt::Debug for ProviderSelection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderSelection")
            .field("mode", &self.mode)
            .finish_non_exhaustive()
    }
}

impl ProviderSelection {
    pub fn provider(&self) -> &Arc<dyn LlmProvider> {
        &self.provider
    }

    pub fn mode(&self) -> &ExecutionMode {
        &self.mode
    }

    /// Whether the answer is produced on the device itself.
    pub fn is_on_device(&self) -> bool {
        self.mode.kind() == BackendKind::Embedded
    }
}

/// Builds the client for an execution mode.
///
/// `transport` is the platform HTTP stack; tests pass a recording double.
pub fn select(
    mode: ExecutionMode,
    transport: Arc<dyn HttpTransport>,
) -> Result<ProviderSelection, ProviderError> {
    let provider: Arc<dyn LlmProvider> = match &mode {
        ExecutionMode::Remote(RemoteProviderConfig {
            provider,
            base_url,
            api_key,
        }) => {
            let base_url = resolve_base_url(*provider, base_url);
            match descriptor(*provider).backend {
                BackendKind::Remote => match provider {
                    ProviderType::ANTHROPIC => {
                        Arc::new(Anthropic::new(base_url.clone(), api_key.clone(), transport)?)
                    }
                    ProviderType::GEMINI => {
                        Arc::new(Gemini::new(base_url.clone(), api_key.clone(), transport)?)
                    }
                    ProviderType::INSTANCE => {
                        // The instance server's key is optional by design.
                        let key = (!api_key.trim().is_empty()).then(|| api_key.clone());
                        Arc::new(InstanceServer::new(base_url.clone(), key, transport))
                    }
                    other => Arc::new(OpenAiCompatible::new(
                        *other,
                        base_url.clone(),
                        api_key.clone(),
                        transport,
                    )?),
                },
                // A local backend never runs through the remote path.
                _ => {
                    return Err(ProviderError::unsupported(format!(
                        "{:?} is not a remote provider",
                        provider
                    ))
                    .with_detail("provider", format!("{:?}", provider)))
                }
            }
        }
        ExecutionMode::Ollama(OllamaConfig { base_url }) => {
            Arc::new(Ollama::new(base_url.clone(), transport))
        }
        ExecutionMode::Embedded(EmbeddedModelConfig { .. }) => {
            return Err(ProviderError::unsupported(
                "embedded inference is not built into this binary",
            )
            .with_detail("code", "EMBEDDED_UNAVAILABLE"))
        }
    };

    Ok(ProviderSelection { provider, mode })
}

fn resolve_base_url(provider: ProviderType, configured: &str) -> String {
    if configured.trim().is_empty() {
        descriptor(provider).default_base_url.to_string()
    } else {
        configured.trim_end_matches('/').to_string()
    }
}

/// Streams one request through a selection, translating a provider failure into
/// the shared error contract exactly once.
pub async fn stream(
    selection: &ProviderSelection,
    request: ChatCompletionRequest,
    sink: Arc<dyn super::ChunkSink>,
) -> Result<ChatCompletionResult, crate::domain::VukkoError> {
    selection
        .provider
        .stream_chat(request, sink)
        .await
        .map_err(|error| {
            let code = error.code;
            let mut translated = crate::domain::VukkoError::from(error);
            // A cancelled request is never retryable, whatever the transport said.
            if code == ErrorCode::CANCELLED {
                translated = translated.retryable(false);
            }
            translated
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::test_support::{sample_request, FakeTransport};
    use crate::providers::{CollectingSink, Protocol};

    fn remote(provider: ProviderType, key: &str) -> ExecutionMode {
        ExecutionMode::Remote(RemoteProviderConfig {
            provider,
            base_url: String::new(),
            api_key: key.to_string(),
        })
    }

    #[test]
    fn each_remote_provider_gets_the_client_for_its_protocol() {
        for provider in [
            ProviderType::OPENAI,
            ProviderType::DEEPSEEK,
            ProviderType::GROQ,
            ProviderType::GEMINI,
            ProviderType::ANTHROPIC,
            ProviderType::INSTANCE,
        ] {
            let selection = select(remote(provider, "key"), FakeTransport::new(200, "")).expect("builds");
            assert_eq!(selection.provider().descriptor().provider, provider);
            assert_eq!(selection.provider().descriptor().protocol, descriptor(provider).protocol);
        }
        assert_eq!(descriptor(ProviderType::GROQ).protocol, Protocol::OpenAiSse);
    }

    #[test]
    fn an_empty_base_url_falls_back_to_the_documented_default() {
        let selection = select(remote(ProviderType::OPENAI, "k"), FakeTransport::new(200, ""))
            .expect("builds");
        let _ = selection;
        assert_eq!(
            descriptor(ProviderType::OPENAI).default_base_url,
            "https://api.openai.com/v1"
        );
        assert_eq!(resolve_base_url(ProviderType::GROQ, ""), "https://api.groq.com/openai/v1");
        assert_eq!(resolve_base_url(ProviderType::GROQ, "http://x/"), "http://x");
    }

    #[test]
    fn a_local_mode_is_reachable_without_a_key() {
        let selection = select(
            ExecutionMode::Ollama(OllamaConfig {
                base_url: String::new(),
            }),
            FakeTransport::new(200, ""),
        )
        .expect("Ollama needs no key");

        assert_eq!(selection.mode().kind(), BackendKind::Ollama);
        assert!(!selection.is_on_device());
        assert_eq!(selection.provider().descriptor().provider, ProviderType::OLLAMA);
    }

    #[test]
    fn embedded_inference_is_refused_rather_than_silently_offloaded() {
        let error = select(
            ExecutionMode::Embedded(EmbeddedModelConfig {
                model_path: "/models/phi.gguf".into(),
            }),
            FakeTransport::new(200, ""),
        )
        .expect_err("no embedded runtime is linked");

        assert_eq!(error.code, ErrorCode::UNSUPPORTED);
        assert_eq!(
            error.details.as_ref().and_then(|details| details.get("code")).map(String::as_str),
            Some("EMBEDDED_UNAVAILABLE")
        );
    }

    #[test]
    fn a_local_provider_cannot_be_configured_as_remote() {
        let error = select(remote(ProviderType::OLLAMA, ""), FakeTransport::new(200, ""))
            .expect_err("Ollama is not a remote backend");
        assert_eq!(error.code, ErrorCode::UNSUPPORTED);
    }

    #[test]
    fn a_remote_provider_without_a_key_fails_before_any_request() {
        let transport = FakeTransport::new(200, "");
        let error = select(remote(ProviderType::OPENAI, "  "), transport.clone())
            .expect_err("a key is required");
        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert_eq!(transport.sent_count(), 0);
    }

    #[tokio::test]
    async fn streaming_through_a_selection_returns_the_normalised_result() {
        let body = "data: {\"type\":\"delta\",\"text\":\"hi\"}\n{\"type\":\"done\",\"finishReason\":\"stop\"}\n";
        let selection = select(remote(ProviderType::INSTANCE, ""), FakeTransport::new(200, body))
            .expect("builds");
        let sink = Arc::new(CollectingSink::new());

        let result = stream(&selection, sample_request("m"), sink).await.expect("streams");
        assert_eq!(result.text, "hi");
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
    }

    #[tokio::test]
    async fn a_provider_error_arrives_as_the_shared_error_contract() {
        let selection = select(
            remote(ProviderType::OPENAI, "k"),
            FakeTransport::new(401, "{\"error\":{\"message\":\"Incorrect API key\"}}"),
        )
        .expect("builds");

        let error = stream(&selection, sample_request("m"), Arc::new(CollectingSink::new()))
            .await
            .expect_err("a 401 is not a completion");
        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert!(!error.retryable);
    }
}
