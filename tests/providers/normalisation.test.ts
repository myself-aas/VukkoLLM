/**
 * Provider normalisation tests (MIGRATION_PLAN.md §8 Steps 5.1–5.2).
 *
 * The contract: no matter which backend produced the bytes, the app receives the
 * same small vocabulary of chunks and the same error kinds. The React UI must
 * never learn a vendor's streaming format.
 */

import {
  type ProviderChunk,
  type StreamEvent,
  parseStream,
  parseErrorResponse,
  providerFromType,
  buildRequest,
} from '../../src/services/providers';
import {
  anthropicExpected,
  anthropicSse,
  contextLimitBody,
  deepseekExpected,
  deepseekReasoningSse,
  errorBodies,
  geminiExpected,
  geminiStream,
  geminiThoughtExpected,
  geminiThoughtStream,
  instanceExpected,
  instanceNdjson,
  ollamaExpected,
  ollamaNdjson,
  openaiExpected,
  openaiSse,
} from './fixtures';

/** Splits a recorded payload the way the network would, then parses it. */
async function collect(events: StreamEvent[]): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for (const event of events) {
    chunks.push(...event.chunks);
  }
  return chunks;
}

function toPayload(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return String(raw);
  return raw
    .map((item) => `data: ${typeof item === 'string' ? item : JSON.stringify(item)}\n`)
    .join('');
}

async function normalise(provider: string, payload: unknown): Promise<ProviderChunk[]> {
  return collect(parseStream(provider, toPayload(payload)));
}

describe('every provider produces the same normalised vocabulary', () => {
  test.each([
    ['OPENAI', openaiSse, openaiExpected],
    ['DEEPSEEK', deepseekReasoningSse, deepseekExpected],
    ['ANTHROPIC', anthropicSse, anthropicExpected],
    ['GEMINI', geminiStream, geminiExpected],
    ['OLLAMA', ollamaNdjson, ollamaExpected],
    ['INSTANCE', instanceNdjson, instanceExpected],
  ])('%s', async (provider, payload, expected) => {
    const chunks = await normalise(provider, payload as string | unknown[]);
    expect(chunks).toEqual(expected);
  });
});

describe('reasoning content is separated from answer content', () => {
  test('OpenAI-compatible reasoning deltas never mix into the answer', async () => {
    const chunks = await normalise('DEEPSEEK', deepseekReasoningSse);
    const answer = chunks
      .filter((chunk) => chunk.kind === 'text')
      .map((chunk) => (chunk as { text: string }).text)
      .join('');
    expect(answer).toBe('Answer.');
  });

  test('Gemini thought parts become reasoning chunks', async () => {
    const chunks = await normalise('GEMINI', geminiThoughtStream);
    expect(chunks).toEqual(geminiThoughtExpected);
  });
});

describe('tool calls are normalised with their arguments intact', () => {
  test('OpenAI tool_calls carry the JSON argument string', async () => {
    const toolCall = (await normalise('OPENAI', openaiSse)).find(
      (chunk) => chunk.kind === 'tool_call',
    );
    expect(toolCall).toEqual({
      kind: 'tool_call',
      toolName: 'DocumentRAG',
      input: '{"query":"sovereignty"}',
    });
  });

  test('Anthropic input_json_delta fragments are reassembled', async () => {
    const chunks = await normalise('ANTHROPIC', anthropicSse);
    expect(chunks.filter((chunk) => chunk.kind === 'tool_call')).toEqual([
      { kind: 'tool_call', toolName: 'WebSearch', input: '{"query":"news"}' },
    ]);
  });
});

describe('usage is reported once per stream', () => {
  test.each([
    ['OPENAI', openaiSse],
    ['ANTHROPIC', anthropicSse],
    ['GEMINI', geminiStream as unknown as string],
    ['OLLAMA', ollamaNdjson as unknown as string],
    ['INSTANCE', instanceNdjson as unknown as string],
  ])('%s reports a single usage chunk', async (provider, payload) => {
    const chunks = await normalise(provider, payload);
    expect(chunks.filter((chunk) => chunk.kind === 'usage')).toHaveLength(1);
  });
});

