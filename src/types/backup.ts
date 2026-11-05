/**
 * Backup contract. Mirrors model/ and data/sync/** in the Kotlin app.
 *
 * `CLOUD_BUCKET` is listed for compatibility with existing preferences but is
 * NOT implemented: the Kotlin worker only logged "Simulating upload" and
 * returned success (BackupWorker.kt). Per MIGRATION_PLAN.md §8 Step 5.3 the
 * replacement reports `UNSUPPORTED` instead of faking success.
 */

export type BackupTarget = 'GITHUB' | 'CLOUD_BUCKET';

export type BackupTrigger = 'SCHEDULED' | 'MANUAL';

export type BackupStatus = 'COMPLETED' | 'FAILED' | 'UNSUPPORTED';

export interface BackupSettings {
  enabled: boolean;
  frequencyHours: number;
  target: BackupTarget;
  /** "owner/repo" for GITHUB backups; empty when unconfigured. */
  repository: string;
  cloudBucket: string;
  /** Unix milliseconds, 0 when never run. */
  lastBackupTimestamp: number;
}

export interface BackupResult {
  status: BackupStatus;
  /** Archive file name, e.g. vukko_backup_20251105_193000.json */
  fileName: string | null;
  /** Number of workspaces included in the archive. */
  workspaceCount: number;
  /** SHA-256 of the serialized archive, for integrity verification. */
  checksum: string | null;
  /** Unix milliseconds. */
  completedAt: number;
  /** Present when status is FAILED or UNSUPPORTED. */
  reason: string | null;
}
