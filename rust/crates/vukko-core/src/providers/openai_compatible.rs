//! OpenAI-compatible providers: OpenAI, DeepSeek and Groq.
//!
//! They disagree about base URL, model list and vision support, but the wire
//! protocol is identical, so one implementation serves all three and the
//! descriptor carries the differences.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    descriptor, execute, wire_role, ChatCompletionRequest, ChatCompletionResult, ChunkSink,
    HttpTransport, LlmProvider, PreparedRequest, ProviderDescriptor, ProviderError,
};

/// The OpenAI `/chat/completions` client.
pub struct OpenAiCompatible {
    provider: crate::domain::ProviderType,
    base_url: String,
    api_key: String,
    transport: Arc<dyn HttpTransport>,
}

impl OpenAiCompatible {
    /// Builds a client. An empty key is refused when the provider requires one,
    /// so a misconfigured provider fails before any network call is attempted.
    pub fn new(
        provider: crate::domain::ProviderType,
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        transport: Arc<dyn HttpTransport>,
    ) -> Result<Self, ProviderError> {
        let descriptor = descriptor(provider);
        let api_key = api_key.into();
        let api_key = api_key.trim().to_string();
        if descriptor.requires_api_key && api_key.is_empty() {
            return Err(ProviderError::authentication(format!(
                "{:?} requires an API key",
                provider
            ))
            .with_detail("provider", format!("{:?}", provider)));
        }
        Ok(Self {
            provider,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key,
            transport,
        })
    }

    /// The request body, matching `buildRequest('OPENAI_SSE', ...)`.
    pub fn build_request(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<PreparedRequest, ProviderError> {
        let mut messages: Vec<Value> = Vec::with_capacity(request.messages.len() + 1);
        messages.push(json!({ "role": "system", "content": request.system_prompt }));
        for message in &request.messages {
            messages.push(json!({
                "role": wire_role(&message.role, "assistant"),
                "content": message.content,
            }));
        }

        if !request.attachments.is_empty() {
            // Vision input rides on the last user turn, as the API expects.
            let last_user = messages.iter_mut().rev().find(|message| {
                message.get("role").and_then(Value::as_str) == Some("user")
            });
            let Some(last_user) = last_user else {
                return Err(ProviderError::validation(
                    "attachments need a user message to attach to",
                ));
            };
            let mut parts = vec![json!({
                "type": "text",
                "text": last_user.get("content").and_then(Value::as_str).unwrap_or_default(),
            })];
            for attachment in &request.attachments {
                parts.push(json!({
                    "type": "image_url",
                    "image_url": { "url": attachment.data_uri },
                }));
            }
            last_user["content"] = Value::Array(parts);
        }

        let body = json!({
            "model": request.model,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": true,
            "stream_options": { "include_usage": true },
        });

        Ok(PreparedRequest {
            url: format!("{}/chat/completions", self.base_url),
            headers: vec![
                ("content-type".to_string(), "application/json".to_string()),
                (
                    "authorization".to_string(),
                    format!("Bearer {}", self.api_key),
                ),
            ],
            body: body.to_string(),
        })
    }
}

/// Debug never prints the key: provider structs end up in logs and panic
/// messages, and a credential must not travel with them.
impl std::fmt::Debug for OpenAiCompatible {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenAiCompatible")
            .field("provider", &self.provider)
            .field("base_url", &self.base_url)
            .field("api_key", &"[redacted]")
            .finish()
    }
}

