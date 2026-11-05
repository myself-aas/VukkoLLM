//! Anthropic `/messages` client.
//!
//! Differences from the OpenAI shape that matter: the system prompt is a
//! top-level field (not a message), content blocks are always arrays, images
//! are base64 blocks rather than URLs, and the key travels in `x-api-key` with
//! a required `anthropic-version` header.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    descriptor, execute, split_data_uri, wire_role, ChatCompletionRequest, ChatCompletionResult,
    ChunkSink, HttpTransport, LlmProvider, PreparedRequest, ProviderDescriptor, ProviderError,
};

/// The `anthropic-version` this client is written against.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

/// The Anthropic streaming client.
pub struct Anthropic {
    base_url: String,
    api_key: String,
    transport: Arc<dyn HttpTransport>,
}

impl Anthropic {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        transport: Arc<dyn HttpTransport>,
    ) -> Result<Self, ProviderError> {
        let api_key = api_key.into().trim().to_string();
        if api_key.is_empty() {
            return Err(
                ProviderError::authentication("ANTHROPIC requires an API key")
                    .with_detail("provider", "ANTHROPIC"),
            );
        }
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key,
            transport,
        })
    }

    pub fn build_request(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<PreparedRequest, ProviderError> {
        let mut messages: Vec<Value> = Vec::with_capacity(request.messages.len());
        for message in &request.messages {
            messages.push(json!({
                "role": wire_role(&message.role, "assistant"),
                "content": [{ "type": "text", "text": message.content }],
            }));
        }

        if !request.attachments.is_empty() {
            let last_user = messages
                .iter_mut()
                .rev()
                .find(|message| message.get("role").and_then(Value::as_str) == Some("user"));
            let Some(last_user) = last_user else {
                return Err(ProviderError::validation(
                    "attachments need a user message to attach to",
                ));
            };
            let mut blocks = last_user
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for attachment in &request.attachments {
                let (mime_type, data) = split_data_uri(&attachment.data_uri)?;
                blocks.push(json!({
                    "type": "image",
                    "source": { "type": "base64", "media_type": mime_type, "data": data },
                }));
            }
            last_user["content"] = Value::Array(blocks);
        }

        let body = json!({
            "model": request.model,
            "system": request.system_prompt,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": true,
        });

        Ok(PreparedRequest {
            url: format!("{}/messages", self.base_url),
            headers: vec![
                ("content-type".to_string(), "application/json".to_string()),
                ("x-api-key".to_string(), self.api_key.clone()),
                (
                    "anthropic-version".to_string(),
                    ANTHROPIC_VERSION.to_string(),
                ),
            ],
            body: body.to_string(),
        })
    }
}

/// Debug never prints the key.
impl std::fmt::Debug for Anthropic {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Anthropic")
            .field("base_url", &self.base_url)
            .field("api_key", &"[redacted]")
            .finish()
    }
}

#[async_trait]
impl LlmProvider for Anthropic {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        descriptor(crate::domain::ProviderType::ANTHROPIC)
    }

    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError> {
        let prepared = self.build_request(&request)?;
        execute(self.descriptor(), self.transport.as_ref(), prepared, sink.as_ref()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ErrorCode;
    use crate::providers::test_support::{sample_request, FakeTransport, PNG_DATA_URI};
    use crate::providers::{CollectingSink, ProviderChunk, RequestAttachment};

    const SSE: &str = concat!(
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":25}}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Bonjour\"}}\n\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":64}}\n\n",
    );

    fn client(transport: Arc<FakeTransport>) -> Anthropic {
        Anthropic::new("https://api.anthropic.com/v1", "sk-ant-test", transport).expect("builds")
    }

    #[tokio::test]
    async fn streams_text_then_usage_then_done() {
        let sink = Arc::new(CollectingSink::new());
        let result = client(FakeTransport::new(200, SSE))
            .stream_chat(sample_request("claude-sonnet-4"), sink.clone())
            .await
            .expect("stream succeeds");

        assert_eq!(result.text, "Bonjour");
        assert_eq!(result.usage, Some((25, 64)));
        assert_eq!(result.finish_reason.as_deref(), Some("end_turn"));
        assert_eq!(
            sink.collected().last(),
            Some(&ProviderChunk::Done { finish_reason: "end_turn".into() })
        );
    }

    #[tokio::test]
    async fn the_system_prompt_is_a_top_level_field() {
        let transport = FakeTransport::new(200, SSE);
        client(transport.clone())
            .stream_chat(sample_request("claude-sonnet-4"), Arc::new(CollectingSink::new()))
            .await
            .ok();

        let sent = transport.last();
        assert_eq!(sent.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(sent.header("x-api-key"), Some("sk-ant-test"));
        assert_eq!(sent.header("anthropic-version"), Some(ANTHROPIC_VERSION));

        let body: Value = serde_json::from_str(&sent.body).expect("body is JSON");
        assert_eq!(body["system"], "Be brief.");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][1]["role"], "assistant");
        assert_eq!(body["messages"][0]["content"][0]["type"], "text");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn images_become_base64_blocks() {
        let mut with_image = sample_request("claude-sonnet-4");
        with_image.attachments.push(RequestAttachment {
            name: "pic.png".into(),
            mime_type: "image/png".into(),
            data_uri: PNG_DATA_URI.into(),
        });

        let prepared = client(FakeTransport::new(200, SSE))
            .build_request(&with_image)
            .expect("request builds");
        let body: Value = serde_json::from_str(&prepared.body).expect("body is JSON");
        let block = &body["messages"][2]["content"][1];

        assert_eq!(block["type"], "image");
        assert_eq!(block["source"]["type"], "base64");
        assert_eq!(block["source"]["media_type"], "image/png");
    }

    #[test]
    fn a_non_data_uri_attachment_is_a_validation_error() {
        let mut bad = sample_request("claude-sonnet-4");
        bad.attachments.push(RequestAttachment {
            name: "pic.png".into(),
            mime_type: "image/png".into(),
            data_uri: "https://example.com/pic.png".into(),
        });

        let error = client(FakeTransport::new(200, SSE))
            .build_request(&bad)
            .expect_err("a URL is not a data URI");
        assert_eq!(error.code, ErrorCode::VALIDATION);
    }

    #[tokio::test]
    async fn a_streamed_error_event_fails_the_request() {
        let body = "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";
        let error = client(FakeTransport::new(200, body))
            .stream_chat(sample_request("claude-sonnet-4"), Arc::new(CollectingSink::new()))
            .await
            .expect_err("an error event is not a completion");
        assert_eq!(error.code, ErrorCode::NETWORK);
    }

    #[test]
    fn a_missing_key_is_refused_at_build_time() {
        let error = Anthropic::new("https://api.anthropic.com/v1", "", FakeTransport::new(200, ""))
            .expect_err("an empty key is refused");
        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
    }
}
