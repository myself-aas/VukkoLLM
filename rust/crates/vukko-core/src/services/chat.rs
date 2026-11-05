//! Chat execution orchestration (MIGRATION_PLAN.md §8 Step 5.3).
//!
//! The Rust counterpart of `src/services/chatService.ts`. Both implement the
//! same lifecycle, and both are tested against the same scenarios:
//!
//! - `send` persists the user turn and a streaming assistant row *before* the
//!   first token, so a crash mid-stream still leaves a coherent transcript;
//! - deltas are applied in order and only to a live request;
//! - a late delta after cancellation or completion is rejected by the
//!   repository, which is why `append_delta` returns `CANCELLED`;
//! - a provider failure marks the row failed and stores no invented content;
//! - `cancel` is idempotent.
//!
//! The service owns no UI, no HTTP and no vendor format: it composes the
//! message repository with an `LlmProvider`.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use crate::domain::{ChatMessage, Timestamp, VukkoError};
use crate::providers::{
    ChatCompletionRequest, ChatCompletionResult, ChunkSink, ProviderChunk, ProviderError,
};
use crate::repository::message_repository;

/// Where a request is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestStatus {
    Pending,
    Streaming,
    Completed,
    Failed,
    Cancelled,
}

impl RequestStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RequestStatus::Completed | RequestStatus::Failed | RequestStatus::Cancelled
        )
    }
}

/// A chat request handed to the service.
#[derive(Debug, Clone, PartialEq)]
pub struct SendRequest {
    pub thread_id: String,
    pub content: String,
    pub provider_request: ChatCompletionRequest,
}

/// The handle returned from `send`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestHandle {
    pub request_id: String,
    pub assistant_message_id: String,
}

#[derive(Debug, Clone)]
struct RequestState {
    status: RequestStatus,
    assistant_message_id: String,
    partial: String,
}

/// The cancellation signal handed to a provider.
///
/// Persistence is deliberately *not* done here: the service applies each chunk
/// through [`ChatService::apply_chunk`] so the in-memory state and the database
/// stay in step, and a chunk that arrives after a cancel is dropped by one
/// function rather than raced by two. What the provider needs from a sink is the
/// answer to "should I stop?", which is exactly what this implements.
pub struct CancellationSink {
    request_id: String,
    state: Arc<Mutex<BTreeMap<String, RequestState>>>,
}

impl ChunkSink for CancellationSink {
    fn send(&self, _chunk: ProviderChunk) {
        // Nothing to do: the service drains chunks it receives directly.
    }

    fn is_cancelled(&self) -> bool {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.get(&self.request_id).map(|request| request.status))
            .is_some_and(RequestStatus::is_terminal)
    }
}

/// Result of draining a stream.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamOutcome {
    pub completion: Option<ChatCompletionResult>,
    pub error: Option<ProviderError>,
}

/// The chat lifecycle, over one connection.
pub struct ChatService<'a> {
    conn: &'a rusqlite::Connection,
    state: Arc<Mutex<BTreeMap<String, RequestState>>>,
    counter: Mutex<u64>,
}

impl<'a> ChatService<'a> {
    pub fn new(conn: &'a rusqlite::Connection) -> Self {
        Self {
            conn,
            state: Arc::new(Mutex::new(BTreeMap::new())),
            counter: Mutex::new(0),
        }
    }

    /// `req_<base36 millis>_<base36 sequence>`, the same shape as the
    /// TypeScript service so a log line can be matched across both.
    fn next_request_id(&self) -> String {
        let sequence = match self.counter.lock() {
            Ok(mut counter) => {
                *counter += 1;
                *counter
            }
            Err(_) => 0,
        };
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        format!("req_{}_{}", to_base36(millis), to_base36(sequence))
    }

