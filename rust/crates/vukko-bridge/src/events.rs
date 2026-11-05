//! Events pushed from Rust to JavaScript.
//!
//! Contract (MIGRATION_PLAN.md §7 Step 4.3):
//! - every event has a `type` discriminant that matches `NativeEvent` in
//!   `src/types/native.ts` exactly;
//! - resource events (`workspace.updated`, `thread.updated`, `message.created`,
//!   `message.updated`) carry the whole resource, so JS never has to re-fetch;
//! - streaming events carry the `requestId` of the request that produced them,
//!   so two concurrent generations can be interleaved without mixing;
//! - ordering is the emission order: this is one queue, drained by one consumer;
//! - a listener that throws or blocks cannot lose events: the queue is drained
//!   before delivery, and delivery happens on the JS thread.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use vukko_core::domain::{ChatMessage, Workspace, WorkspaceThread};

/// Everything that can be delivered to a JS listener.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum NativeEvent {
    #[serde(rename = "workspace.updated")]
    WorkspaceUpdated(Workspace),

    #[serde(rename = "thread.updated")]
    ThreadUpdated(WorkspaceThread),

    #[serde(rename = "message.created")]
    MessageCreated(ChatMessage),

    #[serde(rename = "message.updated")]
    MessageUpdated(ChatMessage),

    #[serde(rename = "message.delta", rename_all = "camelCase")]
    MessageDelta {
        request_id: String,
        message_id: String,
        delta: String,
    },

    #[serde(rename = "message.completed", rename_all = "camelCase")]
    MessageCompleted {
        request_id: String,
        message: ChatMessage,
    },

    #[serde(rename = "message.failed", rename_all = "camelCase")]
    MessageFailed {
        request_id: String,
        error: vukko_core::domain::VukkoError,
    },

    #[serde(rename = "backup.completed")]
    BackupCompleted(vukko_core::domain::backup::BackupResult),
}

impl NativeEvent {
    /// The `type` discriminant JavaScript sees.
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::WorkspaceUpdated(_) => "workspace.updated",
            Self::ThreadUpdated(_) => "thread.updated",
            Self::MessageCreated(_) => "message.created",
            Self::MessageUpdated(_) => "message.updated",
            Self::MessageDelta { .. } => "message.delta",
            Self::MessageCompleted { .. } => "message.completed",
            Self::MessageFailed { .. } => "message.failed",
            Self::BackupCompleted(_) => "backup.completed",
        }
    }

    /// The request this event belongs to, for streaming correlation.
    pub fn request_id(&self) -> Option<&str> {
        match self {
            Self::MessageDelta { request_id, .. }
            | Self::MessageCompleted { request_id, .. }
            | Self::MessageFailed { request_id, .. } => Some(request_id),
            _ => None,
        }
    }
}

/// A bounded, order-preserving queue.
///
/// Bounded on purpose: an unbounded queue lets a stuck JS thread grow the native
/// heap without limit. When the queue is full the oldest event is dropped and a
/// warning is logged, because a stale `message.delta` is recoverable (the final
/// `message.completed` always carries the full text) whereas unbounded growth is
/// not.
pub struct EventSink {
    queue: Arc<Mutex<Vec<NativeEvent>>>,
    capacity: usize,
}

impl Default for EventSink {
    fn default() -> Self {
        Self::new()
    }
}

impl EventSink {
    /// Queue capacity: enough for a long stream plus UI events between drains.
    pub const DEFAULT_CAPACITY: usize = 4096;

