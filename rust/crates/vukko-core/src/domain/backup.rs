//! Backup contract.
//!
//! Mirror of `src/types/backup.ts`. `CLOUD_BUCKET` is carried for preference
//! compatibility but is not implemented: the Kotlin worker only logged a
//! simulated upload and returned success, which the replacement reports as
//! `UNSUPPORTED` instead of faking (MIGRATION_PLAN.md §8 Step 5.3).

use serde::{Deserialize, Serialize};

use super::chat::Timestamp;

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackupTarget {
// The variants are already upper case, and `rename_all` would re-case the
// *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
// every persisted value. An explicit rename is a no-op for Rust and a contract
// for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "GITHUB")]
    GITHUB,
    #[serde(rename = "CLOUD_BUCKET")]
    CLOUD_BUCKET,
}

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackupTrigger {
// The variants are already upper case, and `rename_all` would re-case the
// *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
// every persisted value. An explicit rename is a no-op for Rust and a contract
// for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "SCHEDULED")]
    SCHEDULED,
    #[serde(rename = "MANUAL")]
    MANUAL,
}

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackupStatus {
// The variants are already upper case, and `rename_all` would re-case the
// *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
// every persisted value. An explicit rename is a no-op for Rust and a contract
// for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "COMPLETED")]
    COMPLETED,
    #[serde(rename = "FAILED")]
    FAILED,
    #[serde(rename = "UNSUPPORTED")]
    UNSUPPORTED,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    pub enabled: bool,
    pub frequency_hours: u32,
    pub target: BackupTarget,
    /// "owner/repo" for GitHub backups; empty when unconfigured.
    pub repository: String,
    pub cloud_bucket: String,
    pub last_backup_timestamp: Timestamp,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency_hours: 24,
            target: BackupTarget::GITHUB,
            repository: String::new(),
            cloud_bucket: String::new(),
            last_backup_timestamp: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub status: BackupStatus,
    pub file_name: Option<String>,
    pub workspace_count: u32,
    /// SHA-256 of the serialised archive.
    pub checksum: Option<String>,
    pub completed_at: Timestamp,
    pub reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_kotlin_preferences() {
        let settings = BackupSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.frequency_hours, 24);
        assert_eq!(settings.target, BackupTarget::GITHUB);
        assert_eq!(settings.last_backup_timestamp, 0);
    }

    #[test]
    fn cloud_bucket_is_representable_but_not_implemented() {
        let json = serde_json::to_string(&BackupTarget::CLOUD_BUCKET).unwrap();
        assert_eq!(json, "\"CLOUD_BUCKET\"");
    }
}
