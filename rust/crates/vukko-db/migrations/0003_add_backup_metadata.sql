-- Migration 0002: backup metadata.
--
-- One row per backup attempt that actually ran. The Kotlin app only kept
-- `last_backup_timestamp` in SharedPreferences, so failures were invisible; the
-- inspector and the backup service need the history.

CREATE TABLE IF NOT EXISTS `backup_runs` (
  `id` TEXT NOT NULL,
  `status` TEXT NOT NULL,               -- COMPLETED | FAILED | UNSUPPORTED
  `target` TEXT NOT NULL,               -- GITHUB | CLOUD_BUCKET
  `trigger` TEXT NOT NULL,              -- SCHEDULED | MANUAL
  `fileName` TEXT,
  `checksum` TEXT,
  `workspaceCount` INTEGER NOT NULL DEFAULT 0,
  `reason` TEXT,
  `completedAt` INTEGER NOT NULL,
  PRIMARY KEY(`id`)
);

CREATE INDEX IF NOT EXISTS `index_backup_runs_completedAt` ON `backup_runs` (`completedAt`);
