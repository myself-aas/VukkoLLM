//! The self-hosted Vukko instance server (`POST /v1/chat`).
//!
//! This is the sovereignty path: the user's own server does retrieval and
//! inference, and it is the only provider that can return retrieval citations.
//! A key is optional — a LAN server usually has none — so the header is only
//! added when one is configured, and the request body matches
//! `buildRequest('INSTANCE_NDJSON', ...)`.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    descriptor, execute, wire_role, ChatCompletionRequest, ChatCompletionResult, ChunkSink,
    HttpTransport, LlmProvider, PreparedRequest, ProviderDescriptor, ProviderError,
};

/// Default address of the instance server as seen from the Android emulator.
pub const DEFAULT_BASE_URL: &str = "http://10.0.2.2:3001";

/// The instance-server client.
pub struct InstanceServer {
    base_url: String,
    api_key: Option<String>,
    transport: Arc<dyn HttpTransport>,
}

impl InstanceServer {
    pub fn new(
        base_url: impl Into<String>,
        api_key: Option<String>,
        transport: Arc<dyn HttpTransport>,
    ) -> Self {
        let base_url = base_url.into();
        let base_url = if base_url.trim().is_empty() {
            DEFAULT_BASE_URL.to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };
        let api_key = api_key
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty());
        Self {
            base_url,
            api_key,
            transport,
        }
    }

    pub fn build_request(&self, request: &ChatCompletionRequest) -> PreparedRequest {
        let body = json!({
            "model": request.model,
            "systemPrompt": request.system_prompt,
            "messages": request
                .messages
                .iter()
                .map(|message| json!({
                    "role": wire_role(&message.role, "assistant"),
                    "content": message.content,
                }))
                .collect::<Vec<Value>>(),
            "temperature": request.temperature,
            "maxTokens": request.max_tokens,
            "stream": true,
            "attachments": request
                .attachments
                .iter()
                .map(|attachment| json!({
                    "name": attachment.name,
                    "mimeType": attachment.mime_type,
                    "dataUri": attachment.data_uri,
                }))
                .collect::<Vec<Value>>(),
        });

        let mut headers = vec![("content-type".to_string(), "application/json".to_string())];
        if let Some(key) = &self.api_key {
            headers.push(("authorization".to_string(), format!("Bearer {}", key)));
        }

        PreparedRequest {
            url: format!("{}/v1/chat", self.base_url),
            headers,
            body: body.to_string(),
        }
    }
}

/// Debug never prints the key.
impl std::fmt::Debug for InstanceServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("InstanceServer")
            .field("base_url", &self.base_url)
            .field(
                "api_key",
                &if self.api_key.is_some() {
                    "[redacted]"
                } else {
                    "[none]"
                },
            )
            .finish()
    }
}

#[async_trait]
impl LlmProvider for InstanceServer {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        descriptor(crate::domain::ProviderType::INSTANCE)
    }

    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError> {
        let prepared = self.build_request(&request);
        execute(
            self.descriptor(),
            self.transport.as_ref(),
            prepared,
            sink.as_ref(),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ErrorCode;
    use crate::providers::test_support::{sample_request, FakeTransport};
    use crate::providers::{CollectingSink, ProviderChunk};

    const NDJSON: &str = concat!(
        "{\"type\":\"delta\",\"text\":\"Streaming\"}\n",
        "{\"type\":\"citation\",\"title\":\"whitepaper.pdf\",\"source\":\"Section 2\",\"snippet\":\"hybrid RAG\",\"score\":0.91}\n",
        "{\"type\":\"done\",\"finishReason\":\"stop\",\"usage\":{\"input\":30,\"output\":8}}\n",
    );

    #[tokio::test]
    async fn retrieval_citations_reach_the_caller() {
        let result = InstanceServer::new(DEFAULT_BASE_URL, None, FakeTransport::new(200, NDJSON))
            .stream_chat(sample_request("vukko-rag"), Arc::new(CollectingSink::new()))
            .await
            .expect("stream succeeds");

        assert_eq!(result.text, "Streaming");
        assert_eq!(result.citations.len(), 1);
        assert_eq!(result.citations[0].title, "whitepaper.pdf");
        assert_eq!(result.citations[0].score, 0.91);
        assert_eq!(result.usage, Some((30, 8)));
    }

    #[tokio::test]
    async fn no_key_means_no_authorization_header() {
        let transport = FakeTransport::new(200, NDJSON);
        InstanceServer::new("http://10.0.2.2:3001/", None, transport.clone())
            .stream_chat(sample_request("vukko-rag"), Arc::new(CollectingSink::new()))
            .await
            .ok();

        let sent = transport.last();
        assert_eq!(sent.url, "http://10.0.2.2:3001/v1/chat");
        assert_eq!(sent.header("authorization"), None);

        let body: Value = serde_json::from_str(&sent.body).expect("body is JSON");
        assert_eq!(body["systemPrompt"], "Be brief.");
        assert_eq!(body["maxTokens"], 256);
        assert_eq!(body["attachments"], json!([]));
    }

    #[tokio::test]
    async fn a_configured_key_is_sent_as_a_bearer_token() {
        let transport = FakeTransport::new(200, NDJSON);
        InstanceServer::new(
            DEFAULT_BASE_URL,
            Some("  lan-key  ".to_string()),
            transport.clone(),
        )
        .stream_chat(sample_request("vukko-rag"), Arc::new(CollectingSink::new()))
        .await
        .ok();

        assert_eq!(
            transport.last().header("authorization"),
            Some("Bearer lan-key")
        );
    }

    #[tokio::test]
    async fn a_bad_gateway_is_retryable_and_keeps_the_body_text() {
        let error = InstanceServer::new(
            DEFAULT_BASE_URL,
            None,
            FakeTransport::new(502, "Bad Gateway"),
        )
        .stream_chat(sample_request("vukko-rag"), Arc::new(CollectingSink::new()))
        .await
        .expect_err("a 502 is not a completion");

        assert_eq!(error.code, ErrorCode::NETWORK);
        assert!(error.retryable);
        assert_eq!(error.message, "Bad Gateway");
    }

    #[tokio::test]
    async fn an_error_frame_fails_the_stream() {
        let body = "{\"type\":\"delta\",\"text\":\"partial\"}\n{\"type\":\"error\",\"code\":\"AUTHENTICATION\",\"message\":\"invalid token\"}\n";
        let sink = Arc::new(CollectingSink::new());
        let error = InstanceServer::new(DEFAULT_BASE_URL, None, FakeTransport::new(200, body))
            .stream_chat(sample_request("vukko-rag"), sink.clone())
            .await
            .expect_err("an error frame is not a completion");

        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert_eq!(
            sink.collected(),
            vec![ProviderChunk::Text {
                text: "partial".into()
            }],
            "the partial text is delivered, but the request still fails"
        );
    }

    #[test]
    fn an_empty_base_url_falls_back_to_the_emulator_host() {
        let client = InstanceServer::new("", None, FakeTransport::new(200, ""));
        assert_eq!(
            client.build_request(&sample_request("m")).url,
            "http://10.0.2.2:3001/v1/chat"
        );
    }
}
