//! Google Gemini `:streamGenerateContent` client.
//!
//! Gemini sends the system prompt as `systemInstruction`, calls the assistant
//! role `model`, inlines images as `inlineData`, and authenticates with
//! `x-goog-api-key` on a URL that contains the model name.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    descriptor, execute, split_data_uri, wire_role, ChatCompletionRequest, ChatCompletionResult,
    ChunkSink, HttpTransport, LlmProvider, PreparedRequest, ProviderDescriptor, ProviderError,
};

/// The Gemini streaming client.
pub struct Gemini {
    base_url: String,
    api_key: String,
    transport: Arc<dyn HttpTransport>,
}

impl Gemini {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        transport: Arc<dyn HttpTransport>,
    ) -> Result<Self, ProviderError> {
        let api_key = api_key.into().trim().to_string();
        if api_key.is_empty() {
            return Err(ProviderError::authentication("GEMINI requires an API key")
                .with_detail("provider", "GEMINI"));
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
        let mut contents: Vec<Value> = Vec::with_capacity(request.messages.len());
        for message in &request.messages {
            contents.push(json!({
                "role": wire_role(&message.role, "model"),
                "parts": [{ "text": message.content }],
            }));
        }

        if !request.attachments.is_empty() {
            let last_user = contents
                .iter_mut()
                .rev()
                .find(|entry| entry.get("role").and_then(Value::as_str) == Some("user"));
            let Some(last_user) = last_user else {
                return Err(ProviderError::validation(
                    "attachments need a user message to attach to",
                ));
            };
            let mut parts = last_user
                .get("parts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for attachment in &request.attachments {
                let (mime_type, data) = split_data_uri(&attachment.data_uri)?;
                parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": data } }));
            }
            last_user["parts"] = Value::Array(parts);
        }

        let body = json!({
            "systemInstruction": { "parts": [{ "text": request.system_prompt }] },
            "contents": contents,
            "generationConfig": {
                "temperature": request.temperature,
                "maxOutputTokens": request.max_tokens,
            },
        });

        Ok(PreparedRequest {
            url: format!(
                "{}/models/{}:streamGenerateContent?alt=sse",
                self.base_url,
                urlencode(&request.model)
            ),
            headers: vec![
                ("content-type".to_string(), "application/json".to_string()),
                ("x-goog-api-key".to_string(), self.api_key.clone()),
            ],
            body: body.to_string(),
        })
    }
}

/// Percent-encodes a model id, matching `encodeURIComponent` for the characters
/// model ids actually contain.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

/// Debug never prints the key.
impl std::fmt::Debug for Gemini {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Gemini")
            .field("base_url", &self.base_url)
            .field("api_key", &"[redacted]")
            .finish()
    }
}

#[async_trait]
impl LlmProvider for Gemini {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        descriptor(crate::domain::ProviderType::GEMINI)
    }

    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError> {
        let prepared = self.build_request(&request)?;
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
    use crate::providers::test_support::{sample_request, FakeTransport, PNG_DATA_URI};
    use crate::providers::{CollectingSink, ProviderChunk, RequestAttachment};

    const SSE: &str = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Sovereignty is\"}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" final authority.\"}]},\"finishReason\":\"STOP\"}]}\n\n",
        "data: {\"usageMetadata\":{\"promptTokenCount\":12,\"candidatesTokenCount\":7}}\n\n",
    );

    fn client(transport: Arc<FakeTransport>) -> Gemini {
        Gemini::new(
            "https://generativelanguage.googleapis.com/v1beta",
            "AIza-test",
            transport,
        )
        .expect("builds")
    }

    #[tokio::test]
    async fn usage_arrives_before_the_single_done() {
        let sink = Arc::new(CollectingSink::new());
        let result = client(FakeTransport::new(200, SSE))
            .stream_chat(sample_request("gemini-2.5-flash"), sink.clone())
            .await
            .expect("stream succeeds");

        assert_eq!(result.text, "Sovereignty is final authority.");
        assert_eq!(result.usage, Some((12, 7)));
        let chunks = sink.collected();
        assert_eq!(
            chunks.len(),
            4,
            "two text frames, usage, done: {:?}",
            chunks
        );
        assert!(matches!(chunks[2], ProviderChunk::Usage { .. }));
        assert_eq!(
            chunks[3],
            ProviderChunk::Done {
                finish_reason: "STOP".into()
            },
            "exactly one done, emitted last"
        );
    }

    #[tokio::test]
    async fn thought_parts_become_reasoning_without_joining_the_answer() {
        let body = concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"thinking\",\"thought\":true}]}}]}\n\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"answer\"}]},\"finishReason\":\"STOP\"}]}\n\n",
        );
        let result = client(FakeTransport::new(200, body))
            .stream_chat(
                sample_request("gemini-2.5-flash"),
                Arc::new(CollectingSink::new()),
            )
            .await
            .expect("stream succeeds");

        assert_eq!(result.text, "answer");
        assert_eq!(result.reasoning.as_deref(), Some("thinking"));
    }

    #[tokio::test]
    async fn the_request_uses_the_gemini_vocabulary() {
        let transport = FakeTransport::new(200, SSE);
        client(transport.clone())
            .stream_chat(
                sample_request("gemini-2.5-flash"),
                Arc::new(CollectingSink::new()),
            )
            .await
            .ok();

        let sent = transport.last();
        assert!(sent
            .url
            .ends_with("/models/gemini-2.5-flash:streamGenerateContent?alt=sse"));
        assert_eq!(sent.header("x-goog-api-key"), Some("AIza-test"));
        assert_eq!(
            sent.header("authorization"),
            None,
            "Gemini has no bearer auth"
        );

        let body: Value = serde_json::from_str(&sent.body).expect("body is JSON");
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Be brief.");
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 256);
    }

    #[test]
    fn images_become_inline_data() {
        let mut with_image = sample_request("gemini-2.5-flash");
        with_image.attachments.push(RequestAttachment {
            name: "pic.png".into(),
            mime_type: "image/png".into(),
            data_uri: PNG_DATA_URI.into(),
        });

        let prepared = client(FakeTransport::new(200, SSE))
            .build_request(&with_image)
            .expect("request builds");
        let body: Value = serde_json::from_str(&prepared.body).expect("body is JSON");
        let part = &body["contents"][2]["parts"][1];

        assert_eq!(part["inlineData"]["mimeType"], "image/png");
    }

    #[tokio::test]
    async fn a_rejected_key_is_an_authentication_error() {
        let error = client(FakeTransport::new(
            403,
            "{\"error\":{\"code\":403,\"message\":\"API key not valid. Please pass a valid API key.\",\"status\":\"PERMISSION_DENIED\"}}",
        ))
        .stream_chat(sample_request("gemini-2.5-flash"), Arc::new(CollectingSink::new()))
        .await
        .expect_err("a 403 is not a completion");

        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert!(!error.message.contains("AIza-test"));
    }

    #[test]
    fn the_model_is_url_encoded() {
        assert_eq!(urlencode("models/gemini 2.5"), "models%2Fgemini%202.5");
        assert_eq!(urlencode("gemini-2.5-flash"), "gemini-2.5-flash");
    }
}
