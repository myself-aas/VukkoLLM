//! Application settings.
//!
//! Settings live in `app_settings` (migration 0005) under the same key names the
//! Kotlin app used in SharedPreferences, so an upgrade copies them verbatim and
//! a downgrade still finds values it understands.
//!
//! Secrets are deliberately not part of this repository: provider keys live in
//! the OS keystore, referenced by `provider_secrets.vaultKey`. A key that looks
//! like a credential is rejected with `VALIDATION` instead of being stored.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::domain::{ProviderType, VukkoError};
use crate::repository::{now_millis, require_range};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingKind {
    Text,
    Boolean,
    Integer { min: i64, max: i64 },
    Provider,
    BackupTarget,
}

#[derive(Debug, Clone)]
pub struct SettingSpec {
    pub key: &'static str,
    pub column: &'static str,
    pub kind: SettingKind,
    pub default: &'static str,
}

/// The settings the app owns, with the Kotlin preference names they came from.
pub const SETTINGS: &[SettingSpec] = &[
    SettingSpec {
        key: "activeWorkspaceId",
        column: "active_workspace_id",
        kind: SettingKind::Text,
        default: "ws_default",
    },
    SettingSpec {
        key: "activeThreadId",
        column: "active_thread_id",
        kind: SettingKind::Text,
        default: "th_default",
    },
    SettingSpec {
        key: "selectedProvider",
        column: "selected_provider",
        kind: SettingKind::Provider,
        default: "GEMINI",
    },
    SettingSpec {
        key: "selectedModelId",
        column: "selected_model_id",
        kind: SettingKind::Text,
        default: "gemini-2.5-flash",
    },
    SettingSpec {
        key: "instanceUrl",
        column: "instance_url",
        kind: SettingKind::Text,
        default: "http://10.0.2.2:3001",
    },
    SettingSpec {
        key: "webSearchEnabled",
        column: "tool_web_search",
        kind: SettingKind::Boolean,
        default: "true",
    },
    SettingSpec {
        key: "autoApproveTools",
        column: "tool_auto_approve",
        kind: SettingKind::Boolean,
        default: "true",
    },
    SettingSpec {
        key: "biometricLockEnabled",
        column: "biometric_lock_enabled",
        kind: SettingKind::Boolean,
        default: "false",
    },
    SettingSpec {
        key: "backupEnabled",
        column: "backup_enabled",
        kind: SettingKind::Boolean,
        default: "false",
    },
    SettingSpec {
        key: "backupFrequencyHours",
        column: "backup_frequency",
        kind: SettingKind::Integer { min: 1, max: 168 },
        default: "24",
    },
    SettingSpec {
        key: "backupTarget",
        column: "backup_target",
        kind: SettingKind::BackupTarget,
        default: "GITHUB",
    },
];

/// A typed settings snapshot, serialised to the shape `src/types` declares.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub active_workspace_id: String,
    pub active_thread_id: String,
    pub selected_provider: ProviderType,
    pub selected_model_id: String,
    pub instance_url: String,
    pub web_search_enabled: bool,
    pub auto_approve_tools: bool,
    pub biometric_lock_enabled: bool,
    pub backup_enabled: bool,
    pub backup_frequency_hours: u32,
    pub backup_target: crate::domain::backup::BackupTarget,
}

fn spec_for(key: &str) -> Result<&'static SettingSpec, VukkoError> {
    SETTINGS
        .iter()
        .find(|spec| spec.key == key)
        .ok_or_else(|| VukkoError::validation(format!("unknown setting: {}", key)))
}

fn looks_secret(key: &str) -> bool {
    let lowered = key.to_ascii_lowercase();
    ["key", "token", "secret", "password", "credential"]
        .iter()
        .any(|needle| lowered.contains(needle))
}

/// Reads every setting, applying defaults for missing rows.
pub fn get_all(conn: &Connection) -> Result<AppSettings, VukkoError> {
    let mut stored: BTreeMap<String, String> = BTreeMap::new();
    {
        let mut statement = conn.prepare("SELECT key, value FROM app_settings")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            stored.insert(key, value);
        }
    }

    let read = |key: &'static str| -> String {
        let spec = SETTINGS
            .iter()
            .find(|spec| spec.key == key)
            .expect("settings table is static");
        stored
            .get(spec.column)
            .cloned()
            .unwrap_or_else(|| spec.default.to_string())
    };

    let provider_wire = read("selectedProvider");
    let provider = ProviderType::all()
        .iter()
        .copied()
        .find(|candidate| candidate.preference_suffix() == provider_wire)
        .unwrap_or(ProviderType::GEMINI);

    let backup_target = if read("backupTarget") == "CLOUD_BUCKET" {
        crate::domain::backup::BackupTarget::CLOUD_BUCKET
    } else {
        crate::domain::backup::BackupTarget::GITHUB
    };

    Ok(AppSettings {
        active_workspace_id: read("activeWorkspaceId"),
        active_thread_id: read("activeThreadId"),
        selected_provider: provider,
        selected_model_id: read("selectedModelId"),
        instance_url: read("instanceUrl"),
        web_search_enabled: read("webSearchEnabled") == "true",
        auto_approve_tools: read("autoApproveTools") == "true",
        biometric_lock_enabled: read("biometricLockEnabled") == "true",
        backup_enabled: read("backupEnabled") == "true",
        backup_frequency_hours: read("backupFrequencyHours").parse().unwrap_or(24),
        backup_target,
    })
}

