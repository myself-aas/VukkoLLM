//! The FFI surface between the Rust core and the React Native TurboModule.
//!
//! Design rules (MIGRATION_PLAN.md §2.2):
//! - operations are domain-oriented: no table names, no SQL, no vendor wire
//!   formats cross this boundary;
//! - everything is `&self` on a shared [`Engine`], so JS can await concurrently;
//! - the only stateful thing is the engine handle, which owns the connection and
//!   the event subscribers;
//! - a failure is a rejected promise carrying the `VukkoError` JSON shape; a
//!   success is never faked.
//!
//! Event plumbing: Rust emits [`NativeEvent`] values into a single mpsc channel.
//! The JNI layer pulls from it and forwards to every registered JS listener, so
//! ordering is preserved and a slow listener cannot block a write.

#![deny(clippy::unwrap_used)]
#![warn(clippy::pedantic)]

pub mod error;
pub mod events;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::Connection;
use serde::Serialize;
use vukko_core::domain::{
    ChatMessage, DocumentItem, DocumentType, IntegrityCheckResult, SovereignStorageStats,
    VukkoError, Workspace, WorkspaceThread,
};
use vukko_core::repository::{
    document_repository, message_repository, settings_repository, storage_repository,
    thread_repository, workspace_repository,
};
use vukko_core::services::{bootstrap, export};
use vukko_db::AdoptionReport;

pub use error::BridgeError;
pub use events::{EventSink, NativeEvent};

/// What the host learns after startup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializationState {
    pub schema_ownership: String,
    pub database_name: String,
    pub migrations_applied: usize,
    pub migrated_from_legacy: bool,
    pub workspace_count: u32,
    pub seeded: bool,
    pub warnings: Vec<String>,
}

/// The one object the native module holds.
pub struct Engine {
    conn: Mutex<Connection>,
    path: PathBuf,
    adoption: AdoptionReport,
    events: EventSink,
}

impl Engine {
    /// Opens (and upgrades) the database, then seeds a fresh install.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, BridgeError> {
        let path = path.as_ref().to_path_buf();
        let (mut conn, adoption) = vukko_db::adopt(&path)?;
        let seeded = bootstrap::seed_if_empty(&mut conn).map_err(BridgeError::from)?;

        Ok(Self {
            conn: Mutex::new(conn),
            path,
            adoption,
            events: EventSink::new(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn with_conn<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, VukkoError>,
    ) -> Result<T, BridgeError> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| BridgeError::from(VukkoError::storage("storage lock poisoned")))?;
        operation(&guard).map_err(BridgeError::from)
    }

