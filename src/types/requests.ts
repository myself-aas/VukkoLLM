/**
 * Chat request/streaming contract (MIGRATION_PLAN.md §7 Step 4.3, §8 Step 5.1).
 *
 * A request is identified by an opaque `ChatRequestId` string so events from
 * concurrent requests can never interleave incorrectly, and so cancellation can
 * address exactly one request.
 */

import type { MessageAttachment } from './chat';

export type ChatRequestId = string;

export interface SendMessageInput {
  workspaceId: string;
  threadId: string;
  /** Prompt text as typed by the user (already trimmed by the UI store). */
  content: string;
  provider: string;
  modelId: string;
  attachments: MessageAttachment[];
  /** Optional quick-action id that produced the prompt, for analytics-free tagging. */
  quickActionId: string | null;
}

/** Optimistic request bookkeeping kept in the JS store, mirrored in Rust. */
export type PendingRequestStatus = 'PENDING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface PendingRequest {
  requestId: ChatRequestId;
  threadId: string;
  assistantMessageId: string;
  status: PendingRequestStatus;
  /** Unix milliseconds. */
  startedAt: number;
  /** Accumulated text so far; replaced by the final message on completion. */
  partialContent: string;
}