/// Writes one setting, validating the value against its declared type.
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), VukkoError> {
    if looks_secret(key) {
        return Err(VukkoError::validation(format!(
            "{} looks like a credential; secrets belong in secure storage",
            key
        )));
    }
    let spec = spec_for(key)?;

    match spec.kind {
        SettingKind::Boolean => {
            if value != "true" && value != "false" {
                return Err(VukkoError::validation(format!(
                    "{} must be true or false",
                    key
                )));
            }
        }
        SettingKind::Integer { min, max } => {
            let parsed: i64 = value
                .parse()
                .map_err(|_| VukkoError::validation(format!("{} must be a number", key)))?;
            require_range(parsed as f32, key, min as f32, max as f32)?;
        }
        SettingKind::Provider => {
            if !ProviderType::all()
                .iter()
                .any(|provider| provider.preference_suffix() == value)
            {
                return Err(VukkoError::validation(format!(
                    "unknown provider: {}",
                    value
                )));
            }
        }
        SettingKind::BackupTarget => {
            if value != "GITHUB" && value != "CLOUD_BUCKET" {
                return Err(VukkoError::validation(format!(
                    "{} must be GITHUB or CLOUD_BUCKET",
                    key
                )));
            }
        }
        SettingKind::Text => {
            if value.len() > 2048 {
                return Err(VukkoError::validation(format!("{} is too long", key)));
            }
        }
    }

    conn.execute(
        "INSERT INTO app_settings (key, value, updatedAt) VALUES (?1, ?2, ?3) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
        params![spec.column, value, now_millis()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::test_support::fresh_db;

    #[test]
    fn defaults_match_the_kotlin_preferences() {
        let conn = fresh_db("settings_defaults");
        let settings = get_all(&conn).unwrap();

        assert_eq!(settings.active_workspace_id, "ws_default");
        assert_eq!(settings.active_thread_id, "th_default");
        assert_eq!(settings.selected_provider, ProviderType::GEMINI);
        assert_eq!(settings.selected_model_id, "gemini-2.5-flash");
        assert!(settings.web_search_enabled);
        assert!(!settings.biometric_lock_enabled);
        assert_eq!(settings.backup_frequency_hours, 24);
        assert_eq!(
            settings.backup_target,
            crate::domain::backup::BackupTarget::GITHUB
        );
    }

    #[test]
    fn writes_round_trip() {
        let conn = fresh_db("settings_write");
        set(&conn, "selectedProvider", "OLLAMA").unwrap();
        set(&conn, "backupFrequencyHours", "6").unwrap();
        set(&conn, "biometricLockEnabled", "true").unwrap();

        let settings = get_all(&conn).unwrap();
        assert_eq!(settings.selected_provider, ProviderType::OLLAMA);
        assert_eq!(settings.backup_frequency_hours, 6);
        assert!(settings.biometric_lock_enabled);
    }

    #[test]
    fn unknown_keys_and_bad_values_are_validation_errors() {
        let conn = fresh_db("settings_invalid");
        for (key, value) in [
            ("dropTables", "yes"),
            ("selectedProvider", "NOT_A_PROVIDER"),
            ("backupFrequencyHours", "sometimes"),
            ("backupFrequencyHours", "0"),
            ("webSearchEnabled", "maybe"),
        ] {
            assert_eq!(
                set(&conn, key, value).unwrap_err().code,
                crate::domain::ErrorCode::VALIDATION,
                "{}={} should be rejected",
                key,
                value
            );
        }
    }

    #[test]
    fn secret_shaped_keys_are_refused() {
        let conn = fresh_db("settings_secret");
        for key in ["githubToken", "apiKey", "instance_api_key", "sshKey"] {
            let error = set(&conn, key, "secret").unwrap_err();
            assert_eq!(error.code, crate::domain::ErrorCode::VALIDATION);
            assert!(error.message.contains("secure storage"));
        }
    }

    #[test]
    fn values_are_stored_under_the_kotlin_preference_names() {
        let conn = fresh_db("settings_columns");
        set(&conn, "webSearchEnabled", "false").unwrap();
        let column: String = conn
            .query_row(
                "SELECT key FROM app_settings WHERE key = 'tool_web_search'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(column, "tool_web_search");
    }
}