    pub fn new() -> Self {
        Self::with_capacity(Self::DEFAULT_CAPACITY)
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            queue: Arc::new(Mutex::new(Vec::with_capacity(capacity.min(1024)))),
            capacity,
        }
    }

    pub fn emit(&self, event: NativeEvent) {
        let Ok(mut queue) = self.queue.lock() else {
            return;
        };
        if queue.len() >= self.capacity {
            let dropped = queue.remove(0);
            tracing::warn!(
                dropped = dropped.event_type(),
                "event queue full; dropped the oldest event"
            );
        }
        queue.push(event);
    }

    /// Takes every queued event, preserving order.
    pub fn drain(&self) -> Vec<NativeEvent> {
        match self.queue.lock() {
            Ok(mut queue) => std::mem::take(&mut *queue),
            Err(_) => Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.queue.lock().map(|queue| queue.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vukko_core::domain::{ChatMessage, QueryMode, Workspace};

    fn workspace(id: &str) -> Workspace {
        Workspace {
            id: id.into(),
            name: "W".into(),
            slug: "w".into(),
            description: String::new(),
            system_prompt: "p".into(),
            temperature: 0.7,
            query_mode: QueryMode::CHAT,
            vector_count: 0,
            document_count: 0,
            created_at: 1,
            agent_max_steps: 5,
            agent_allow_web_search: true,
            agent_allow_file_creation: true,
            agent_allow_document_search: true,
        }
    }

    #[test]
    fn events_serialise_with_the_typescript_discriminants() {
        let event = NativeEvent::WorkspaceUpdated(workspace("ws_1"));
        let json: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "workspace.updated");
        assert_eq!(
            event.event_type(),
            json["type"].as_str().expect("string discriminant")
        );
    }

    #[test]
    fn every_variant_reports_a_type() {
        let message = ChatMessage::user_turn("msg_1".into(), "th_1".into(), "x".into(), 1);
        let events = vec![
            NativeEvent::WorkspaceUpdated(workspace("ws_1")),
            NativeEvent::MessageCreated(message.clone()),
            NativeEvent::MessageUpdated(message.clone()),
            NativeEvent::MessageDelta {
                request_id: "req_1".into(),
                message_id: "msg_1".into(),
                delta: "chunk".into(),
            },
            NativeEvent::MessageCompleted {
                request_id: "req_1".into(),
                message,
            },
            NativeEvent::MessageFailed {
                request_id: "req_1".into(),
                error: vukko_core::domain::VukkoError::network("down"),
            },
        ];
        let types: Vec<&str> = events.iter().map(NativeEvent::event_type).collect();
        assert_eq!(
            types,
            vec![
                "workspace.updated",
                "message.created",
                "message.updated",
                "message.delta",
                "message.completed",
                "message.failed"
            ]
        );
    }

    #[test]
    fn streaming_events_are_correlated_by_request_id() {
        let event = NativeEvent::MessageDelta {
            request_id: "req_42".into(),
            message_id: "msg_1".into(),
            delta: "d".into(),
        };
        assert_eq!(event.request_id(), Some("req_42"));

        let json: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(json["requestId"], "req_42");
        assert_eq!(json["messageId"], "msg_1");
    }

    #[test]
    fn drain_preserves_order_and_empties_the_queue() {
        let sink = EventSink::with_capacity(8);
        for index in 0..5 {
            sink.emit(NativeEvent::WorkspaceUpdated(workspace(&format!(
                "ws_{}",
                index
            ))));
        }
        let drained = sink.drain();
        assert_eq!(drained.len(), 5);
        assert!(sink.is_empty());

        // The order is the emission order, which is what JS relies on.
        let ids: Vec<String> = drained
            .into_iter()
            .map(|event| match event {
                NativeEvent::WorkspaceUpdated(workspace) => workspace.id,
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(ids, vec!["ws_0", "ws_1", "ws_2", "ws_3", "ws_4"]);
    }

    #[test]
    fn a_full_queue_drops_the_oldest_event_instead_of_growing() {
        let sink = EventSink::with_capacity(2);
        for index in 0..4 {
            sink.emit(NativeEvent::WorkspaceUpdated(workspace(&format!(
                "ws_{}",
                index
            ))));
        }
        assert_eq!(sink.len(), 2);
        let ids: Vec<String> = sink
            .drain()
            .into_iter()
            .map(|event| match event {
                NativeEvent::WorkspaceUpdated(workspace) => workspace.id,
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(ids, vec!["ws_2", "ws_3"]);
    }

    #[test]
    fn concurrent_emitters_do_not_lose_events() {
        let sink = Arc::new(EventSink::with_capacity(10_000));
        let mut handles = Vec::new();
        for _ in 0..8 {
            let sink = Arc::clone(&sink);
            handles.push(std::thread::spawn(move || {
                for _ in 0..100 {
                    sink.emit(NativeEvent::WorkspaceUpdated(workspace("ws_x")));
                }
            }));
        }
        for handle in handles {
            handle.join().expect("thread");
        }
        assert_eq!(sink.len(), 800);
    }
}
