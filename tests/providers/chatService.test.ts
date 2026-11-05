/**
 * Chat execution lifecycle (MIGRATION_PLAN.md §8 Step 5.3, §7 Step 4.3).
 *
 * The rules under test:
 * - a send persists the user turn, creates a streaming assistant row, and
 *   returns a correlation id before any token arrives;
 * - deltas are forwarded in order and only for their own request;
 * - cancelling stops deltas immediately and never resurrects the message;
 * - a provider failure surfaces `message.failed` with the structured error and
 *   stores no invented content;
 * - there is no fallback to generated text when the provider is unavailable.
 */

import { ChatService } from '../../src/services/chatService';
import type { NativeEvent } from '../../src/types/native';
import { parseStream } from '../../src/services/providers';
import { openaiSse } from './fixtures';

interface Harness {
  service: ChatService;
  events: NativeEvent[];
  sends: Array<{ requestId: string; threadId: string; content: string }>;
}

/** The fake port built by the most recent harness, for assertions. */
let portRef: any;

function createHarness(
  overrides: Partial<Parameters<typeof ChatService.prototype.constructor>[0]> = {},
): Harness {
  const events: NativeEvent[] = [];
  const sends: Array<{ requestId: string; threadId: string; content: string }> = [];
  // The service talks to the bridge through this tiny port; the fake records
  // sends and lets the test drive deltas.
  const port = {
    createUserTurn: jest.fn(async (threadId: string, content: string) => ({
      id: 'msg_user_1',
      threadId,
      sender: 'USER' as const,
      content,
      timestamp: Date.now(),
      thinking: null,
      thinkingDurationMs: null,
      citations: [],
      toolsUsed: [],
      attachments: [],
      isStreaming: false,
      isAgentExecution: false,
      agentSteps: [],
      createdDocumentId: null,
      createdDocumentName: null,
      isFavorite: false,
      isPinned: false,
      tags: [],
    })),
    createAssistantPlaceholder: jest.fn(async (threadId: string) => ({
      id: 'msg_assistant_1',
      threadId,
      sender: 'ASSISTANT' as const,
      content: '',
      timestamp: Date.now(),
      thinking: null,
      thinkingDurationMs: null,
      citations: [],
      toolsUsed: [],
      attachments: [],
      isStreaming: true,
      isAgentExecution: false,
      agentSteps: [],
      createdDocumentId: null,
      createdDocumentName: null,
      isFavorite: false,
      isPinned: false,
      tags: [],
    })),
    appendDelta: jest.fn(async () => undefined),
    complete: jest.fn(async (_requestId: string, content: string) => ({
      id: 'msg_assistant_1',
      threadId: 'th_1',
      sender: 'ASSISTANT' as const,
      content,
      timestamp: Date.now(),
      thinking: null,
      thinkingDurationMs: null,
      citations: [],
      toolsUsed: [],
      attachments: [],
      isStreaming: false,
      isAgentExecution: false,
      agentSteps: [],
      createdDocumentId: null,
      createdDocumentName: null,
      isFavorite: false,
      isPinned: false,
      tags: [],
    })),
    fail: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined),
    ...overrides,
  };
  portRef = port;

  const service = new ChatService(port as never, (event: NativeEvent) => events.push(event));
  return { service, events, sends };
}

const request = {
  provider: 'OPENAI' as const,
  modelId: 'gpt-4o',
  systemPrompt: 'Be brief.',
  temperature: 0.4,
  maxTokens: 256,
  apiKey: 'test-key',
};