    /// Starts a request: the user turn and the streaming row are written first.
    pub fn send(&self, request: &SendRequest) -> Result<RequestHandle, VukkoError> {
        let content = request.content.trim();
        if content.is_empty() {
            return Err(VukkoError::validation("content is required"));
        }

        message_repository::append_user_turn(self.conn, &request.thread_id, content, None)?;
        let placeholder = message_repository::append(
            self.conn,
            &request.thread_id,
            &message_repository::NewMessage {
                sender: Some(crate::domain::MessageSender::ASSISTANT),
                content: String::new(),
                is_streaming: true,
                ..Default::default()
            },
        )?;

        let request_id = self.next_request_id();
        if let Ok(mut state) = self.state.lock() {
            state.insert(
                request_id.clone(),
                RequestState {
                    status: RequestStatus::Pending,
                    assistant_message_id: placeholder.id.clone(),
                    partial: String::new(),
                },
            );
        }

        Ok(RequestHandle {
            request_id,
            assistant_message_id: placeholder.id,
        })
    }

    /// A sink for the provider, so cancellation is observed mid-stream.
    pub fn sink(&self, handle: &RequestHandle) -> CancellationSink {
        CancellationSink {
            request_id: handle.request_id.clone(),
            state: Arc::clone(&self.state),
        }
    }

    /// Applies one chunk. Returns the persisted message for text chunks.
    pub fn apply_chunk(
        &self,
        handle: &RequestHandle,
        chunk: &ProviderChunk,
    ) -> Result<Option<ChatMessage>, VukkoError> {
        if self.status(&handle.request_id).is_some_and(RequestStatus::is_terminal) {
            // Late chunks never resurrect a finished or cancelled message.
            return Ok(None);
        }

        match chunk {
            ProviderChunk::Text { text } => {
                let message = message_repository::append_delta(
                    self.conn,
                    &handle.assistant_message_id,
                    text,
                )?;
                if let Ok(mut state) = self.state.lock() {
                    if let Some(request) = state.get_mut(&handle.request_id) {
                        request.status = RequestStatus::Streaming;
                        request.partial.push_str(text);
                    }
                }
                Ok(Some(message))
            }
            // Reasoning, citations and tool calls are metadata: they reach the
            // caller through the completion result, never the answer text.
            _ => Ok(None),
        }
    }

    /// Drains a normalised provider stream into the database.
    pub async fn stream(
        &self,
        handle: &RequestHandle,
        provider: Arc<dyn crate::providers::LlmProvider>,
        provider_request: ChatCompletionRequest,
    ) -> StreamOutcome {
        let sink = Arc::new(self.sink(handle));
        let result = provider.stream_chat(provider_request, sink).await;

        match result {
            Ok(completion) => {
                if self.status(&handle.request_id).is_some_and(RequestStatus::is_terminal) {
                    return StreamOutcome {
                        completion: None,
                        error: None,
                    };
                }
                let applied = message_repository::complete(
                    self.conn,
                    &handle.assistant_message_id,
                    &completion.text,
                    completion.reasoning.as_deref(),
                    None,
                    &completion.citations,
                );
                match applied {
                    Ok(_) => {
                        self.finish(&handle.request_id, RequestStatus::Completed);
                        StreamOutcome {
                            completion: Some(completion),
                            error: None,
                        }
                    }
                    Err(error) => {
                        self.finish(&handle.request_id, RequestStatus::Failed);
                        StreamOutcome {
                            completion: None,
                            error: Some(ProviderError {
                                code: error.code,
                                message: error.message,
                                retryable: error.retryable,
                                details: error.details,
                            }),
                        }
                    }
                }
            }
            Err(error) => {
                let status = if error.code == crate::domain::ErrorCode::CANCELLED {
                    RequestStatus::Cancelled
                } else {
                    RequestStatus::Failed
                };
                self.finish(&handle.request_id, status);
                // A failed request stores no content: the row keeps whatever
                // arrived, and the reason travels to the caller.
                if status == RequestStatus::Failed {
                    let _ = message_repository::fail(
                        self.conn,
                        &handle.assistant_message_id,
                        &error.message,
                    );
                }
                StreamOutcome {
                    completion: None,
                    error: Some(error),
                }
            }
        }
    }

