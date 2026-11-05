/**
 * Chat execution orchestration (MIGRATION_PLAN.md §8, §7 Step 4.3).
 *
 * Responsibilities:
 * - create the correlation id and the request record before anything streams;
 * - forward provider chunks to the bridge (which persists them) and to
 *   listeners as `NativeEvent`s;
 * - keep per-request state (partial text, usage, tool calls) so the UI can render
 *   a request that is still in flight, even after a screen change;
 * - enforce cancellation: after `cancel`, no delta, completion or failure for
 *   that request reaches anyone.
 *
 * It deliberately owns no UI and no provider wire format. The Rust equivalent
 * lives in `rust/crates/vukko-core/src/services/chat.rs`; the lifecycle rules
 * are the same because both are tested against the same scenarios.
 */

import type { ChatMessage } from '../types/chat';
import type { NativeEvent } from '../types/native';
import type { PendingRequest, PendingRequestStatus } from '../types/requests';
import type { VukkoError } from '../types/errors';
import { vukkoError } from '../types/errors';
import type { ProviderChunk, StreamEvent } from './providers/types';

/** The bridge operations the service needs. Kept tiny so it is easy to fake. */
export interface ChatBridgePort {
  createUserTurn(threadId: string, content: string): Promise<ChatMessage>;
  createAssistantPlaceholder(threadId: string): Promise<ChatMessage>;
  appendDelta(requestId: string, messageId: string, delta: string): Promise<void>;
  complete(requestId: string, content: string): Promise<ChatMessage>;
  fail(requestId: string, error: VukkoError): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

export type ChatEventListener = (event: NativeEvent) => void;

export interface SendOptions {
  threadId: string;
  content: string;
  provider: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string;
  attachments: never[] | Parameters<ChatBridgePort['createUserTurn']> extends never
    ? never
    : unknown[];
}

/** Per-request runtime state, exposed for tests and for the debug inspector. */
export interface RequestState extends PendingRequest {
  usage: { inputTokens: number; outputTokens: number } | null;
  toolCalls: Array<{ toolName: string; input: string }>;
  finishReason: string | null;
  error: VukkoError | null;
  /** Accumulated reasoning text, shown in the reasoning accordion. */
  reasoning: string | null;
  /** Citations reported by the provider (instance server, RAG modes). */
  citations?: Array<{ title: string; source: string; snippet: string; score: number }>;
}

const INITIAL_PARTIAL = '';

let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  return `req_${Date.now().toString(36)}_${requestCounter.toString(36)}`;
}

export class ChatService {
  private readonly requests = new Map<string, RequestState>();
  private readonly listeners = new Set<ChatEventListener>();

  constructor(
    private readonly port: ChatBridgePort,
    private readonly onEvent?: ChatEventListener,
  ) {}

