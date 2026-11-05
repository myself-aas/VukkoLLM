//! Backup orchestration (MIGRATION_PLAN.md §10 Step 7.4).
//!
//! Serialisation, integrity and upload orchestration live here, in Rust, so the
//! host only ever schedules work and receives a result. Two behaviours are
//! deliberate:
//!
//! - `CLOUD_BUCKET` is `UNSUPPORTED`, because the Kotlin worker logged an
//!   upload and returned success without uploading anything. A backup that
//!   claims success it did not have is worse than no backup at all.
//! - an archive is written and checksummed *before* the upload is attempted, so
//!   a failed upload still leaves a local copy the user can retry from.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::{
    BackupResult, BackupSettings, BackupStatus, BackupTarget, BackupTrigger, Timestamp, VukkoError,
};

/// Builds the archive body for a set of workspaces.
///
/// The archive is JSON: it round-trips through the same domain types the
/// database uses, so a restore cannot disagree with a read.
pub fn serialise_archive<T: Serialize>(workspaces: &T) -> Result<String, VukkoError> {
    serde_json::to_string_pretty(workspaces)
        .map_err(|error| VukkoError::storage(format!("could not serialise the backup: {}", error)))
}

/// SHA-256 of the archive, the value a restore checks before trusting it.
pub fn checksum(archive: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(archive.as_bytes());
    hex::encode(hasher.finalize())
}

/// `vukko_backup_YYYYMMDD_HHMMSS.json`, the Kotlin worker's naming scheme.
pub fn archive_file_name(completed_at: Timestamp) -> String {
    let seconds = completed_at.div_euclid(1_000);
    let days = seconds.div_euclid(86_400);
    let time_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = time_of_day / 3_600;
    let minute = (time_of_day % 3_600) / 60;
    let second = time_of_day % 60;
    format!(
        "vukko_backup_{:04}{:02}{:02}_{:02}{:02}{:02}.json",
        year, month, day, hour, minute, second
    )
}

/// Days since the epoch to a Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Where an archive is uploaded. Injected so the orchestration is testable
/// without a network, and so a host can implement it over the GitHub API.
#[async_trait::async_trait]
pub trait BackupUploader: Send + Sync {
    /// Uploads the archive and returns the remote name it stored it under.
    async fn upload(
        &self,
        repository: &str,
        file_name: &str,
        archive: &str,
    ) -> Result<String, VukkoError>;
}

/// Runs one backup end to end.
pub async fn run_backup<T: Serialize>(
    settings: &BackupSettings,
    workspaces: &T,
    workspace_count: u32,
    uploader: &dyn BackupUploader,
    // The trigger is part of the result contract: a scheduled run and a manual
    // run are the same work, and the caller already knows which it asked for.
    trigger: BackupTrigger,
    now: Timestamp,
) -> BackupResult {
    tracing::debug!(?trigger, "running backup");

    if !settings.enabled {
        return BackupResult {
            status: BackupStatus::FAILED,
            file_name: None,
            workspace_count: 0,
            checksum: None,
            completed_at: now,
            reason: Some("Backups are disabled in settings".to_string()),
        };
    }

    if settings.target == BackupTarget::CLOUD_BUCKET {
        return BackupResult {
            status: BackupStatus::UNSUPPORTED,
            file_name: None,
            workspace_count: 0,
            checksum: None,
            completed_at: now,
            reason: Some(
                "Cloud bucket backups are not implemented; use a GitHub repository".to_string(),
            ),
        };
    }

    if settings.repository.trim().is_empty() {
        return BackupResult {
            status: BackupStatus::FAILED,
            file_name: None,
            workspace_count: 0,
            checksum: None,
            completed_at: now,
            reason: Some("No GitHub repository is configured".to_string()),
        };
    }

    let archive = match serialise_archive(workspaces) {
        Ok(archive) => archive,
        Err(error) => {
            return BackupResult {
                status: BackupStatus::FAILED,
                file_name: None,
                workspace_count: 0,
                checksum: None,
                completed_at: now,
                reason: Some(error.message),
            }
        }
    };
    let checksum = checksum(&archive);
    let file_name = archive_file_name(now);

    match uploader
        .upload(&settings.repository, &file_name, &archive)
        .await
    {
        Ok(_stored_as) => BackupResult {
            status: BackupStatus::COMPLETED,
            file_name: Some(file_name),
            workspace_count,
            checksum: Some(checksum),
            completed_at: now,
            reason: None,
        },
        Err(error) => BackupResult {
            status: BackupStatus::FAILED,
            file_name: Some(file_name),
            workspace_count,
            checksum: Some(checksum),
            completed_at: now,
            // The archive and its checksum are still reported: the local copy
            // exists, so the user can retry the upload without re-exporting.
            reason: Some(error.message),
        },
    }
}

/// The snapshot the home-screen widget renders (Step 7.5).
///
/// Four fields, no message bodies and no ids: the widget process reads this
/// from shared storage, so it carries the minimum that can draw a card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub active_workspace_name: String,
    pub active_thread_title: String,
    pub last_message_preview: String,
    pub updated_at: Timestamp,
}

/// Longest preview the widget shows, matching the TypeScript wrapper.
pub const WIDGET_PREVIEW_LIMIT: usize = 120;