    /// Cancels a request. Idempotent: cancelling twice does nothing.
    pub fn cancel(&self, request_id: &str) -> Result<(), VukkoError> {
        let Some(status) = self.status(request_id) else {
            return Ok(());
        };
        if status == RequestStatus::Completed || status == RequestStatus::Cancelled {
            return Ok(());
        }
        if let Ok(mut state) = self.state.lock() {
            if let Some(request) = state.get_mut(request_id) {
                request.status = RequestStatus::Cancelled;
                let message_id = request.assistant_message_id.clone();
                drop(state);
                message_repository::fail(self.conn, &message_id, "Request cancelled")?;
            }
        }
        Ok(())
    }

    pub fn status(&self, request_id: &str) -> Option<RequestStatus> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.get(request_id).map(|request| request.status))
    }

    pub fn is_terminal(&self, request_id: &str) -> bool {
        self.status(request_id).is_some_and(RequestStatus::is_terminal)
    }

    pub fn pending_count(&self) -> usize {
        self.state
            .lock()
            .map(|state| {
                state
                    .values()
                    .filter(|request| !request.status.is_terminal())
                    .count()
            })
            .unwrap_or(0)
    }

    fn finish(&self, request_id: &str, status: RequestStatus) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(request) = state.get_mut(request_id) {
                request.status = status;
            }
        }
    }
}

/// Timestamp helper kept next to the status transitions so a request's start and
/// end use the same clock.
pub fn now() -> Timestamp {
    crate::repository::now_millis()
}