  /** Registers an additional listener (the store subscribes here). */
  subscribe(listener: ChatEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  pendingCount(): number {
    let pending = 0;
    for (const state of this.requests.values()) {
      if (state.status === 'PENDING' || state.status === 'STREAMING') pending += 1;
    }
    return pending;
  }

  getRequest(requestId: string): RequestState | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Starts a request. The user turn and the streaming assistant row are
   * persisted before the id is returned, so a crash mid-stream still leaves a
   * coherent transcript.
   */
  async send(options: {
    threadId: string;
    content: string;
    provider: string;
    modelId: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
  }): Promise<RequestState> {
    const content = options.content.trim();
    if (content.length === 0) {
      throw Object.assign(new Error('content is required'), {
        code: 'VALIDATION' as const,
        retryable: false,
      });
    }

    await this.port.createUserTurn(options.threadId, content);
    const placeholder = await this.port.createAssistantPlaceholder(options.threadId);

    const state: RequestState = {
      requestId: nextRequestId(),
      threadId: options.threadId,
      assistantMessageId: placeholder.id,
      status: 'PENDING',
      startedAt: Date.now(),
      partialContent: INITIAL_PARTIAL,
      usage: null,
      toolCalls: [],
      finishReason: null,
      error: null,
      reasoning: null,
    };
    this.requests.set(state.requestId, state);
    return state;
  }

  /** Handles a normalised chunk from the provider. */
  handleDelta(requestId: string, messageId: string, delta: string): void {
    const state = this.requests.get(requestId);
    if (!state) return;
    if (state.status === 'CANCELLED' || state.status === 'COMPLETED' || state.status === 'FAILED') {
      // Late chunks must never resurrect a finished or cancelled message.
      return;
    }

    state.status = 'STREAMING';
    state.partialContent += delta;
    state.assistantMessageId = messageId;

    // Persisting a delta is fire-and-forget on purpose: the UI must not wait on
    // the database to draw a token. A storage failure is reported through the
    // returned promise rather than thrown into the stream loop.
    void this.port.appendDelta(requestId, messageId, delta).catch((cause: unknown) => {
      void this.fail(requestId, {
        code: 'STORAGE',
        message: cause instanceof Error ? cause.message : 'failed to persist a delta',
        retryable: false,
      });
    });
    this.emit({ type: 'message.delta', requestId, messageId, delta });
  }

  /**
   * Drains a parsed provider stream. A stream that carries an error fails the
   * request; nothing is completed on a partial stream.
   */
  async handleProviderStream(requestId: string, events: StreamEvent[]): Promise<void> {
    const state = this.requests.get(requestId);
    if (!state) return;

    // A cancellation arrives asynchronously; re-read the status before every
    // batch and every chunk rather than trusting the snapshot taken above.
    const stopped = () => this.isTerminal(requestId);

    for (const event of events) {
      if (stopped()) return;

      if (event.error) {
        await this.fail(requestId, event.error);
        return;
      }

      for (const chunk of event.chunks) {
        if (stopped()) return;
        this.applyChunk(requestId, state, chunk);
      }
    }

    if (stopped()) return;
    await this.complete(requestId);
  }

  private isTerminal(requestId: string): boolean {
    const status = this.requests.get(requestId)?.status;
    return status === 'CANCELLED' || status === 'FAILED' || status === 'COMPLETED';
  }

  private applyChunk(requestId: string, state: RequestState, chunk: ProviderChunk): void {
    switch (chunk.kind) {
      case 'text':
        this.handleDelta(requestId, state.assistantMessageId, chunk.text);
        return;
      case 'reasoning':
        // Reasoning is shown in the accordion, never appended to the answer.
        state.reasoning = `${state.reasoning ?? ''}${chunk.text}`;
        return;
      case 'tool_call':
        state.toolCalls = [...state.toolCalls, { toolName: chunk.toolName, input: chunk.input }];
        return;
      case 'usage':
        state.usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
        return;
      case 'done':
        state.finishReason = chunk.finishReason;
        return;
      case 'citation':
        // Citations arrive pre-normalised; the store keeps them for rendering.
        state.citations = [...(state.citations ?? []), chunk.citation];
        return;
      default:
        return;
    }
  }

  /** Finishes a request with the accumulated text. */
  async complete(requestId: string): Promise<void> {
    const state = this.requests.get(requestId);
    if (!state || state.status === 'CANCELLED' || state.status === 'COMPLETED') return;

    state.status = 'COMPLETED';
    const message = await this.port.complete(requestId, state.partialContent);
    this.emit({ type: 'message.completed', requestId, message });
  }

  /** Fails a request with a structured error and stores no content. */
  async fail(requestId: string, error: VukkoError): Promise<void> {
    const state = this.requests.get(requestId);
    if (!state || state.status === 'COMPLETED' || state.status === 'CANCELLED') return;

    state.status = 'FAILED';
    state.error = error;
    await this.port.fail(requestId, error);
    this.emit({ type: 'message.failed', requestId, error });
  }

  /**
   * Cancels a request. Idempotent: cancelling twice, or cancelling something
   * that already finished, does nothing.
   */
  async cancel(requestId: string): Promise<void> {
    const state = this.requests.get(requestId);
    if (!state) return;
    if (state.status === 'CANCELLED' || state.status === 'COMPLETED') return;

    state.status = 'CANCELLED';
    await this.port.cancel(requestId);
  }

  private emit(event: NativeEvent): void {
    this.onEvent?.(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must not break the stream for everyone else.
      }
    }
  }
}

/** Convenience: a structured error for a request that never started. */
export function notInitializedError(): VukkoError {
  return vukkoError({
    code: 'NOT_INITIALIZED',
    message: 'The storage engine is not ready yet',
  });
}

export type { PendingRequestStatus };
