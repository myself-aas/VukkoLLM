/**
 * Chat domain contract. Mirrors app/src/main/java/com/vukko/model/ChatMessage.kt
 * and rust/crates/vukko-core/src/domain/chat.rs field for field.
 *
 * Wire rules (MIGRATION_PLAN.md §5 Step 2.1):
 * - IDs are strings.
 * - Timestamps are integer Unix milliseconds. Kotlin `Long` is bounded by
 *   Number.MAX_SAFE_INTEGER; the bridge rejects anything larger instead of
 *   silently losing precision.
 */

/** Who produced a message. Wire values are the Kotlin enum names. */
export type MessageSender = 'USER' | 'ASSISTANT' | 'SYSTEM';

/** Lifecycle of one agent step. Wire values are the Kotlin enum names. */
export type AgentStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface Citation {
  title: string;
  source: string;
  snippet: string;
  /** Retrieval score in [0, 1]. Kotlin `Float` → JS number. */
  score: number;
}

export interface ToolCall {
  toolName: string;
  description: string;
  input: string;
  output: string;
  isSuccess: boolean;
}

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** Pre-formatted size as shown in the UI ("184 KB"). Not a byte count. */
  sizeDisplay: string;
  previewText: string | null;
}

export interface AgentStep {
  stepIndex: number;
  title: string;
  description: string;
  toolName: string;
  status: AgentStepStatus;
  toolInput: string | null;
  toolOutput: string | null;
  executionTimeMs: number | null;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  sender: MessageSender;
  content: string;
  /** Unix milliseconds. */
  timestamp: number;
  thinking: string | null;
  thinkingDurationMs: number | null;
  citations: Citation[];
  toolsUsed: ToolCall[];
  attachments: MessageAttachment[];
  isStreaming: boolean;
  isAgentExecution: boolean;
  agentSteps: AgentStep[];
  createdDocumentId: string | null;
  createdDocumentName: string | null;
  isFavorite: boolean;
  isPinned: boolean;
  tags: string[];
}
