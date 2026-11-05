//! A deterministic provider for tests, demos and offline previews.
//!
//! It exists so the chat pipeline can be exercised end to end without a network
//! and without a fixture that pretends to be a real vendor. Two rules make it
//! safe to ship:
//!
//! - it is constructed explicitly ([`MockProvider::new`]) and never selected by
//!   [`super::factory::select`], so no production path can fall into it;
//! - it reports itself as `is_mock`, so the UI can label a demo transcript the
//!   way it labels the demo GitHub service.
//!
//! The scripted response is deterministic per request, which is what makes it
//! usable as the provider in the E2E scenario.

use std::sync::Arc;

use async_trait::async_trait;

use super::{
    descriptor, ChatCompletionRequest, ChatCompletionResult, ChunkSink, LlmProvider, ProviderChunk,
    ProviderDescriptor, ProviderError,
};

/// A provider that replays a fixed script.
#[derive(Debug, Clone)]
pub struct MockProvider {
    /// Chunks emitted, in order, before the terminal `done`.
    script: Vec<String>,
    /// Chunks delivered before the sink is asked whether it was cancelled. A
    /// zero means cancellation is never observed mid-stream.
    cancel_after: usize,
}

impl MockProvider {
    /// The default script: a short answer in two deltas.
    pub fn new() -> Self {
        Self {
            script: vec![
                "Sovereignty ".to_string(),
                "is final authority.".to_string(),
            ],
            cancel_after: 0,
        }
    }

    /// A provider that answers with `text`, split into `chunks` pieces.
    pub fn scripted(text: &str, chunks: usize) -> Self {
        let chunks = chunks.max(1);
        let size = text.chars().count().div_ceil(chunks).max(1);
        let mut script = Vec::new();
        let mut buffer = String::new();
        for (index, character) in text.chars().enumerate() {
            buffer.push(character);
            if (index + 1) % size == 0 {
                script.push(std::mem::take(&mut buffer));
            }
        }
        if !buffer.is_empty() {
            script.push(buffer);
        }
        Self {
            script,
            cancel_after: 0,
        }
    }

    /// Observed cancellation: stop after `chunks` chunks and report it.
    pub fn cancelling_after(chunks: usize) -> Self {
        Self {
            script: (0..chunks + 2)
                .map(|index| format!("chunk{} ", index))
                .collect(),
            cancel_after: chunks,
        }
    }

    pub fn is_mock(&self) -> bool {
        true
    }
}

impl Default for MockProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LlmProvider for MockProvider {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        // The instance descriptor is the closest honest fit: it is the provider
        // that streams our own frames, and the mock streams the same vocabulary.
        descriptor(crate::domain::ProviderType::INSTANCE)
    }

    async fn stream_chat(
        &self,
        _request: ChatCompletionRequest,
        sink: Arc<dyn ChunkSink>,
    ) -> Result<ChatCompletionResult, ProviderError> {
        let mut chunks = Vec::with_capacity(self.script.len() + 1);

        for (index, text) in self.script.iter().enumerate() {
            if self.cancel_after > 0 && index >= self.cancel_after {
                return Err(ProviderError::cancelled());
            }
            if sink.is_cancelled() {
                return Err(ProviderError::cancelled());
            }
            let chunk = ProviderChunk::Text { text: text.clone() };
            sink.send(chunk.clone());
            chunks.push(chunk);
        }

        let done = ProviderChunk::Done {
            finish_reason: "stop".to_string(),
        };
        sink.send(done.clone());
        chunks.push(done);

        Ok(super::fold_chunks(&chunks))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{fold_chunks, test_support::sample_request, CollectingSink};

    #[tokio::test]
    async fn the_default_script_produces_a_deterministic_answer() {
        let sink = Arc::new(CollectingSink::new());
        let result = MockProvider::new()
            .stream_chat(sample_request("mock"), sink.clone())
            .await
            .expect("mock always succeeds");

        assert_eq!(result.text, "Sovereignty is final authority.");
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
        assert_eq!(
            sink.collected().last(),
            Some(&ProviderChunk::Done {
                finish_reason: "stop".into()
            })
        );
    }

    #[tokio::test]
    async fn two_runs_produce_identical_chunks() {
        let first = Arc::new(CollectingSink::new());
        let second = Arc::new(CollectingSink::new());
        let provider = MockProvider::scripted("deterministic output", 4);

        provider
            .stream_chat(sample_request("mock"), first.clone())
            .await
            .expect("first");
        provider
            .stream_chat(sample_request("mock"), second.clone())
            .await
            .expect("second");

        assert_eq!(first.collected(), second.collected());
        assert_eq!(fold_chunks(&first.collected()).text, "deterministic output");
    }

    #[tokio::test]
    async fn a_cancelled_mock_stops_mid_script() {
        let sink = Arc::new(CollectingSink::new());
        let error = MockProvider::cancelling_after(1)
            .stream_chat(sample_request("mock"), sink.clone())
            .await
            .expect_err("cancellation is reported");

        assert_eq!(error.code, crate::domain::ErrorCode::CANCELLED);
        assert_eq!(sink.collected().len(), 1);
    }

    #[tokio::test]
    async fn an_already_cancelled_sink_gets_nothing() {
        let sink = Arc::new(CollectingSink::new());
        sink.cancel();
        let error = MockProvider::new()
            .stream_chat(sample_request("mock"), sink.clone())
            .await
            .expect_err("cancelled before the first chunk");
        assert_eq!(error.code, crate::domain::ErrorCode::CANCELLED);
        assert!(sink.collected().is_empty());
    }

    #[test]
    fn the_mock_is_never_reachable_from_the_factory() {
        // The factory's arms enumerate concrete clients; the mock has no arm,
        // so no provider selection can produce it.
        let factory = include_str!("factory.rs");
        assert!(!factory.contains("MockProvider"));
    }
}
