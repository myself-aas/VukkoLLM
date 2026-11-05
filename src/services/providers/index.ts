/**
 * Provider registry, request building and stream normalisation.
 *
 * Rust equivalent: `rust/crates/vukko-core/src/providers/`. The parsing rules
 * are identical and are tested against the same recorded payloads
 * (`tests/providers/fixtures.js`).
 */

import type { ProviderType } from '../../types/provider';
import type { VukkoError } from '../../types/errors';
import { vukkoError } from '../../types/errors';
import type {
  BuildRequestOptions,
  ChatCompletionRequest,
  PreparedRequest,
  ProviderChunk,
  ProviderDescriptor,
  StreamEvent,
} from './types';
import { ProviderRequestError } from './errors';

export * from './types';
export { ProviderRequestError, parseErrorResponse } from './errors';

/**
 * Every provider the app ships. `requiresApiKey` is false for Ollama (LAN) and
 * true for the hosted APIs; the instance server accepts an optional key.
 */
export const PROVIDERS: Record<ProviderType, ProviderDescriptor> = {
  GEMINI: {
    type: 'GEMINI',
    backend: 'REMOTE',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsVision: true,
    supportsTools: true,
    requiresApiKey: true,
    protocol: 'GEMINI_STREAM',
  },
  OPENAI: {
    type: 'OPENAI',
    backend: 'REMOTE',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsVision: true,
    supportsTools: true,
    requiresApiKey: true,
    protocol: 'OPENAI_SSE',
  },
  ANTHROPIC: {
    type: 'ANTHROPIC',
    backend: 'REMOTE',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    supportsVision: true,
    supportsTools: true,
    requiresApiKey: true,
    protocol: 'ANTHROPIC_SSE',
  },
  DEEPSEEK: {
    type: 'DEEPSEEK',
    backend: 'REMOTE',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    supportsVision: false,
    supportsTools: true,
    requiresApiKey: true,
    protocol: 'OPENAI_SSE',
  },
  GROQ: {
    type: 'GROQ',
    backend: 'REMOTE',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportsVision: false,
    supportsTools: true,
    requiresApiKey: true,
    protocol: 'OPENAI_SSE',
  },
  OLLAMA: {
    type: 'OLLAMA',
    backend: 'OLLAMA',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    supportsVision: false,
    supportsTools: false,
    requiresApiKey: false,
    protocol: 'OLLAMA_NDJSON',
  },
  INSTANCE: {
    type: 'INSTANCE',
    backend: 'REMOTE',
    defaultBaseUrl: 'http://10.0.2.2:3001',
    supportsVision: true,
    supportsTools: true,
    requiresApiKey: false,
    protocol: 'INSTANCE_NDJSON',
  },
};

/** Resolves a provider type, failing loudly on an unknown one. */
export function providerFromType(type: ProviderType): ProviderDescriptor {
  const descriptor = PROVIDERS[type];
  if (!descriptor) {
    throw new ProviderRequestError(
      vukkoError({ code: 'UNSUPPORTED', message: `unknown provider: ${String(type)}` }),
    );
  }
  return descriptor;
}

// ------------------------------------------------------------------ requests

const ASSISTANT_ROLE = {
  OPENAI_SSE: 'assistant',
  ANTHROPIC_SSE: 'assistant',
  GEMINI_STREAM: 'model',
  OLLAMA_NDJSON: 'assistant',
  INSTANCE_NDJSON: 'assistant',
} as const;

function splitDataUri(dataUri: string): { mimeType: string; data: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUri);
  if (!match) {
    throw new ProviderRequestError(
      vukkoError({ code: 'VALIDATION', message: 'attachment is not a base64 data URI' }),
    );
  }
  return { mimeType: match[1] as string, data: match[2] as string };
}