describe('malformed payloads fail instead of producing silent partial answers', () => {
  test('a truncated SSE frame surfaces as a provider error', async () => {
    const events = parseStream(
      'OPENAI',
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{',
    );
    const chunks = await collect(events);
    expect(chunks[0]).toEqual({ kind: 'text', text: 'Hi' });
    const failure = events.find((event) => event.error);
    expect(failure?.error).toMatchObject({ code: 'NETWORK' });
  });

  test('a stream with no data lines yields nothing rather than invented text', () => {
    const events = parseStream('OPENAI', 'event: ping\n\n');
    expect(events.flatMap((event) => event.chunks)).toEqual([]);
  });

  test('an unknown provider name is rejected', () => {
    expect(() => providerFromType('NOT_A_PROVIDER' as never)).toThrow(/unknown provider/i);
  });
});

describe('errors map to the structured contract', () => {
  test.each([
    ['OPENAI', errorBodies.openai],
    ['ANTHROPIC', errorBodies.anthropic],
    ['GEMINI', errorBodies.gemini],
    ['OLLAMA', { status: 401, body: JSON.stringify({ error: 'unauthorized' }) }],
    ['INSTANCE', { status: 401, body: JSON.stringify({ error: { message: 'invalid token' } }) }],
  ])('%s authentication failure is AUTHENTICATION and not retryable', (provider, payload) => {
    const error = parseErrorResponse(provider as string, payload.status, payload.body);
    expect(error.code).toBe('AUTHENTICATION');
    expect(error.retryable).toBe(false);
    // The message must be actionable but must never echo the key.
    expect(error.message.toLowerCase()).not.toMatch(/sk-|ghp_|aiza/);
  });

  test('a context-limit rejection is VALIDATION with the limit in details', () => {
    const error = parseErrorResponse('OPENAI', contextLimitBody.status, contextLimitBody.body);
    expect(error.code).toBe('VALIDATION');
    expect(error.details?.reason).toBe('CONTEXT_LENGTH_EXCEEDED');
  });

  test('5xx and network failures are retryable NETWORK errors', () => {
    expect(parseErrorResponse('OPENAI', 503, 'upstream unavailable')).toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
    expect(parseErrorResponse('OPENAI', 429, '{"error":{"message":"rate limited"}}')).toMatchObject(
      {
        code: 'NETWORK',
        retryable: true,
      },
    );
  });

  test('a missing model is NOT_FOUND', () => {
    expect(parseErrorResponse('OLLAMA', 404, errorBodies.ollama.body).code).toBe('NOT_FOUND');
    expect(
      parseErrorResponse(
        'OPENAI',
        404,
        '{"error":{"code":"model_not_found","message":"no such model"}}',
      ).code,
    ).toBe('NOT_FOUND');
  });
});

describe('request building', () => {
  test('each provider builds its own wire shape from one logical request', () => {
    const request = {
      model: 'gemini-2.5-flash',
      systemPrompt: 'Be brief.',
      messages: [
        { role: 'USER' as const, content: 'Hello' },
        { role: 'ASSISTANT' as const, content: 'Hi!' },
        { role: 'USER' as const, content: 'And now?' },
      ],
      temperature: 0.4,
      maxTokens: 512,
      attachments: [
        {
          id: 'a1',
          name: 'pic.png',
          mimeType: 'image/png',
          sizeDisplay: '1 KB',
          previewText: null,
          dataUri: 'data:image/png;base64,AAA',
        },
      ],
    };

    const openai = buildRequest('OPENAI', request, { apiKey: 'test-key' });
    expect(openai.url).toContain('/chat/completions');
    expect(openai.headers.authorization).toMatch(/^Bearer /);
    expect(openai.body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(openai.body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(openai.body.stream).toBe(true);
    expect(openai.body.max_tokens).toBe(512);

    const anthropic = buildRequest('ANTHROPIC', request, { apiKey: 'test-key' });
    expect(anthropic.url).toContain('/v1/messages');
    expect(anthropic.headers['x-api-key']).toBeDefined();
    expect(anthropic.body.system).toBe('Be brief.');
    // Anthropic has no system role inside messages.
    expect(anthropic.body.messages.every((message) => message.role !== 'system')).toBe(true);
    expect(anthropic.body.max_tokens).toBe(512);

    const gemini = buildRequest('GEMINI', request, { apiKey: 'test-key' });
    expect(gemini.url).toContain(':streamGenerateContent');
    expect(gemini.body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(gemini.body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'Hello' }] });
    expect(gemini.body.generationConfig.maxOutputTokens).toBe(512);

    // Ollama is text-only, so the request that includes an image is exercised
    // separately; this one proves its system-message handling.
    const ollama = buildRequest('OLLAMA', { ...request, attachments: [] });
    expect(ollama.url).toContain('/api/chat');
    expect(ollama.body.stream).toBe(true);
    // Ollama keeps the system prompt as the first message rather than a field.
    expect(ollama.body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });

    const instance = buildRequest('INSTANCE', request);
    expect(instance.url).toContain('/v1/chat');
    // The instance server's key is optional: without one, no auth header is
    // sent at all rather than an empty Bearer token.
    expect(instance.headers.authorization).toBeUndefined();
    expect(buildRequest('INSTANCE', request, { apiKey: 'k' }).headers.authorization).toBe(
      'Bearer k',
    );
  });

  test('a missing API key fails at build time, not at the network', () => {
    expect(() =>
      buildRequest('OPENAI', {
        model: 'gpt-4o',
        systemPrompt: '',
        messages: [{ role: 'USER' as const, content: 'hi' }],
        temperature: 0.7,
        maxTokens: 64,
        attachments: [],
      }),
    ).toThrow(/requires an API key/i);
  });

  test('vision attachments are encoded per provider', () => {
    const request = {
      model: 'gpt-4o',
      systemPrompt: '',
      messages: [{ role: 'USER' as const, content: 'What is this?' }],
      temperature: 0.7,
      maxTokens: 256,
      attachments: [
        {
          id: 'a1',
          name: 'pic.png',
          mimeType: 'image/png',
          sizeDisplay: '1 KB',
          previewText: null,
          dataUri: 'data:image/png;base64,AAA',
        },
      ],
    };

    const openai = buildRequest('OPENAI', request, { apiKey: 'test-key' });
    const lastContent = openai.body.messages.at(-1).content;
    expect(Array.isArray(lastContent)).toBe(true);
    expect(lastContent[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA' },
    });

    const anthropic = buildRequest('ANTHROPIC', request, { apiKey: 'test-key' });
    const anthropicContent = anthropic.body.messages.at(-1).content;
    expect(anthropicContent[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA' },
    });

    const gemini = buildRequest('GEMINI', request, { apiKey: 'test-key' });
    const parts = gemini.body.contents.at(-1).parts;
    expect(parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'AAA' },
    });
  });

  test('a provider that cannot see images fails loudly for a vision message', () => {
    expect(() =>
      buildRequest('OLLAMA', {
        model: 'llama3.2:latest',
        systemPrompt: '',
        messages: [{ role: 'USER' as const, content: 'look' }],
        temperature: 0.7,
        maxTokens: 256,
        attachments: [
          {
            id: 'a1',
            name: 'pic.png',
            mimeType: 'image/png',
            sizeDisplay: '1 KB',
            previewText: null,
            dataUri: 'data:image/png;base64,AAA',
          },
        ],
      }),
    ).toThrow(/does not accept image attachments/i);
  });
});

describe('execution backends are explicit', () => {
  test('remote, ollama and embedded backends are distinguishable', () => {
    expect(providerFromType('GEMINI').backend).toBe('REMOTE');
    expect(providerFromType('OLLAMA').backend).toBe('OLLAMA');
    expect(providerFromType('INSTANCE').backend).toBe('REMOTE');
  });
});
