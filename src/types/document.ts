/**
 * Document and quick-action contract. Mirrors model/DocumentItem.kt.
 */

/** Wire values are the Kotlin enum names. */
export type DocumentType = 'TEXT' | 'PDF' | 'WEB_LINK' | 'MARKDOWN';

export interface DocumentItem {
  id: string;
  workspaceId: string;
  name: string;
  type: DocumentType;
  /** Pre-formatted size as displayed ("420 KB"). */
  size: string;
  vectorCount: number;
  contentSummary: string;
  fullContent: string;
  /** Unix milliseconds. */
  dateAdded: number;
}

export interface QuickActionItem {
  id: string;
  title: string;
  description: string;
  /** Prompt template containing exactly one `%s` placeholder for the selection. */
  promptTemplate: string;
  iconName: string;
}

export interface CreateDocumentInput {
  workspaceId: string;
  name: string;
  type: DocumentType;
  content: string;
}
