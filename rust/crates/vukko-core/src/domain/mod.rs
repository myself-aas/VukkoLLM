//! Domain contracts shared by the repository, services, providers and the bridge.
//!
//! Each module mirrors the TypeScript declarations in `src/types/*.ts`
//! field-for-field; `tests/contracts/parity.test.js` fails when they drift.

pub mod agent;
pub mod chat;
pub mod document;
pub mod error;
pub mod github;
pub mod provider;
pub mod storage;
pub mod workspace;

pub use chat::{
    AgentStep, AgentStepStatus, ChatMessage, Citation, MessageAttachment, MessageSender, Timestamp,
    ToolCall,
};
pub use document::{default_quick_actions, DocumentItem, DocumentType, QuickActionItem};
pub use error::{ErrorCode, VukkoError};
pub use github::{
    GitHubAuthStatus, GitHubBranch, GitHubCommit, GitHubDeviceCode, GitHubPullRequest,
    GitHubRepository, GitHubUserProfile, PRState,
};
pub use provider::{
    default_models, find_model, models_for, LLMModel, ProviderConfig, ProviderType,
};
pub use storage::{
    IntegrityCheckResult, SchemaOwnership, SovereignStorageStats, TableCount, DATABASE_NAME,
};
pub use workspace::{slugify, QueryMode, Workspace, WorkspaceThread, DEFAULT_SYSTEM_PROMPT};
