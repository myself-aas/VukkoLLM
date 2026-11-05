//! Local Ollama `/api/chat` client.
//!
//! The local backend is the one provider that must keep working with no
//! account and no key, so it never sends an `authorization` header. Its
//! `x-api-key`-free stream is NDJSON rather than SSE, and tokens are reported
//! as `prompt_eval_count` / `eval_count` on the final frame.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    descriptor, execute, wire_role, ChatCompletionRequest, ChatCompletionResult, ChunkSink,
    HttpTransport, LlmProvider, PreparedRequest, ProviderDescriptor, ProviderError,
};

/// Default address of a desktop-side Ollama, reached through `adb reverse`.
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";

/// The Ollama client.
pub struct Ollama {
    base_url: String,
    transport: Arc<dyn HttpTransport>,
}

impl Ollama {
    pub fn new(base_url: impl Into<String>, transport: Arc<dyn HttpTransport>) -> Self {
        let base_url = base_url.into();
        let base_url = if base_url.trim().is_empty() {
            DEFAULT_BASE_URL.to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };
        Self { base_url, transport }
    }

    pub fn build_request(&self, request: &ChatCompletionRequest) -> PreparedRequest {
        let mut messages: Vec<Value> = Vec::with_capacity(request.messages.len() + 1);
        messages.push(json!({ "role": "system", "content": request.system_prompt }));
        for message in &request.messages {
            messages.push(json!({
                "role": wire_role(&message.role, "assistant"),
                "content": message.content,
            }));
        }

        let body = json!({
            "model": request.model,
            "messages": messages,
            "stream": true,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_tokens,
            },
        });

        PreparedRequest {
            url: format!("{}/api/chat", self.base_url),
            // Deliberately no authorization header: a local server has no key.
            headers: vec![("content-type".to_string(), "application/json".to_string())],
            body: body.to_string(),
        }
    }
}

/// A local client holds no credential, so its whole state is printable.
impl std::fmt::Debug for Ollama {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Ollama")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl LlmProvider for Ollama {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        descriptor(crate::domain::ProviderType::OLLAMA)
    }

    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError> {
        if !request.attachments.is_empty() && !self.descriptor().supports_vision {
            return Err(
                ProviderError::unsupported("OLLAMA does not accept image attachments")
                    .with_detail("provider", "OLLAMA"),
            );
        }
        let prepared = self.build_request(&request);
        execute(self.descriptor(), self.transport.as_ref(), prepared, sink.as_ref()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ErrorCode;
    use crate::providers::test_support::{sample_request, FakeTransport, PNG_DATA_URI};
    use crate::providers::{CollectingSink, ProviderChunk, RequestAttachment};

    const NDJSON: &str = concat!(
        "{\"message\":{\"role\":\"assistant\",\"content\":\"Loc\"},\"done\":false}\n",
        "{\"message\":{\"role\":\"assistant\",\"content\":\"al\"},\"done\":false}\n",
        "{\"done\":true,\"done_reason\":\"stop\",\"prompt_eval_count\":9,\"eval_count\":2}\n",
    );

    #[tokio::test]
    async fn streams_ndjson_and_reports_local_token_counts() {
        let sink = Arc::new(CollectingSink::new());
        let result = Ollama::new(DEFAULT_BASE_URL, FakeTransport::new(200, NDJSON))
            .stream_chat(sample_request("llama3.2"), sink.clone())
            .await
            .expect("stream succeeds");

        assert_eq!(result.text, "Local");
        assert_eq!(result.usage, Some((9, 2)));
        assert_eq!(
            sink.collected().last(),
            Some(&ProviderChunk::Done { finish_reason: "stop".into() })
        );
    }

    #[tokio::test]
    async fn a_local_request_never_sends_a_key() {
        let transport = FakeTransport::new(200, NDJSON);
        Ollama::new("http://127.0.0.1:11434/", transport.clone())
            .stream_chat(sample_request("llama3.2"), Arc::new(CollectingSink::new()))
            .await
            .ok();

        let sent = transport.last();
        assert_eq!(sent.url, "http://127.0.0.1:11434/api/chat");
        assert_eq!(sent.header("authorization"), None);
        assert_eq!(sent.header("x-api-key"), None);

        let body: Value = serde_json::from_str(&sent.body).expect("body is JSON");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["options"]["num_predict"], 256);
        assert_eq!(body["stream"], true);
    }

    #[tokio::test]
    async fn a_missing_model_is_not_found_and_says_how_to_fix_it() {
        let body = "{\"error\":\"model \\\"llama3.2:latest\\\" not found, try pulling it first\"}";
        let error = Ollama::new(DEFAULT_BASE_URL, FakeTransport::new(404, body))
            .stream_chat(sample_request("llama3.2"), Arc::new(CollectingSink::new()))
            .await
            .expect_err("a 404 is not a completion");

        assert_eq!(error.code, ErrorCode::NOT_FOUND);
        assert!(error.message.contains("not found"));
    }

    #[tokio::test]
    async fn an_unreachable_server_is_a_retryable_network_error() {
        let error = Ollama::new(DEFAULT_BASE_URL, FakeTransport::new(0, ""))
            .stream_chat(sample_request("llama3.2"), Arc::new(CollectingSink::new()))
            .await
            .expect_err("a refused connection is not a completion");

        assert_eq!(error.code, ErrorCode::NETWORK);
        assert!(error.retryable);
    }

    #[tokio::test]
    async fn an_image_is_refused_instead_of_silently_dropped() {
        let mut with_image = sample_request("llama3.2");
        with_image.attachments.push(RequestAttachment {
            name: "pic.png".into(),
            mime_type: "image/png".into(),
            data_uri: PNG_DATA_URI.into(),
        });

        let error = Ollama::new(DEFAULT_BASE_URL, FakeTransport::new(200, NDJSON))
            .stream_chat(with_image, Arc::new(CollectingSink::new()))
            .await
            .expect_err("no vision support is advertised");
        assert_eq!(error.code, ErrorCode::UNSUPPORTED);
    }

    #[test]
    fn an_empty_base_url_falls_back_to_localhost() {
        let client = Ollama::new("", FakeTransport::new(200, ""));
        assert_eq!(client.build_request(&sample_request("m")).url, "http://127.0.0.1:11434/api/chat");
    }
}
