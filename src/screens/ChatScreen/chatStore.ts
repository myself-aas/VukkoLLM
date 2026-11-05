/**
 * Chat screen state.
 *
 * Zustand rather than a React context: the transcript is written on every
 * streamed token, and a context would re-render the whole tree per chunk. The
 * store holds *view* state only — persistence and provider calls go through the
 * bridge, so this file knows nothing about SQLite or SSE.
 */

import { create } from 'zustand';

import type { ChatMessage } from '../../types/chat';
import type { VukkoError } from '../../types/errors';
import type { LLMModel, ProviderType } from '../../types/provider';
import type { Workspace, WorkspaceThread } from '../../types/workspace';

export type ComposerStatus = 'IDLE' | 'SENDING' | 'STREAMING';

export interface ChatState {
  workspace: Workspace | null;
  workspaces: Workspace[];
  threads: WorkspaceThread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  draft: string;
  /** Set while a send is in flight, so the composer can show Stop. */
  activeRequestId: string | null;
  status: ComposerStatus;
  error: VukkoError | null;
  selectedModel: LLMModel | null;
  providersNeedingKeys: ProviderType[];

  setWorkspaces: (workspaces: Workspace[]) => void;
  setWorkspace: (workspace: Workspace) => void;
  setThreads: (threads: WorkspaceThread[]) => void;
  setActiveThread: (threadId: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setDraft: (draft: string) => void;
  setSelectedModel: (model: LLMModel) => void;
  setProvidersNeedingKeys: (providers: ProviderType[]) => void;
  beginRequest: (requestId: string, userMessage: ChatMessage, placeholder: ChatMessage) => void;
  appendDelta: (requestId: string, messageId: string, delta: string) => void;
  complete: (requestId: string, message: ChatMessage) => void;
  fail: (requestId: string, error: VukkoError) => void;
  /** A failure that happened before a request existed (a send that never started). */
  reportError: (error: VukkoError) => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  workspace: null,
  workspaces: [],
  threads: [],
  activeThreadId: null,
  messages: [],
  draft: '',
  activeRequestId: null,
  status: 'IDLE',
  error: null,
  selectedModel: null,
  providersNeedingKeys: [],

  setWorkspaces: (workspaces) => set({ workspaces }),
  setWorkspace: (workspace) => set({ workspace }),
  setThreads: (threads) => set({ threads }),
  setActiveThread: (activeThreadId) =>
    // Switching threads clears the transcript: a stale message from the
    // previous thread must never be visible under the new one.
    set({ activeThreadId, messages: [], error: null }),
  setMessages: (messages) => set({ messages }),
  setDraft: (draft) => set({ draft }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setProvidersNeedingKeys: (providersNeedingKeys) => set({ providersNeedingKeys }),

  beginRequest: (activeRequestId, userMessage, placeholder) =>
    set((state) => ({
      activeRequestId,
      status: 'STREAMING',
      error: null,
      messages: [...state.messages, userMessage, placeholder],
    })),

  appendDelta: (requestId, messageId, delta) =>
    set((state) => {
      // A chunk for a request that already finished must not resurrect the row.
      if (state.activeRequestId !== requestId) return state;
      return {
        messages: state.messages.map((message) =>
          message.id === messageId
            ? { ...message, content: message.content + delta, isStreaming: true }
            : message,
        ),
      };
    }),

  complete: (requestId, message) =>
    set((state) => {
      if (state.activeRequestId !== requestId) {
        // A completion for a request this store never started must not stop the
        // live one: the stream would freeze mid-answer.
        return state;
      }
      return {
        activeRequestId: null,
        status: 'IDLE',
        // The service owns the persisted row, so its copy is authoritative: it
        // carries the final content, citations, reasoning and tool calls that
        // the optimistic placeholder never had.
        messages: state.messages.map((existing) =>
          existing.id === message.id ? { ...message, isStreaming: false } : existing,
        ),
      };
    }),

  fail: (requestId, error) =>
    set((state) => {
      if (state.activeRequestId !== requestId) return state;
      return {
        activeRequestId: null,
        status: 'IDLE',
        error,
        messages: state.messages.map((message) =>
          message.isStreaming ? { ...message, isStreaming: false } : message,
        ),
      };
    }),

  reportError: (error) => set({ error, status: 'IDLE', activeRequestId: null }),

  clearError: () => set({ error: null }),
}));
