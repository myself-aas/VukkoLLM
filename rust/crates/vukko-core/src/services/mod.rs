//! Use cases composed from repositories.
//!
//! `DataRepository.kt` was one 869-line class mixing seeding, chat simulation,
//! exports, storage stats and stats refresh. It is split here by responsibility,
//! one module per service, so each can be tested and replaced independently
//! (MIGRATION_PLAN.md §7 Step 4.1).

pub mod backup;
pub mod bootstrap;
pub mod export;
pub mod github;
pub mod storage;

/// Files and document imports (Step 7.3).
pub mod files;
