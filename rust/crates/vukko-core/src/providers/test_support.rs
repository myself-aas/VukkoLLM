//! Shared test doubles for the provider modules.
//!
//! A transport that records what was sent and replays a canned response lets
//! every provider be tested against the recorded payloads in
//! `tests/providers/fixtures.js` without a network, exactly as the TypeScript
//! twin is.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use super::{ChatCompletionRequest, HttpTransport, PreparedRequest, ProviderError, ProviderMessage};

/// Records requests and replays one fixed response.
pub struct FakeTransport {
    status: u16,
    body: String,
    seen: Mutex<Vec<PreparedRequest>>,
}

impl FakeTransport {
    pub fn new(status: u16, body: &str) -> Arc<Self> {
        Arc::new(Self {
            status,
            body: body.to_string(),
            seen: Mutex::new(Vec::new()),
        })
    }

    /// The most recent request, panicking when nothing was sent.
    pub fn last(&self) -> PreparedRequest {
        self.seen
            .lock()
            .expect("transport lock is not poisoned")
            .last()
            .cloned()
            .expect("transport recorded no request")
    }

    pub fn sent_count(&self) -> usize {
        self.seen.lock().map(|seen| seen.len()).unwrap_or(0)
    }
}

#[async_trait]
impl HttpTransport for FakeTransport {
    async fn post(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        body: String,
    ) -> Result<(u16, String), ProviderError> {
        self.seen
            .lock()
            .expect("transport lock is not poisoned")
            .push(PreparedRequest {
                url: url.to_string(),
                headers,
                body,
            });
        Ok((self.status, self.body.clone()))
    }
}

/// A minimal request shared by the provider tests.
pub fn sample_request(model: &str) -> ChatCompletionRequest {
    ChatCompletionRequest {
        model: model.to_string(),
        system_prompt: "Be brief.".into(),
        messages: vec![
            ProviderMessage {
                role: "USER".into(),
                content: "Hello".into(),
            },
            ProviderMessage {
                role: "ASSISTANT".into(),
                content: "Hi".into(),
            },
            ProviderMessage {
                role: "USER".into(),
                content: "Explain sovereignty.".into(),
            },
        ],
        temperature: 0.4,
        max_tokens: 256,
        attachments: Vec::new(),
    }
}

/// A one-pixel PNG data URI, for vision tests.
pub const PNG_DATA_URI: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
