/**
 * Provider abstraction (MIGRATION_PLAN.md §8 Steps 5.1–5.2).
 *
 * One logical request, one normalised chunk vocabulary, one error contract. The
 * UI never sees a vendor's streaming format; adding a provider means adding a
 * parser and a request builder, not touching screens.
 */

import type { Citation } from '../../types/chat';
import type { MessageAttachment } from '../../types/chat';
import type { ProviderType, LLMModel } from '../../types/provider';
import type { VukkoError } from '../../types/errors';

/** Where inference actually runs. */
export type InferenceBackend = 'REMOTE' | 'OLLAMA' | 'EMBEDDED';

/** A message as the provider needs it: role + plain text. */
export interface ProviderMessage {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
}

/** An attachment ready to be sent: bytes are inlined as a data URI. */
export interface ProviderAttachment extends MessageAttachment {
  dataUri: string;
}

export interface ChatCompletionRequest {
  model: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  temperature: number;
  maxTokens: number;
  attachments: ProviderAttachment[];
}

/** The only chunk shapes that leave this layer. */
export type ProviderChunk =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool_call'; toolName: string; input: string }
  | { kind: 'citation'; citation: Citation }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'done'; finishReason: string };

/** One incremental parse result: chunks, and the first fatal error if any. */
export interface StreamEvent {
  chunks: ProviderChunk[];
  error?: VukkoError;
}

/** A provider descriptor: what it is, where it runs, what it can do. */
export interface ProviderDescriptor {
  type: ProviderType;
  backend: InferenceBackend;
  /** Default base URL when the user has not configured one. */
  defaultBaseUrl: string;
  supportsVision: boolean;
  supportsTools: boolean;
  requiresApiKey: boolean;
  /** Wire protocol, used to pick the parser. */
  protocol: 'OPENAI_SSE' | 'ANTHROPIC_SSE' | 'GEMINI_STREAM' | 'OLLAMA_NDJSON' | 'INSTANCE_NDJSON';
}

/** A provider request ready to hand to `fetch`. */
export interface PreparedRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface BuildRequestOptions {
  /** Overrides the descriptor's default (Ollama LAN address, instance server). */
  baseUrl?: string;
  apiKey?: string;
}

/** Model capability lookup used to decide attachment support. */
export interface ModelCapabilities {
  supportsVision: boolean;
  supportsReasoning: boolean;
}

export type ModelLookup = (modelId: string) => ModelCapabilities | undefined;

export type { LLMModel };