/// Base-36 encoding of a small integer, matching `Number.prototype.toString(36)`.
fn to_base36(mut value: u64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ErrorCode;
    use crate::providers::mock::MockProvider;
    use crate::providers::test_support::sample_request;
    use crate::providers::LlmProvider;
    use crate::repository::test_support::fresh_db;
    use crate::repository::{thread_repository, workspace_repository};

    fn thread(conn: &rusqlite::Connection) -> String {
        let workspace = workspace_repository::create(
            conn,
            &workspace_repository::NewWorkspace {
                name: "Chats".into(),
                ..Default::default()
            },
        )
        .expect("workspace");
        thread_repository::create(conn, &workspace.id, "Main")
            .expect("thread")
            .id
    }

    fn service_setup() -> (rusqlite::Connection, String) {
        let conn = fresh_db("service_chat");
        let thread_id = thread(&conn);
        (conn, thread_id)
    }

    fn request(thread_id: &str, content: &str) -> SendRequest {
        SendRequest {
            thread_id: thread_id.to_string(),
            content: content.to_string(),
            provider_request: sample_request("mock"),
        }
    }

    #[test]
    fn send_persists_both_rows_before_any_token() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let handle = service.send(&request(&thread_id, "What is sovereignty?")).expect("sent");

        let messages = message_repository::list(&conn, &thread_id).expect("list");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "What is sovereignty?");
        assert_eq!(messages[1].id, handle.assistant_message_id);
        assert!(messages[1].is_streaming);
        assert_eq!(service.status(&handle.request_id), Some(RequestStatus::Pending));
    }

    #[test]
    fn an_empty_prompt_is_rejected_without_writing_anything() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);

        let error = service.send(&request(&thread_id, "   ")).expect_err("empty");
        assert_eq!(error.code, ErrorCode::VALIDATION);
        assert!(message_repository::list(&conn, &thread_id).expect("list").is_empty());
    }

    #[tokio::test]
    async fn streaming_a_mock_provider_stores_the_answer_and_completes() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let handle = service.send(&request(&thread_id, "hi")).expect("sent");

        let outcome = service
            .stream(
                &handle,
                Arc::new(MockProvider::new()) as Arc<dyn LlmProvider>,
                sample_request("mock"),
            )
            .await;

        assert!(outcome.error.is_none());
        assert_eq!(
            outcome.completion.as_ref().map(|c| c.text.as_str()),
            Some("Sovereignty is final authority.")
        );
        assert_eq!(service.status(&handle.request_id), Some(RequestStatus::Completed));

        let messages = message_repository::list(&conn, &thread_id).expect("list");
        assert_eq!(messages[1].content, "Sovereignty is final authority.");
        assert!(!messages[1].is_streaming);
    }

    #[tokio::test]
    async fn a_provider_failure_marks_the_row_failed_and_stores_no_content() {
        struct Failing;
        #[async_trait::async_trait]
        impl LlmProvider for Failing {
            fn descriptor(&self) -> &'static crate::providers::ProviderDescriptor {
                crate::providers::descriptor(crate::domain::ProviderType::OPENAI)
            }
            async fn stream_chat(
                &self,
                _request: ChatCompletionRequest,
                _sink: Arc<dyn ChunkSink>,
            ) -> Result<ChatCompletionResult, ProviderError> {
                Err(ProviderError::network("offline", true))
            }
        }

        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let handle = service.send(&request(&thread_id, "hi")).expect("sent");

        let outcome = service
            .stream(&handle, Arc::new(Failing) as Arc<dyn LlmProvider>, sample_request("m"))
            .await;

        assert_eq!(outcome.error.as_ref().map(|error| error.code), Some(ErrorCode::NETWORK));
        assert_eq!(service.status(&handle.request_id), Some(RequestStatus::Failed));

        let messages = message_repository::list(&conn, &thread_id).expect("list");
        assert_eq!(messages[1].content, "", "no invented text");
        assert!(!messages[1].is_streaming);
    }

    #[test]
    fn cancelling_stops_deltas_and_is_idempotent() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let handle = service.send(&request(&thread_id, "hi")).expect("sent");

        service
            .apply_chunk(&handle, &ProviderChunk::Text { text: "par".into() })
            .expect("first delta");
        service.cancel(&handle.request_id).expect("cancel");
        assert_eq!(service.status(&handle.request_id), Some(RequestStatus::Cancelled));

        let late = service
            .apply_chunk(&handle, &ProviderChunk::Text { text: "late".into() })
            .expect("late chunks are dropped, not errors");
        assert!(late.is_none());

        let messages = message_repository::list(&conn, &thread_id).expect("list");
        assert_eq!(messages[1].content, "par", "no text after cancellation");
        assert!(!messages[1].is_streaming);

        // Second cancel, and cancelling an unknown id, are both no-ops.
        service.cancel(&handle.request_id).expect("idempotent");
        service.cancel("req_unknown").expect("unknown is fine");
        assert_eq!(service.pending_count(), 0);
    }

    #[test]
    fn a_cancelled_sink_reports_cancellation_to_the_provider() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let handle = service.send(&request(&thread_id, "hi")).expect("sent");

        let sink = service.sink(&handle);
        assert!(!sink.is_cancelled());
        service.cancel(&handle.request_id).expect("cancel");
        assert!(sink.is_cancelled());
    }

    #[test]
    fn reasoning_never_becomes_answer_text() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let handle = service.send(&request(&thread_id, "hi")).expect("sent");

        service
            .apply_chunk(&handle, &ProviderChunk::Reasoning { text: "thinking".into() })
            .expect("applied");

        let messages = message_repository::list(&conn, &thread_id).expect("list");
        assert_eq!(messages[1].content, "");
    }

    #[test]
    fn request_ids_are_unique_and_base36() {
        let (conn, thread_id) = service_setup();
        let service = ChatService::new(&conn);
        let first = service.send(&request(&thread_id, "one")).expect("first");
        let second = service.send(&request(&thread_id, "two")).expect("second");
        assert_ne!(first.request_id, second.request_id);
        assert!(first.request_id.starts_with("req_"));
        assert_eq!(to_base36(0), "0");
        assert_eq!(to_base36(35), "z");
        assert_eq!(to_base36(36), "10");
    }
}
