/**
 * Storage and integrity contract. Mirrors model/SovereignStorageStats.kt and the
 * storage inspector that renders it.
 */

export interface SovereignStorageStats {
  databaseName: string;
  totalWorkspaces: number;
  totalThreads: number;
  totalMessages: number;
  totalDocuments: number;
  isLocalEncrypted: boolean;
  storageType: string;
  dataSovereigntyStatus: string;
}

/** Row counts found by an integrity check, per table. */
export interface TableCount {
  table: string;
  rows: number;
}

export interface IntegrityCheckResult {
  ok: boolean;
  /** SQLite `PRAGMA integrity_check` output ("ok" or the first errors). */
  integrityCheck: string;
  /** Violations from `PRAGMA foreign_key_check`; empty when referential integrity holds. */
  foreignKeyViolations: number;
  /** True when a pre-migration backup of the database is still on disk. */
  backupPresent: boolean;
  tableCounts: TableCount[];
  /** Unix milliseconds. */
  checkedAt: number;
}

/** Whether the database is Room-owned, Rust-owned, or mid-migration. */
export type SchemaOwnership = 'NONE' | 'LEGACY_ROOM' | 'RUST' | 'MIGRATING';