    pub fn initialize(&self) -> Result<InitializationState, BridgeError> {
        let workspace_count = self.with_conn(|conn| workspace_repository::list(conn))?.len() as u32;
        Ok(InitializationState {
            schema_ownership: if self.adoption.to_version > 0 {
                "RUST".to_string()
            } else {
                "NONE".to_string()
            },
            database_name: vukko_core::domain::DATABASE_NAME.to_string(),
            migrations_applied: self.adoption.migrations_applied,
            migrated_from_legacy: self.adoption.migrated_from_legacy,
            workspace_count,
            seeded: self.adoption.from_version == 0,
            warnings: self.adoption.warnings.clone(),
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, BridgeError> {
        self.with_conn(|conn| workspace_repository::list(conn))
    }

    pub fn create_workspace(&self, name: &str) -> Result<Workspace, BridgeError> {
        let workspace = self.with_conn(|conn| {
            workspace_repository::create(
                conn,
                &workspace_repository::NewWorkspace {
                    name: name.to_string(),
                    ..Default::default()
                },
            )
        })?;
        self.events
            .emit(NativeEvent::WorkspaceUpdated(workspace.clone()));
        Ok(workspace)
    }

    pub fn update_workspace(&self, workspace: &Workspace) -> Result<Workspace, BridgeError> {
        let updated = self.with_conn(|conn| workspace_repository::update(conn, workspace))?;
        self.events
            .emit(NativeEvent::WorkspaceUpdated(updated.clone()));
        Ok(updated)
    }

    pub fn delete_workspace(&self, id: &str) -> Result<(), BridgeError> {
        self.with_conn(|conn| workspace_repository::delete(conn, id))
    }

    pub fn list_threads(&self, workspace_id: &str) -> Result<Vec<WorkspaceThread>, BridgeError> {
        self.with_conn(|conn| thread_repository::list(conn, workspace_id))
    }

    pub fn create_thread(
        &self,
        workspace_id: &str,
        name: &str,
    ) -> Result<WorkspaceThread, BridgeError> {
        let thread = self
            .with_conn(|conn| thread_repository::create(conn, workspace_id, name))?;
        self.events.emit(NativeEvent::ThreadUpdated(thread.clone()));
        Ok(thread)
    }

    pub fn rename_thread(&self, id: &str, name: &str) -> Result<WorkspaceThread, BridgeError> {
        let thread = self.with_conn(|conn| thread_repository::rename(conn, id, name))?;
        self.events.emit(NativeEvent::ThreadUpdated(thread.clone()));
        Ok(thread)
    }

    pub fn delete_thread(&self, id: &str) -> Result<(), BridgeError> {
        self.with_conn(|conn| thread_repository::delete(conn, id))
    }

    pub fn set_thread_pinned(&self, id: &str, is_pinned: bool) -> Result<(), BridgeError> {
        let thread = self.with_conn(|conn| thread_repository::set_pinned(conn, id, is_pinned))?;
        self.events.emit(NativeEvent::ThreadUpdated(thread));
        Ok(())
    }

    pub fn list_messages(&self, thread_id: &str) -> Result<Vec<ChatMessage>, BridgeError> {
        self.with_conn(|conn| message_repository::list(conn, thread_id))
    }

    pub fn list_documents(&self, workspace_id: &str) -> Result<Vec<DocumentItem>, BridgeError> {
        self.with_conn(|conn| document_repository::list(conn, workspace_id))
    }

    pub fn append_user_message(
        &self,
        thread_id: &str,
        content: &str,
    ) -> Result<ChatMessage, BridgeError> {
        let message = self.with_conn(|conn| {
            message_repository::append_user_turn(conn, thread_id, content, None)
        })?;
        self.events
            .emit(NativeEvent::MessageCreated(message.clone()));
        Ok(message)
    }

    pub fn delete_message(&self, id: &str) -> Result<(), BridgeError> {
        self.with_conn(|conn| message_repository::delete(conn, id))
    }

    pub fn set_message_favorite(&self, id: &str, is_favorite: bool) -> Result<(), BridgeError> {
        let message = self.with_conn(|conn| message_repository::set_favorite(conn, id, is_favorite))?;
        self.events.emit(NativeEvent::MessageUpdated(message));
        Ok(())
    }

    pub fn set_message_tags(&self, id: &str, tags: &[String]) -> Result<(), BridgeError> {
        let message = self.with_conn(|conn| message_repository::set_tags(conn, id, tags))?;
        self.events.emit(NativeEvent::MessageUpdated(message));
        Ok(())
    }

    /// Appends a streamed delta and announces it.
    ///
    /// A delta for a message that is no longer streaming is `CANCELLED`, not an
    /// error to retry: the generation was cancelled or completed.
    pub fn append_stream_delta(
        &self,
        request_id: &str,
        message_id: &str,
        delta: &str,
    ) -> Result<(), BridgeError> {
        self.with_conn(|conn| message_repository::append_delta(conn, message_id, delta))?;
        self.events.emit(NativeEvent::MessageDelta {
            request_id: request_id.to_string(),
            message_id: message_id.to_string(),
            delta: delta.to_string(),
        });
        Ok(())
    }

    pub fn export_thread(
        &self,
        thread_id: &str,
        format: &str,
        now: i64,
    ) -> Result<export::ExportResult, BridgeError> {
        let format = export::ExportFormat::parse(format).map_err(BridgeError::from)?;
        self.with_conn(|conn| export::export_thread(conn, thread_id, format, now))
    }

    pub fn storage_stats(&self) -> Result<SovereignStorageStats, BridgeError> {
        self.with_conn(|conn| storage_repository::stats(conn))
    }

    pub fn run_integrity_check(&self) -> Result<IntegrityCheckResult, BridgeError> {
        let backup_present = self.adoption.backup_retained;
        self.with_conn(|conn| storage_repository::run_integrity_check(conn, backup_present))
    }

    pub fn settings(&self) -> Result<settings_repository::AppSettings, BridgeError> {
        self.with_conn(|conn| settings_repository::get_all(conn))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), BridgeError> {
        self.with_conn(|conn| settings_repository::set(conn, key, value))
    }

    pub fn create_document(
        &self,
        workspace_id: &str,
        name: &str,
        document_type: DocumentType,
        content: &str,
    ) -> Result<DocumentItem, BridgeError> {
        let document = self.with_conn(|conn| {
            document_repository::create(
                conn,
                &document_repository::NewDocument {
                    workspace_id: workspace_id.to_string(),
                    name: name.to_string(),
                    document_type,
                    content: content.to_string(),
                },
            )
        })?;
        if let Ok(workspace) = self.with_conn(|conn| workspace_repository::get(conn, workspace_id)) {
            self.events.emit(NativeEvent::WorkspaceUpdated(workspace));
        }
        Ok(document)
    }

    pub fn drain_events(&self) -> Vec<NativeEvent> {
        self.events.drain()
    }
}

/// Process-wide engine handle. The TurboModule calls these functions with plain
/// arguments, so the JNI glue stays trivial and testable.
static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();

/// Opens the engine once. Calling it again returns the existing engine, which is
/// what a JS reload expects.
pub fn initialize(path: impl AsRef<Path>) -> Result<Arc<Engine>, BridgeError> {
    if let Some(engine) = ENGINE.get() {
        return Ok(engine.clone());
    }
    let engine = Arc::new(Engine::open(path)?);
    let _ = ENGINE.set(engine.clone());
    Ok(engine)
}

pub fn engine() -> Option<Arc<Engine>> {
    ENGINE.get().cloned()
}

/// Releases the engine (test and shutdown hook).
pub fn shutdown() {
    // `OnceLock` cannot be reset; process teardown drops it. Exposed so the host
    // has an explicit call to make, and so tests can assert the contract.
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "vukko-bridge-{}-{}-{}.db",
            name,
            std::process::id(),
            vukko_core::repository::now_millis()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn opening_a_fresh_database_seeds_it_and_reports_state() {
        let path = temp_path("fresh");
        let engine = Engine::open(&path).expect("open");
        let state = engine.initialize().expect("initialize");

        assert_eq!(state.database_name, "vukko_sovereign.db");
        assert_eq!(state.workspace_count, 4);
        assert!(state.seeded);
        assert_eq!(state.schema_ownership, "RUST");
        assert!(!state.migrated_from_legacy);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_legacy_database_is_adopted_and_its_state_reported() {
        let path = temp_path("legacy");
        {
            let conn = Connection::open(&path).expect("legacy open");
            conn.execute_batch(vukko_db::migrate::MIGRATIONS[0].sql)
                .expect("legacy schema");
            conn.pragma_update(None, "user_version", 1).expect("version");
        }

        let engine = Engine::open(&path).expect("open");
        let state = engine.initialize().expect("initialize");
        assert!(state.migrated_from_legacy);
        assert!(state.migrations_applied > 0);
        // A legacy database with no workspaces is seeded only after adoption.
        assert_eq!(state.workspace_count, 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn workspace_and_message_round_trip_emit_events() {
        let path = temp_path("roundtrip");
        let engine = Engine::open(&path).expect("open");

        let workspace = engine.create_workspace("Bridge").expect("workspace");
        let thread = engine.create_thread(&workspace.id, "Chat").expect("thread");
        let message = engine.append_user_message(&thread.id, "hi").expect("message");

        assert_eq!(message.sender, vukko_core::domain::MessageSender::USER);
        assert_eq!(engine.list_messages(&thread.id).unwrap().len(), 1);

        let events = engine.drain_events();
        assert!(events
            .iter()
            .any(|event| matches!(event, NativeEvent::WorkspaceUpdated(_))));
        assert!(events
            .iter()
            .any(|event| matches!(event, NativeEvent::ThreadUpdated(_))));
        assert!(events
            .iter()
            .any(|event| matches!(event, NativeEvent::MessageCreated(_))));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_late_stream_delta_is_cancelled() {
        let path = temp_path("delta");
        let engine = Engine::open(&path).expect("open");
        let workspace = engine.create_workspace("Stream").expect("workspace");
        let thread = engine.create_thread(&workspace.id, "Chat").expect("thread");
        let message = engine.append_user_message(&thread.id, "hello").expect("message");

        // The fixture message is not streaming, so a delta must be refused.
        let error = engine
            .append_stream_delta("req_1", &message.id, "chunk")
            .unwrap_err();
        assert_eq!(error.code, vukko_core::domain::ErrorCode::CANCELLED);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_and_stats_pass_through() {
        let path = temp_path("export");
        let engine = Engine::open(&path).expect("open");
        let workspace = engine.create_workspace("Exports").expect("workspace");
        let thread = engine.create_thread(&workspace.id, "Chat").expect("thread");
        engine.append_user_message(&thread.id, "hello").expect("message");

        let result = engine
            .export_thread(&thread.id, "markdown", 1_700_000_000_000)
            .expect("export");
        assert_eq!(result.message_count, 1);
        assert!(result.content.contains("### USER"));

        let stats = engine.storage_stats().expect("stats");
        assert_eq!(stats.database_name, "vukko_sovereign.db");
        assert!(engine.run_integrity_check().expect("integrity").ok);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn secrets_cannot_be_written_through_the_settings_bridge() {
        let path = temp_path("secrets");
        let engine = Engine::open(&path).expect("open");
        let error = engine.set_setting("githubToken", "ghp_secret").unwrap_err();
        assert_eq!(error.code, vukko_core::domain::ErrorCode::VALIDATION);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_corrupt_database_is_refused_at_open() {
        let path = temp_path("corrupt");
        std::fs::write(&path, vec![0xeeu8; 4096]).expect("write garbage");
        let error = Engine::open(&path).unwrap_err();
        assert_eq!(error.code, vukko_core::domain::ErrorCode::STORAGE);
        let _ = std::fs::remove_file(&path);
    }
}