/** Builds the provider-specific HTTP request for one logical request. */
export function buildRequest(
  type: ProviderType,
  request: ChatCompletionRequest,
  options: BuildRequestOptions = {},
): PreparedRequest {
  const descriptor = providerFromType(type);
  const baseUrl = (options.baseUrl ?? descriptor.defaultBaseUrl).replace(/\/+$/, '');
  const apiKey = options.apiKey ?? '';

  if (descriptor.requiresApiKey && apiKey.length === 0) {
    throw new ProviderRequestError(
      vukkoError({
        code: 'AUTHENTICATION',
        message: `${descriptor.type} requires an API key`,
        details: { provider: descriptor.type },
      }),
    );
  }

  if (request.attachments.length > 0 && !descriptor.supportsVision) {
    throw new ProviderRequestError(
      vukkoError({
        code: 'UNSUPPORTED',
        message: `${descriptor.type} does not accept image attachments`,
        details: { provider: descriptor.type },
      }),
    );
  }

  const assistantRole = ASSISTANT_ROLE[descriptor.protocol];

  switch (descriptor.protocol) {
    case 'OPENAI_SSE': {
      const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: request.systemPrompt },
        ...request.messages.map((message) => ({
          role: message.role === 'ASSISTANT' ? assistantRole : message.role.toLowerCase(),
          content: message.content,
        })),
      ];

      if (request.attachments.length > 0) {
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if (lastUser) {
          lastUser.content = [
            { type: 'text', text: String(lastUser.content) },
            ...request.attachments.map((attachment) => ({
              type: 'image_url',
              image_url: { url: attachment.dataUri },
            })),
          ];
        }
      }

      return {
        url: `${baseUrl}/chat/completions`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: {
          model: request.model,
          messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        },
      };
    }

    case 'ANTHROPIC_SSE': {
      const messages = request.messages.map((message) => ({
        role: message.role === 'ASSISTANT' ? assistantRole : 'user',
        content: [{ type: 'text', text: message.content }] as Array<Record<string, unknown>>,
      }));

      if (request.attachments.length > 0) {
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if (lastUser) {
          for (const attachment of request.attachments) {
            const { mimeType, data } = splitDataUri(attachment.dataUri);
            lastUser.content.push({
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data },
            });
          }
        }
      }

      return {
        url: `${baseUrl}/messages`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: request.model,
          system: request.systemPrompt,
          messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
        },
      };
    }

    case 'GEMINI_STREAM': {
      const contents = request.messages.map((message) => ({
        role: message.role === 'ASSISTANT' ? assistantRole : 'user',
        parts: [{ text: message.content }] as Array<Record<string, unknown>>,
      }));

      if (request.attachments.length > 0) {
        const lastUser = [...contents].reverse().find((entry) => entry.role === 'user');
        if (lastUser) {
          for (const attachment of request.attachments) {
            const { mimeType, data } = splitDataUri(attachment.dataUri);
            lastUser.parts.push({ inlineData: { mimeType, data } });
          }
        }
      }

      return {
        url: `${baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: {
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
          },
        },
      };
    }

    case 'OLLAMA_NDJSON': {
      return {
        url: `${baseUrl}/api/chat`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          model: request.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...request.messages.map((message) => ({
              role: message.role === 'ASSISTANT' ? assistantRole : message.role.toLowerCase(),
              content: message.content,
            })),
          ],
          stream: true,
          options: { temperature: request.temperature, num_predict: request.maxTokens },
        },
      };
    }

    case 'INSTANCE_NDJSON': {
      return {
        url: `${baseUrl}/v1/chat`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: {
          model: request.model,
          systemPrompt: request.systemPrompt,
          messages: request.messages.map((message) => ({
            role: message.role === 'ASSISTANT' ? assistantRole : message.role.toLowerCase(),
            content: message.content,
          })),
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: true,
          attachments: request.attachments.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            dataUri: attachment.dataUri,
          })),
        },
      };
    }
  }
}

// ------------------------------------------------------------------- parsing

/** Splits an SSE body into `data:` payloads, dropping comments and events. */
function ssePayloads(raw: string): string[] {
  const payloads: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    payloads.push(line.slice(5).trimStart());
  }
  return payloads;
}

/**
 * Splits an NDJSON body into JSON payloads.
 *
 * Accepts an optional `data: ` prefix: a reverse proxy in front of a local
 * Ollama commonly re-frames NDJSON as SSE, and the payload is identical.
 */
function ndjsonPayloads(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^data:\s*/, ''))
    .filter((line) => line.startsWith('{'));
}

interface AnthropicToolState {
  index: number;
  name: string;
  input: string;
}

/**
 * Parses a provider stream into normalised events.
 *
 * Parsing is incremental-safe: every payload is complete on its own, and a
 * payload that fails to parse becomes a `NETWORK` error on that event, so a
 * truncated stream shows as a failure instead of a short answer.
 */
export function parseStream(
  provider: string,
  raw: string,
  onEvent?: (event: StreamEvent) => void,
): StreamEvent[] {
  const descriptor = providerFromType(provider as ProviderType);
  // Gemini and the instance server stream the same JSON frames with or without
  // SSE framing (`alt=sse` only changes the envelope), so normalise a bare
  // JSON body into `data:` lines before parsing.
  if (!raw.includes('data:') && /^\s*[[{]/.test(raw)) {
    const sse = descriptor.protocol === 'GEMINI_STREAM';
    raw = raw
      .split(/(?<=\})\s*(?=\{)/)
      .map((frame) => `${sse ? 'data: ' : ''}${frame.trim()}\n`)
      .join('');
  }
  const events: StreamEvent[] = [];
  const push = (chunks: ProviderChunk[], error?: VukkoError) => {
    const event: StreamEvent = error ? { chunks, error } : { chunks };
    events.push(event);
    onEvent?.(event);
  };

  const malformed = (payload: string, reason: string) =>
    vukkoError({
      code: 'NETWORK',
      message: `malformed response from ${provider}: ${reason}`,
      details: { payload: payload.slice(0, 120) },
    });

  switch (descriptor.protocol) {
    case 'OPENAI_SSE':
    case 'GEMINI_STREAM': {
      let streamEnded = false;
      let usageSeen = false;
      let pendingFinish: string | null = null;
      for (const payload of ssePayloads(raw)) {
        if (payload === '[DONE]') {
          // `[DONE]` only terminates a stream that has not already reported a
          // finish reason; emitting a second `done` would restart the UI state
          // machine.
          if (!streamEnded) push([{ kind: 'done', finishReason: 'stop' }]);
          streamEnded = true;
          continue;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          push([], malformed(payload, 'invalid JSON'));
          continue;
        }
        const chunks: ProviderChunk[] = [];

        if (descriptor.protocol === 'GEMINI_STREAM') {
          for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
            if (typeof part.text !== 'string' || part.text.length === 0) continue;
            chunks.push(
              part.thought
                ? { kind: 'reasoning', text: part.text }
                : { kind: 'text', text: part.text },
            );
          }
          const usage = parsed.usageMetadata;
          if (usage) {
            chunks.push({
              kind: 'usage',
              inputTokens: usage.promptTokenCount ?? 0,
              outputTokens: usage.candidatesTokenCount ?? 0,
            });
          }
          const finishReason = parsed.candidates?.[0]?.finishReason;
          // Gemini repeats `finishReason` on the final content frame *before*
          // the usage-only frame arrives, so the terminal `done` is emitted once
          // after the loop: the UI must see usage before it closes the stream.
          if (finishReason) pendingFinish = finishReason;
          push(chunks);
          continue;
        }

        const choice = parsed.choices?.[0];
        const delta = choice?.delta ?? {};
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          chunks.push({ kind: 'text', text: delta.content });
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          chunks.push({ kind: 'reasoning', text: delta.reasoning_content });
        }
        for (const toolCall of delta.tool_calls ?? []) {
          const name = toolCall.function?.name;
          if (!name) continue;
          chunks.push({
            kind: 'tool_call',
            toolName: name,
            input: toolCall.function?.arguments ?? '{}',
          });
        }
        if (parsed.usage) {
          const inputTokens = parsed.usage.prompt_tokens ?? 0;
          const outputTokens = parsed.usage.completion_tokens ?? 0;
          // Only a request that reported no completion tokens at all (the
          // trailing usage-only frame some relays send) counts as informative;
          // otherwise the first report wins, so usage is never double counted.
          if (!usageSeen || outputTokens > 0) {
            chunks.push({ kind: 'usage', inputTokens, outputTokens });
            usageSeen = true;
          }
        }
        if (choice?.finish_reason && !streamEnded) {
          chunks.push({ kind: 'done', finishReason: choice.finish_reason });
          streamEnded = true;
        }
        push(chunks);
        continue;
      }

      if (descriptor.protocol === 'GEMINI_STREAM' && pendingFinish && !streamEnded) {
        push([{ kind: 'done', finishReason: pendingFinish }]);
        streamEnded = true;
      }
      break;
    }

    case 'ANTHROPIC_SSE': {
      let inputTokens = 0;
      let outputTokens = 0;
      let tool: AnthropicToolState | null = null;
      let stopReason: string | null = null;

      for (const payload of ssePayloads(raw)) {
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          push([], malformed(payload, 'invalid JSON'));
          continue;
        }
        const chunks: ProviderChunk[] = [];

        switch (parsed.type) {
          case 'message_start': {
            inputTokens = parsed.message?.usage?.input_tokens ?? 0;
            break;
          }
          case 'content_block_start': {
            if (parsed.content_block?.type === 'tool_use') {
              tool = {
                index: parsed.index ?? 0,
                name: parsed.content_block.name,
                input: '',
              };
            }
            break;
          }
          case 'content_block_delta': {
            const delta = parsed.delta ?? {};
            if (delta.type === 'text_delta' && delta.text) {
              chunks.push({ kind: 'text', text: delta.text });
            } else if (delta.type === 'thinking_delta' && delta.thinking) {
              chunks.push({ kind: 'reasoning', text: delta.thinking });
            } else if (delta.type === 'input_json_delta' && tool) {
              tool.input += delta.partial_json ?? '';
            }
            break;
          }
          case 'content_block_stop': {
            // The recorded stream ends immediately after the last
            // `input_json_delta`, without a `content_block_stop`; flush here and
            // again after the loop so a truncated tail still yields the tool
            // call rather than silently dropping it.
            if (tool && tool.index === parsed.index) {
              chunks.push({
                kind: 'tool_call',
                toolName: tool.name,
                input: tool.input || '{}',
              });
              tool = null;
            }
            break;
          }
          case 'message_delta': {
            outputTokens = parsed.usage?.output_tokens ?? outputTokens;
            stopReason = parsed.delta?.stop_reason ?? stopReason;
            break;
          }
          case 'error': {
            push(
              [],
              vukkoError({
                code: 'NETWORK',
                message: parsed.error?.message ?? 'provider error',
                details: { type: parsed.error?.type ?? 'unknown' },
              }),
            );
            continue;
          }
          default:
            break;
        }
        push(chunks);
      }

      if (tool) {
        push([{ kind: 'tool_call', toolName: tool.name, input: tool.input || '{}' }]);
      }
      if (inputTokens > 0 || outputTokens > 0) {
        push([{ kind: 'usage', inputTokens, outputTokens }]);
      }
      if (stopReason) {
        push([{ kind: 'done', finishReason: stopReason }]);
      }
      break;
    }

    case 'OLLAMA_NDJSON': {
      for (const payload of ndjsonPayloads(raw)) {
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          push([], malformed(payload, 'invalid JSON'));
          continue;
        }
        if (parsed.error) {
          push([], vukkoError({ code: 'NETWORK', message: String(parsed.error) }));
          continue;
        }
        const chunks: ProviderChunk[] = [];
        const content = parsed.message?.content;
        if (typeof content === 'string' && content.length > 0) {
          chunks.push({ kind: 'text', text: content });
        }
        const thinking = parsed.message?.thinking;
        if (typeof thinking === 'string' && thinking.length > 0) {
          chunks.push({ kind: 'reasoning', text: thinking });
        }
        if (parsed.done) {
          if (
            typeof parsed.prompt_eval_count === 'number' ||
            typeof parsed.eval_count === 'number'
          ) {
            chunks.push({
              kind: 'usage',
              inputTokens: parsed.prompt_eval_count ?? 0,
              outputTokens: parsed.eval_count ?? 0,
            });
          }
          chunks.push({ kind: 'done', finishReason: parsed.done_reason ?? 'stop' });
        }
        push(chunks);
      }
      break;
    }

    case 'INSTANCE_NDJSON': {
      for (const payload of ndjsonPayloads(raw)) {
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          push([], malformed(payload, 'invalid JSON'));
          continue;
        }
        const chunks: ProviderChunk[] = [];
        if (parsed.type === 'delta' && typeof parsed.text === 'string') {
          chunks.push({ kind: 'text', text: parsed.text });
        } else if (parsed.type === 'reasoning' && typeof parsed.text === 'string') {
          chunks.push({ kind: 'reasoning', text: parsed.text });
        } else if (parsed.type === 'citation') {
          chunks.push({
            kind: 'citation',
            citation: {
              title: parsed.title ?? '',
              source: parsed.source ?? '',
              snippet: parsed.snippet ?? '',
              score: parsed.score ?? 0,
            },
          });
        } else if (parsed.type === 'done') {
          // The final frame must carry usage for it to be reported; otherwise a
          // zeroed usage chunk would overwrite the real numbers in the UI.
          if (parsed.usage) {
            chunks.push({
              kind: 'usage',
              inputTokens: parsed.usage.input ?? 0,
              outputTokens: parsed.usage.output ?? 0,
            });
          }
          chunks.push({ kind: 'done', finishReason: parsed.finishReason ?? 'stop' });
        } else if (parsed.type === 'error') {
          push(
            [],
            vukkoError({
              code: parsed.code === 'AUTHENTICATION' ? 'AUTHENTICATION' : 'NETWORK',
              message: parsed.message ?? 'instance server error',
            }),
          );
          continue;
        }
        push(chunks);
      }
      break;
    }
  }

  return events;
}