#[async_trait]
impl LlmProvider for OpenAiCompatible {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        descriptor(self.provider)
    }

    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError> {
        if !request.attachments.is_empty() && !self.descriptor().supports_vision {
            return Err(ProviderError::unsupported(format!(
                "{:?} does not accept image attachments",
                self.provider
            )));
        }
        let prepared = self.build_request(&request)?;
        execute(self.descriptor(), self.transport.as_ref(), prepared, sink.as_ref()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ErrorCode, ProviderType};
    use crate::providers::test_support::{sample_request, FakeTransport, PNG_DATA_URI};
    use crate::providers::{CollectingSink, ProviderChunk, RequestAttachment};

    fn request() -> ChatCompletionRequest {
        sample_request("gpt-4o")
    }

    const SSE: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    fn client(transport: Arc<FakeTransport>) -> OpenAiCompatible {
        OpenAiCompatible::new(ProviderType::OPENAI, "https://api.openai.com/v1/", "sk-test", transport)
            .expect("client builds with a key")
    }

    #[tokio::test]
    async fn streams_normalised_chunks_and_folds_the_result() {
        let transport = FakeTransport::new(200, SSE);
        let sink = Arc::new(CollectingSink::new());

        let result = client(transport.clone())
            .stream_chat(request(), sink.clone())
            .await
            .expect("stream succeeds");

        assert_eq!(result.text, "Hi");
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
        assert_eq!(
            sink.collected(),
            vec![
                ProviderChunk::Text { text: "Hi".into() },
                ProviderChunk::Done { finish_reason: "stop".into() },
            ]
        );
    }

    #[tokio::test]
    async fn the_request_matches_the_typescript_shape() {
        let transport = FakeTransport::new(200, SSE);
        client(transport.clone()).stream_chat(request(), Arc::new(CollectingSink::new())).await.ok();

        let sent = transport.last();
        assert_eq!(sent.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(sent.header("authorization"), Some("Bearer sk-test"));
        let body: Value = serde_json::from_str(&sent.body).expect("body is JSON");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["role"], "user");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_tokens"], 256);
        assert_eq!(body["stream_options"]["include_usage"], true);
    }

    #[tokio::test]
    async fn a_rejected_key_becomes_an_authentication_error() {
        let transport = FakeTransport::new(
            401,
            "{\"error\":{\"message\":\"Incorrect API key provided: sk-live-abcdef123456\"}}",
        );
        let error = client(transport)
            .stream_chat(request(), Arc::new(CollectingSink::new()))
            .await
            .expect_err("a 401 is not a completion");

        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert!(!error.retryable);
        assert!(!error.message.contains("sk-live-abcdef123456"));
    }

    #[tokio::test]
    async fn cancellation_stops_before_anything_is_emitted() {
        let sink = Arc::new(CollectingSink::new());
        sink.cancel();

        let error = client(FakeTransport::new(200, SSE))
            .stream_chat(request(), sink.clone())
            .await
            .expect_err("a cancelled request does not succeed");

        assert_eq!(error.code, ErrorCode::CANCELLED);
        assert!(sink.collected().is_empty());
    }

    #[test]
    fn debug_never_prints_the_key() {
        let rendered = format!("{:?}", client(FakeTransport::new(200, "")));
        assert!(rendered.contains("[redacted]"));
        assert!(!rendered.contains("sk-test"));
    }

    #[test]
    fn a_missing_key_fails_at_build_time() {
        let error = OpenAiCompatible::new(
            ProviderType::OPENAI,
            "https://api.openai.com/v1",
            "   ",
            FakeTransport::new(200, ""),
        )
        .expect_err("an empty key is refused");

        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
    }

    #[test]
    fn vision_attachments_become_image_parts() {
        let mut with_image = request();
        with_image.attachments.push(RequestAttachment {
            name: "pic.png".into(),
            mime_type: "image/png".into(),
            data_uri: PNG_DATA_URI.into(),
        });

        let prepared = client(FakeTransport::new(200, SSE))
            .build_request(&with_image)
            .expect("request builds");
        let body: Value = serde_json::from_str(&prepared.body).expect("body is JSON");

        // The image rides on the last user turn, which is index 2 here.
        assert_eq!(body["messages"][2]["content"][1]["type"], "image_url");
        assert_eq!(body["messages"][2]["content"][1]["image_url"]["url"], PNG_DATA_URI);
    }

    #[tokio::test]
    async fn a_provider_without_vision_refuses_an_image() {
        let mut with_image = request();
        with_image.attachments.push(RequestAttachment {
            name: "pic.png".into(),
            mime_type: "image/png".into(),
            data_uri: PNG_DATA_URI.into(),
        });
        let da = OpenAiCompatible::new(
            ProviderType::DEEPSEEK,
            "https://api.deepseek.com/v1",
            "k",
            FakeTransport::new(200, ""),
        )
        .expect("client builds");

        let error = da
            .stream_chat(with_image, Arc::new(CollectingSink::new()))
            .await
            .expect_err("DeepSeek has no vision");
        assert_eq!(error.code, ErrorCode::UNSUPPORTED);
    }
}
