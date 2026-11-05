//! Storage and integrity contract.
//!
//! Mirror of `src/types/storage.ts` and `SovereignStorageStats.kt`.

use serde::{Deserialize, Serialize};

use super::chat::Timestamp;

/// Name of the database the Kotlin application wrote. The Rust layer adopts the
/// same file in place; it is part of the upgrade contract.
pub const DATABASE_NAME: &str = "vukko_sovereign.db";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SovereignStorageStats {
    pub database_name: String,
    pub total_workspaces: u32,
    pub total_threads: u32,
    pub total_messages: u32,
    pub total_documents: u32,
    pub is_local_encrypted: bool,
    pub storage_type: String,
    pub data_sovereignty_status: String,
}

impl SovereignStorageStats {
    /// Empty stats for a fresh install, in the shape the inspector renders.
    pub fn empty() -> Self {
        Self {
            database_name: DATABASE_NAME.to_string(),
            total_workspaces: 0,
            total_threads: 0,
            total_messages: 0,
            total_documents: 0,
            is_local_encrypted: true,
            storage_type: "Rust SQLite (Local Device Only)".to_string(),
            data_sovereignty_status: "Air-Gapped Sovereign Storage".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCount {
    pub table: String,
    pub rows: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityCheckResult {
    pub ok: bool,
    pub integrity_check: String,
    pub foreign_key_violations: u32,
    pub backup_present: bool,
    pub table_counts: Vec<TableCount>,
    pub checked_at: Timestamp,
}

/// Who owns the on-disk schema right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaOwnership {
    NONE,
    LEGACY_ROOM,
    RUST,
    MIGRATING,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_name_is_part_of_the_contract() {
        assert_eq!(DATABASE_NAME, "vukko_sovereign.db");
        assert_eq!(SovereignStorageStats::empty().database_name, DATABASE_NAME);
    }

    #[test]
    fn ownership_uses_kotlin_style_wire_names() {
        assert_eq!(
            serde_json::to_string(&SchemaOwnership::LEGACY_ROOM).unwrap(),
            "\"LEGACY_ROOM\""
        );
    }
}
