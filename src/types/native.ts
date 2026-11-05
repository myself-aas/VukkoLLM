/**
 * The typed Rust bridge contract (MIGRATION_PLAN.md §2.2 and §7 Steps 4.2–4.3).
 *
 * `VukkoNativeModule` is the one TurboModule surface the app talks to. It is
 * domain-oriented: no table names, no SQL, no provider wire formats leak through
 * it. Every call either resolves with the documented value or rejects with a
 * `VukkoError`.
 */

import type { ChatMessage } from './chat';
import type { BackupResult, BackupSettings, BackupTrigger } from './backup';
import type { ErrorCode, VukkoError } from './errors';
import type { ExportFormat, ExportResult } from './export';
import type { GitHubRepository, GitHubUserProfile } from './github';
import type { DocumentItem } from './document';
import type { IntegrityCheckResult, SchemaOwnership, SovereignStorageStats } from './storage';
import type { Workspace, WorkspaceThread } from './workspace';
import type { ChatRequestId, SendMessageInput } from './requests';

/** Everything the host needs to know after `initialize()`. */
export interface InitializationState {
  schemaOwnership: SchemaOwnership;
  databaseName: string;
  /** Number of migrations applied during this startup. */
  migrationsApplied: number;
  /** True when the legacy Room database was upgraded in this run. */
  migratedFromLegacy: boolean;
  workspaceCount: number;
  /** Non-fatal problems worth surfacing (e.g. "backup of legacy db retained"). */
  warnings: string[];
}

/**
 * Events pushed from Rust. The first four carry a resource; the streaming
 * events carry a `requestId` so concurrent requests can be correlated.
 */
export type NativeEvent =
  | { type: 'workspace.updated'; workspace: Workspace }
  | { type: 'thread.updated'; thread: WorkspaceThread }
  | { type: 'message.created'; message: ChatMessage }
  | { type: 'message.updated'; message: ChatMessage }
  | { type: 'message.delta'; requestId: ChatRequestId; messageId: string; delta: string }
  | { type: 'message.completed'; requestId: ChatRequestId; message: ChatMessage }
  | { type: 'message.failed'; requestId: ChatRequestId; error: VukkoError }
  | { type: 'backup.completed'; result: BackupResult };

export type NativeEventListener = (event: NativeEvent) => void;

/** Returned by `subscribeToChatEvents`; calling it removes exactly that listener. */
export type Unsubscribe = () => void;

export interface VukkoNativeModule {
  initialize(): Promise<InitializationState>;

  isInitialized(): Promise<boolean>;

  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: {
    name: string;
    description?: string;
    systemPrompt?: string;
  }): Promise<Workspace>;
  updateWorkspace(workspace: Workspace): Promise<Workspace>;
  deleteWorkspace(workspaceId: string): Promise<void>;

  listThreads(workspaceId: string): Promise<WorkspaceThread[]>;
  createThread(input: { workspaceId: string; name: string }): Promise<WorkspaceThread>;
  renameThread(threadId: string, name: string): Promise<WorkspaceThread>;
  deleteThread(threadId: string): Promise<void>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;

  listMessages(threadId: string): Promise<ChatMessage[]>;
  listDocuments(workspaceId: string): Promise<DocumentItem[]>;
  deleteMessage(messageId: string): Promise<void>;
  setMessageFavorite(messageId: string, isFavorite: boolean): Promise<void>;
  setMessageTags(messageId: string, tags: string[]): Promise<void>;

  sendMessage(input: SendMessageInput): Promise<ChatRequestId>;
  cancelMessage(requestId: ChatRequestId): Promise<void>;

  subscribeToChatEvents(listener: NativeEventListener): Unsubscribe;

  exportThread(input: { threadId: string; format: ExportFormat }): Promise<ExportResult>;

  getStorageStats(): Promise<SovereignStorageStats>;
  runIntegrityCheck(): Promise<IntegrityCheckResult>;

  getBackupSettings(): Promise<BackupSettings>;
  updateBackupSettings(settings: BackupSettings): Promise<BackupSettings>;
  runBackupNow(trigger: BackupTrigger): Promise<BackupResult>;

  listGitHubRepositories(): Promise<GitHubRepository[]>;
  getGitHubProfile(): Promise<GitHubUserProfile | null>;
}

/**
 * Native modules that are not part of the Rust bridge: they wrap OS APIs and
 * keep their behaviour platform-side (MIGRATION_PLAN.md §10).
 */
export interface BiometricsModule {
  isAvailable(): Promise<boolean>;
  authenticate(options: {
    title: string;
    subtitle?: string;
  }): Promise<{ success: boolean; errorCode: string | null }>;
}

export interface SecureStorageModule {
  getSecret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface FileModule {
  pickDocuments(): Promise<
    Array<{ uri: string; name: string; mimeType: string; sizeBytes: number }>
  >;
  writeExport(fileName: string, content: string, mimeType: string): Promise<{ uri: string }>;
  shareFile(uri: string): Promise<void>;
}

export interface BackgroundTaskModule {
  scheduleBackup(): Promise<void>;
  cancelBackup(): Promise<void>;
  runBackupNow(): Promise<void>;
}

/** Error codes the native layer is allowed to reject with. */
export type NativeErrorCode = ErrorCode;