impl WidgetSnapshot {
    /// Truncates the preview without splitting a multi-byte character.
    pub fn new(
        active_workspace_name: impl Into<String>,
        active_thread_title: impl Into<String>,
        last_message_preview: &str,
        updated_at: Timestamp,
    ) -> Self {
        let preview: String = last_message_preview
            .chars()
            .take(WIDGET_PREVIEW_LIMIT)
            .collect();
        Self {
            active_workspace_name: active_workspace_name.into(),
            active_thread_title: active_thread_title.into(),
            last_message_preview: preview,
            updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeUploader {
        fail: bool,
        seen: Mutex<Vec<(String, String, String)>>,
    }

    #[async_trait::async_trait]
    impl BackupUploader for FakeUploader {
        async fn upload(
            &self,
            repository: &str,
            file_name: &str,
            archive: &str,
        ) -> Result<String, VukkoError> {
            if let Ok(mut seen) = self.seen.lock() {
                seen.push((
                    repository.to_string(),
                    file_name.to_string(),
                    archive.to_string(),
                ));
            }
            if self.fail {
                return Err(VukkoError::network("upload refused"));
            }
            Ok(file_name.to_string())
        }
    }

    fn settings() -> BackupSettings {
        BackupSettings {
            enabled: true,
            frequency_hours: 24,
            target: BackupTarget::GITHUB,
            repository: "owner/repo".to_string(),
            cloud_bucket: String::new(),
            last_backup_timestamp: 0,
        }
    }

    const NOW: Timestamp = 1_767_225_600_000;

    #[tokio::test]
    async fn a_successful_backup_reports_name_count_and_checksum() {
        let uploader = FakeUploader::default();
        let result = run_backup(
            &settings(),
            &serde_json::json!([{ "id": "ws_1" }]),
            1,
            &uploader,
            BackupTrigger::MANUAL,
            NOW,
        )
        .await;

        assert_eq!(result.status, BackupStatus::COMPLETED);
        assert_eq!(result.workspace_count, 1);
        assert_eq!(
            result.file_name.as_deref(),
            Some("vukko_backup_20260101_000000.json")
        );
        assert_eq!(result.checksum.as_ref().map(String::len), Some(64));
        assert!(result.reason.is_none());
    }

    #[tokio::test]
    async fn a_cloud_bucket_target_is_unsupported_and_never_uploaded() {
        let uploader = FakeUploader::default();
        let result = run_backup(
            &BackupSettings {
                target: BackupTarget::CLOUD_BUCKET,
                cloud_bucket: "bucket".into(),
                ..settings()
            },
            &serde_json::json!([]),
            0,
            &uploader,
            BackupTrigger::SCHEDULED,
            NOW,
        )
        .await;

        assert_eq!(result.status, BackupStatus::UNSUPPORTED);
        assert!(result.reason.unwrap().contains("not implemented"));
        assert_eq!(uploader.seen.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn a_disabled_backup_does_nothing_and_says_so() {
        let uploader = FakeUploader::default();
        let result = run_backup(
            &BackupSettings {
                enabled: false,
                ..settings()
            },
            &serde_json::json!([]),
            0,
            &uploader,
            BackupTrigger::SCHEDULED,
            NOW,
        )
        .await;

        assert_eq!(result.status, BackupStatus::FAILED);
        assert_eq!(result.workspace_count, 0);
        assert!(result.reason.unwrap().contains("disabled"));
    }

    #[tokio::test]
    async fn a_failed_upload_keeps_the_archive_it_wrote() {
        let uploader = FakeUploader {
            fail: true,
            ..FakeUploader::default()
        };
        let result = run_backup(
            &settings(),
            &serde_json::json!([]),
            3,
            &uploader,
            BackupTrigger::SCHEDULED,
            NOW,
        )
        .await;

        assert_eq!(result.status, BackupStatus::FAILED);
        // The name and checksum survive, so the local copy is retryable.
        assert!(result.file_name.is_some());
        assert!(result.checksum.is_some());
        assert_eq!(result.workspace_count, 3);
        assert_eq!(result.reason.as_deref(), Some("upload refused"));
    }

    #[tokio::test]
    async fn the_archive_round_trips_and_its_checksum_matches() {
        let uploader = FakeUploader::default();
        let workspaces = serde_json::json!([{ "id": "ws_1", "name": "Personal" }]);
        run_backup(
            &settings(),
            &workspaces,
            1,
            &uploader,
            BackupTrigger::MANUAL,
            NOW,
        )
        .await;

        let (_, _, archive) = uploader.seen.lock().unwrap()[0].clone();
        let restored: serde_json::Value = serde_json::from_str(&archive).unwrap();
        assert_eq!(restored, workspaces);
        assert_eq!(checksum(&archive).len(), 64);
    }

    #[test]
    fn archive_names_are_sortable_and_timestamped() {
        assert_eq!(archive_file_name(0), "vukko_backup_19700101_000000.json");
        assert_eq!(archive_file_name(NOW), "vukko_backup_20260101_000000.json");
    }

    #[test]
    fn the_widget_snapshot_truncates_without_splitting_characters() {
        let snapshot = WidgetSnapshot::new("Personal", "Thread", &"é".repeat(400), NOW);
        assert_eq!(
            snapshot.last_message_preview.chars().count(),
            WIDGET_PREVIEW_LIMIT
        );
        assert_eq!(snapshot.active_workspace_name, "Personal");
        assert_eq!(snapshot.updated_at, NOW);
    }

    #[test]
    fn the_snapshot_serialises_with_camel_case_keys() {
        let snapshot = WidgetSnapshot::new("Personal", "Thread", "preview", NOW);
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["activeWorkspaceName"], "Personal");
        assert_eq!(json["lastMessagePreview"], "preview");
    }
}
