/**
 * Workspace and thread contract. Mirrors model/Workspace.kt and the Room
 * entities WorkspaceEntity.kt / ChatThreadEntity.kt.
 */

/**
 * How a workspace answers prompts.
 * CHAT — conversational, with workspace context.
 * QUERY — strict RAG; answers only from embedded documents.
 * AGENT — autonomous multi-step planning and tool use.
 */
export type QueryMode = 'CHAT' | 'QUERY' | 'AGENT';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  /** Sampling temperature, 0..2. Kotlin `Float` → JS number. */
  temperature: number;
  queryMode: QueryMode;
  vectorCount: number;
  documentCount: number;
  /** Unix milliseconds. */
  createdAt: number;
  agentMaxSteps: number;
  agentAllowWebSearch: boolean;
  agentAllowFileCreation: boolean;
  agentAllowDocumentSearch: boolean;
}

export interface WorkspaceThread {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  /** Unix milliseconds. */
  createdAt: number;
  /** Unix milliseconds. */
  updatedAt: number;
  messageCount: number;
  lastMessageSnippet: string | null;
  isPinned: boolean;
}

/** Input for creating a workspace; servers fill the rest. */
export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  queryMode?: QueryMode;
  temperature?: number;
}

export interface CreateThreadInput {
  workspaceId: string;
  name: string;
}