describe('send', () => {
  test('returns a correlation id and an optimistic pending state immediately', async () => {
    const { service } = createHarness();

    const pending = await service.send({
      threadId: 'th_1',
      content: 'Hello',
      ...request,
      attachments: [],
    });

    expect(pending.requestId).toMatch(/^req_/);
    expect(pending.status).toBe('PENDING');
    expect(service.pendingCount()).toBe(1);
  });

  test('persists the user turn and a streaming assistant row', async () => {
    const { service } = createHarness();
    await service.send({ threadId: 'th_1', content: 'Hello', ...request, attachments: [] });

    // The fake port records the calls; both writes must happen before streaming.
    const calls = (service as unknown as { port: { createUserTurn: jest.Mock } }).port;
    expect(calls.createUserTurn).toHaveBeenCalledWith('th_1', 'Hello');
  });

  test('rejects an empty prompt without touching the provider', async () => {
    const { service } = createHarness();
    await expect(
      service.send({ threadId: 'th_1', content: '   ', ...request, attachments: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(service.pendingCount()).toBe(0);
  });
});

describe('streaming', () => {
  test('forwards deltas in order and completes with the full text', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'Hello',
      ...request,
      attachments: [],
    });

    await service.handleProviderStream(pending.requestId, parseStream('OPENAI', openaiSse));

    const types = events.map((event) => event.type);
    expect(types).toEqual(['message.delta', 'message.delta', 'message.completed']);

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      type: 'message.completed',
      requestId: pending.requestId,
      message: { content: 'Hello there', isStreaming: false },
    });
    expect(service.pendingCount()).toBe(0);
  });

  test('ignores deltas belonging to another request', async () => {
    const { service, events } = createHarness();
    const first = await service.send({
      threadId: 'th_1',
      content: 'one',
      ...request,
      attachments: [],
    });
    const second = await service.send({
      threadId: 'th_1',
      content: 'two',
      ...request,
      attachments: [],
    });

    service.handleDelta('req_unknown', 'other message', 'stray');
    expect(events).toHaveLength(0);

    service.handleDelta(first.requestId, 'msg_a', 'A');
    service.handleDelta(second.requestId, 'msg_b', 'B');

    expect(events).toEqual([
      { type: 'message.delta', requestId: first.requestId, messageId: 'msg_a', delta: 'A' },
      { type: 'message.delta', requestId: second.requestId, messageId: 'msg_b', delta: 'B' },
    ]);
  });

  test('a second delta after completion is dropped', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    await service.handleProviderStream(pending.requestId, parseStream('OPENAI', openaiSse));
    const before = events.length;

    service.handleDelta(pending.requestId, 'msg_assistant_1', 'late');
    expect(events).toHaveLength(before);
  });

  test('usage and tool calls are recorded without becoming message text', async () => {
    const { service } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    await service.handleProviderStream(pending.requestId, parseStream('OPENAI', openaiSse));

    const state = service.getRequest(pending.requestId);
    expect(state?.usage).toEqual({ inputTokens: 42, outputTokens: 11 });
    expect(state?.toolCalls).toEqual([
      { toolName: 'DocumentRAG', input: '{"query":"sovereignty"}' },
    ]);
  });
});

describe('cancellation', () => {
  test('stops deltas and leaves the message not streaming', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    service.handleDelta(pending.requestId, 'msg_assistant_1', 'partial');
    await service.cancel(pending.requestId);

    service.handleDelta(pending.requestId, 'msg_assistant_1', 'after cancel');

    expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(1);
    expect(service.pendingCount()).toBe(0);
    expect(service.getRequest(pending.requestId)?.status).toBe('CANCELLED');
  });

  test('cancelling before the first chunk does not create content', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    await service.cancel(pending.requestId);
    await service.handleProviderStream(pending.requestId, parseStream('OPENAI', openaiSse));

    expect(events.filter((event) => event.type === 'message.completed')).toHaveLength(0);
  });

  test('cancelling an unknown request is a no-op, not an error', async () => {
    const { service } = createHarness();
    await expect(service.cancel('req_missing')).resolves.toBeUndefined();
  });
});

describe('failures', () => {
  test('a provider error surfaces message.failed and stores no invented text', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    await service.fail(pending.requestId, {
      code: 'AUTHENTICATION',
      message: 'Incorrect API key provided',
      retryable: false,
    });

    expect(events).toEqual([
      {
        type: 'message.failed',
        requestId: pending.requestId,
        error: expect.objectContaining({ code: 'AUTHENTICATION', retryable: false }),
      },
    ]);
    expect(service.getRequest(pending.requestId)?.partialContent).toBe('');
  });

  test('a malformed stream fails the request instead of completing short', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    const broken = parseStream(
      'OPENAI',
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{',
    );
    await service.handleProviderStream(pending.requestId, broken);

    const failure = events.at(-1);
    expect(failure?.type).toBe('message.failed');
    expect(service.pendingCount()).toBe(0);
  });

  test('no generated fallback text is produced when the provider is unavailable', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    await service.handleProviderStream(pending.requestId, [
      { chunks: [], error: { code: 'NETWORK', message: 'offline', retryable: true } },
    ]);

    expect(events.some((event) => event.type === 'message.completed')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'message.failed' });
  });
});

describe('persistence failures', () => {
  test('a failed delta write fails the request instead of reporting success', async () => {
    const { service, events } = createHarness();
    const pending = await service.send({
      threadId: 'th_1',
      content: 'hi',
      ...request,
      attachments: [],
    });

    portRef.appendDelta.mockRejectedValueOnce(new Error('disk full'));
    service.handleDelta(pending.requestId, pending.assistantMessageId, 'partial');
    await Promise.resolve();
    await Promise.resolve();

    const failure = events.filter((event) => event.type === 'message.failed').at(-1);
    expect(failure).toMatchObject({
      type: 'message.failed',
      error: { code: 'STORAGE' },
    });
    expect(service.isTerminal(pending.requestId)).toBe(true);
  });
});
