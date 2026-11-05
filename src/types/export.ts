/**
 * Export contract (MIGRATION_PLAN.md §3 Step 0.3 — export formats stay
 * compatible with what the Kotlin app produced).
 */

/** Wire values are lower-case because they are user-facing format names. */
export type ExportFormat = 'markdown' | 'json' | 'text';

export interface ExportResult {
  format: ExportFormat;
  /** Suggested file name, e.g. vukko_thread_th_default_20251105.md */
  fileName: string;
  mimeType: string;
  /** Full content of the export; the native FileModule writes it to disk. */
  content: string;
  bytes: number;
  messageCount: number;
  /** Unix milliseconds. */
  exportedAt: number;
}
