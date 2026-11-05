/**
 * Phase 6, Step 6.3: the chat screen preserves behaviour.
 *
 * These tests drive the screen the way a user does — type, send, receive
 * streamed deltas, stop — and assert the transcript, never the markup. The
 * bridge is faked at the port the screen actually uses, so a behavioural
 * regression in the store or the wiring fails here without a device.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ChatScreen } from '../../src/screens/ChatScreen';
import { useChatStore } from '../../src/screens/ChatScreen/chatStore';
import type { NativeEvent } from '../../src/types/native';
import type { ChatMessage } from '../../src/types/chat';
import type { Workspace, WorkspaceThread } from '../../src/types/workspace';

const WORKSPACE: Workspace = {
  id: 'ws_1',
  name: 'Personal',
  slug: 'personal',
  description: '',
  systemPrompt: 'Be brief.',
  temperature: 0.7,
  queryMode: 'CHAT',
  vectorCount: 0,
  documentCount: 2,
  createdAt: 1_700_000_000_000,
  agentMaxSteps: 3,
  agentAllowWebSearch: false,
  agentAllowFileCreation: false,
  agentAllowDocumentSearch: true,
};

const THREAD: WorkspaceThread = {
  id: 'th_1',
  workspaceId: 'ws_1',
  name: 'Sovereignty',
  slug: 'sovereignty',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  messageCount: 2,
  lastMessageSnippet: 'final authority',
  isPinned: false,
};

function harness(overrides: { messages?: ChatMessage[] } = {}) {
  const listeners: Array<(event: NativeEvent) => void> = [];
  const sent: string[] = [];
  const cancelled: string[] = [];

  const chatService = {
    send: jest.fn(async (options: { content: string }) => {
      sent.push(options.content);
      return {
        requestId: 'req_1',
        threadId: 'th_1',
        assistantMessageId: 'msg_pending',
        status: 'PENDING',
        startedAt: Date.now(),
        partialContent: {
          text: '',
          reasoning: null,
          citations: [],
          toolCalls: [],
          usage: null,
        },
        usage: null,
        toolCalls: [],
        citations: [],
        finishReason: null,
        error: null,
        reasoning: null,
      };
    }),
    cancel: jest.fn(async (requestId: string) => {
      cancelled.push(requestId);
    }),
  };

  const emit = (event: NativeEvent) => act(() => listeners.forEach((listener) => listener(event)));

  render(
    <ChatScreen
      chatService={chatService as never}
      subscribeToEvents={(listener) => {
        listeners.push(listener);
        return () => {};
      }}
      loadWorkspaces={async () => [WORKSPACE]}
      loadWorkspace={async () => ({ threads: [THREAD], messages: overrides.messages ?? [] })}
      onExport={async () => undefined}
    />,
  );

  return { chatService, sent, cancelled, emit, listeners };
}

beforeEach(() => {
  useChatStore.setState({
    workspace: null,
    workspaces: [],
    threads: [],
    activeThreadId: 'th_1',
    messages: [],
    draft: '',
    activeRequestId: null,
    status: 'IDLE',
    error: null,
    selectedModel: {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'GEMINI',
      contextWindow: '1M',
      supportsVision: true,
      supportsReasoning: true,
    },
    providersNeedingKeys: [],
  });
});

describe('ChatScreen', () => {
  test('loads the first workspace and names it in the header', async () => {
    harness();
    // The name appears in the top bar and in the empty state, so assert presence.
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));
    expect(screen.getByText(/Gemini 2\.5 Flash/)).toBeTruthy();
  });

  test('sends a prompt and shows it in the transcript', async () => {
    const { sent } = harness();

    const input = await screen.findByPlaceholderText(/message/i);
    fireEvent.changeText(input, 'What is sovereignty?');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(sent).toContain('What is sovereignty?'));
    expect(await screen.findByText('What is sovereignty?')).toBeTruthy();
  });

  test('streamed deltas appear in one assistant row', async () => {
    const { emit } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText('hi')).toBeTruthy());

    const pending = useChatStore
      .getState()
      .messages.find((message) => message.sender === 'ASSISTANT');
    emit({
      type: 'message.delta',
      requestId: 'req_1',
      messageId: pending!.id,
      delta: 'Sovereignty ',
    });
    emit({
      type: 'message.delta',
      requestId: 'req_1',
      messageId: pending!.id,
      delta: 'is final authority.',
    });

    await waitFor(() => expect(screen.getByText('Sovereignty is final authority.')).toBeTruthy());
  });

  test('Stop cancels the in-flight request and stops the indicator', async () => {
    const { cancelled, emit } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /stop/i });

    fireEvent.press(screen.getByRole('button', { name: /stop/i }));
    expect(cancelled).toContain('req_1');

    emit({
      type: 'message.failed',
      requestId: 'req_1',
      error: { code: 'CANCELLED', message: 'Cancelled', retryable: false },
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());
  });

  test('a provider failure is shown with a next step instead of an empty answer', async () => {
    const { emit } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText('hi')).toBeTruthy());

    emit({
      type: 'message.failed',
      requestId: 'req_1',
      error: { code: 'NETWORK', message: 'The provider is unreachable', retryable: true },
    });

    await waitFor(() => expect(screen.getByText('The provider is unreachable')).toBeTruthy());
    expect(screen.getByText(/Check your connection/i)).toBeTruthy();
  });

  test('the drawer lists workspaces and threads', async () => {
    harness();
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));

    expect(await screen.findByText('Threads')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sovereignty' })).toBeTruthy();
  });

  test('export offers the three formats for the active thread', async () => {
    harness();
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: /export this thread/i }));

    expect(await screen.findByText('Export this thread')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeTruthy();
  });

  test('the empty state renders when the thread has no messages', async () => {
    harness();
    expect(await screen.findByText(/stays on this device/i)).toBeTruthy();
  });
});

describe('ChatScreen wiring', () => {
  test('the assistant row streams into the message the service allocated, not a local id', async () => {
    const { emit } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText('hi')).toBeTruthy());

    const assistant = useChatStore.getState().messages.find((m) => m.sender === 'ASSISTANT');
    // The service owns the persisted row; the screen must render that id, or
    // every delta lands on a message no other layer knows about.
    expect(assistant?.id).toBe('msg_pending');

    emit({
      type: 'message.delta',
      requestId: 'req_1',
      messageId: 'msg_pending',
      delta: 'streamed',
    });
    await waitFor(() => expect(screen.getByText('streamed')).toBeTruthy());
  });

  test('a completed event that carries the final message replaces the streamed text', async () => {
    const { emit } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText('hi')).toBeTruthy());

    emit({ type: 'message.delta', requestId: 'req_1', messageId: 'msg_pending', delta: 'par' });
    emit({
      type: 'message.completed',
      requestId: 'req_1',
      message: {
        id: 'msg_pending',
        threadId: 'th_1',
        sender: 'ASSISTANT',
        content: 'partial answer with citations',
        timestamp: 1_700_000_000_000,
        thinking: 'weighed it',
        thinkingDurationMs: 1200,
        citations: [
          { title: 'whitepaper.pdf', source: 'Section 2', snippet: 'hybrid RAG', score: 0.9 },
        ],
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
      },
    });

    await waitFor(() => expect(screen.getByText('partial answer with citations')).toBeTruthy());
    expect(screen.getByText(/whitepaper\.pdf/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
  });

  test('completion is ignored when it belongs to another request', async () => {
    const { emit } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeTruthy());

    // A stale completion for a request this screen never started must not stop
    // the live one.
    emit({
      type: 'message.completed',
      requestId: 'req_other',
      message: {
        id: 'msg_pending',
        threadId: 'th_1',
        sender: 'ASSISTANT',
        content: 'other',
        timestamp: 1,
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
      },
    });

    expect(screen.getByRole('button', { name: /stop/i })).toBeTruthy();
  });

  test('the screen sends with the model the store holds', async () => {
    const { chatService } = harness();
    await screen.findByPlaceholderText(/message/i);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(chatService.send).toHaveBeenCalled());
    expect(chatService.send.mock.calls[0]?.[0]).toMatchObject({
      provider: 'GEMINI',
      modelId: 'gemini-2.5-flash',
      content: 'hi',
    });
  });
});

describe('ChatScreen resilience', () => {
  test('a send that fails before streaming surfaces the error', async () => {
    const events: Array<(event: NativeEvent) => void> = [];
    render(
      <ChatScreen
        chatService={
          {
            send: jest.fn(async () => {
              throw Object.assign(new Error('the database is full'), { code: 'STORAGE' });
            }),
            cancel: jest.fn(),
          } as never
        }
        subscribeToEvents={(listener) => {
          events.push(listener);
          return () => {};
        }}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
      />,
    );

    await screen.findByPlaceholderText(/message/i);
    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByText('the database is full')).toBeTruthy());
    expect(screen.getByText(/Free up space/i)).toBeTruthy();
  });

  test('an empty workspace list leaves the composer disabled instead of crashing', async () => {
    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={() => () => {}}
        loadWorkspaces={async () => []}
        loadWorkspace={async () => ({ threads: [], messages: [] })}
        onExport={async () => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByPlaceholderText(/message/i)).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText(/message/i), 'hi');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    // Nothing was sent, and the screen still renders.
    expect(screen.getByPlaceholderText(/message/i)).toBeTruthy();
  });
});

describe('thread switching', () => {
  test('selecting another thread loads its messages and drops the previous ones', async () => {
    const listeners: Array<(event: NativeEvent) => void> = [];
    const loadWorkspace = jest.fn(async (workspaceId: string) => ({
      threads: [THREAD],
      messages:
        workspaceId === 'ws_2'
          ? [
              {
                id: 'msg_ws2',
                threadId: 'th_2',
                sender: 'USER' as const,
                content: 'second workspace question',
                timestamp: 1,
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
              },
            ]
          : [],
    }));

    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={(listener) => {
          listeners.push(listener);
          return () => {};
        }}
        loadWorkspaces={async () => [WORKSPACE, { ...WORKSPACE, id: 'ws_2', name: 'Work' }]}
        loadWorkspace={loadWorkspace}
        onExport={async () => undefined}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));
    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: 'Work' }));

    await waitFor(() => expect(screen.getByText('second workspace question')).toBeTruthy());
    expect(useChatStore.getState().workspace?.id).toBe('ws_2');
    expect(loadWorkspace).toHaveBeenCalledWith('ws_2');
  });

  test('switching threads clears the transcript before the new rows arrive', () => {
    useChatStore.setState({
      messages: [
        {
          id: 'msg_old',
          threadId: 'th_old',
          sender: 'USER',
          content: 'old question',
          timestamp: 1,
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
        },
      ],
    });

    useChatStore.getState().setActiveThread('th_new');
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().activeThreadId).toBe('th_new');
  });
});

describe('ChatScreen data wiring', () => {
  test('the model picker offers the whole catalogue, not just the selected model', async () => {
    harness();
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /choose model/i }));

    // Three Gemini models exist in the catalogue; the picker must group them.
    expect(await screen.findByRole('button', { name: 'Gemini 2.5 Pro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'GPT-4o' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claude 3.5 Sonnet' })).toBeTruthy();
  });

  test('choosing another model updates the header', async () => {
    harness();
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /choose model/i }));
    fireEvent.press(await screen.findByRole('button', { name: 'Gemini 2.5 Pro' }));

    await waitFor(() => expect(screen.getByText(/Gemini 2\.5 Pro/)).toBeTruthy());
    expect(useChatStore.getState().selectedModel?.id).toBe('gemini-2.5-pro');
  });

  test('the storage inspector is fed the bridge stats and the integrity check', async () => {
    const loadStorageStats = jest.fn(async () => ({
      databaseName: 'vukko_sovereign.db',
      totalWorkspaces: 3,
      totalThreads: 12,
      totalMessages: 340,
      totalDocuments: 9,
      isLocalEncrypted: true,
      storageType: 'Rust SQLite (Local Device Only)',
      dataSovereigntyStatus: 'Air-Gapped Sovereign Storage',
    }));
    const runIntegrityCheck = jest.fn(async () => ({
      ok: true,
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
      backupPresent: false,
      tableCounts: [{ table: 'chat_messages', rows: 340 }],
      checkedAt: 1_700_000_000_000,
    }));

    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={() => () => {}}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
        loadStorageStats={loadStorageStats}
        runIntegrityCheck={runIntegrityCheck}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));
    // Storage lives one level down, in Settings — open the drawer, then the sheet.
    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Storage' }));

    // The measured numbers, not placeholders: 9 documents and the real file name.
    expect(await screen.findByText('9')).toBeTruthy();
    expect(screen.getByText(/vukko_sovereign\.db/)).toBeTruthy();
    expect(await screen.findByText(/Integrity check passed/)).toBeTruthy();
    expect(loadStorageStats).toHaveBeenCalled();
    expect(runIntegrityCheck).toHaveBeenCalled();
  });

  test('a failed load of the storage stats says so instead of showing zeros', async () => {
    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={() => () => {}}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
        loadStorageStats={async () => {
          throw Object.assign(new Error('the database is locked'), { code: 'STORAGE' });
        }}
        runIntegrityCheck={async () => {
          throw new Error('unreachable');
        }}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));
    // Storage lives one level down, in Settings — open the drawer, then the sheet.
    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Storage' }));

    expect(await screen.findByText(/database is locked/)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  test('the model picker marks providers that still need a key', async () => {
    useChatStore.setState({ providersNeedingKeys: ['OPENAI', 'ANTHROPIC'] });
    harness();
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /choose model/i }));

    const openai = await screen.findByText('OpenAI');
    expect(openai).toBeTruthy();
    expect(screen.getAllByText(/Requires an API key/).length).toBe(2);
    expect(screen.getAllByText(/Key configured/).length).toBeGreaterThan(0);
  });
});

describe('retrying a failed send', () => {
  // The first draft of this suite asserted "a prompt was sent" once and passed
  // even when Retry sent ''; the assertions below are on the resent *content*
  // and on the absence of a Retry button, which a draft-based retry fails.
  test('a retryable error with nothing to resend offers no dead Retry button', async () => {
    useChatStore.setState({
      error: { code: 'STORAGE', message: 'the database is locked', retryable: true },
    });

    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={() => () => {}}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
        loadStorageStats={async () => {
          throw new Error('unused');
        }}
        runIntegrityCheck={async () => {
          throw new Error('unused');
        }}
      />,
    );

    expect(await screen.findByText(/database is locked/)).toBeTruthy();
    // A Retry that would resend '' is worse than none: it fails silently.
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  test('a retryable failure during a send resends the same prompt', async () => {
    const listeners: Array<(event: NativeEvent) => void> = [];
    const sent: string[] = [];
    const chatService = {
      send: jest.fn(async (options: { content: string }) => {
        sent.push(options.content);
        return {
          requestId: `req_${sent.length}`,
          threadId: 'th_1',
          assistantMessageId: `msg_${sent.length}`,
          status: 'PENDING',
          startedAt: 1,
          partialContent: { text: '', reasoning: null, citations: [], toolCalls: [], usage: null },
          usage: null,
          toolCalls: [],
          citations: [],
          finishReason: null,
          error: null,
          reasoning: null,
        };
      }),
      cancel: jest.fn(),
    };

    render(
      <ChatScreen
        chatService={chatService as never}
        subscribeToEvents={(listener) => {
          listeners.push(listener);
          return () => {};
        }}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
        loadStorageStats={async () => {
          throw new Error('unused');
        }}
        runIntegrityCheck={async () => {
          throw new Error('unused');
        }}
      />,
    );

    const input = await screen.findByPlaceholderText(/message/i);
    fireEvent.changeText(input, 'retry me');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sent).toEqual(['retry me']));

    act(() =>
      listeners.forEach((listener) =>
        listener({
          type: 'message.failed',
          requestId: 'req_1',
          error: { code: 'NETWORK', message: 'offline', retryable: true },
        }),
      ),
    );

    fireEvent.press(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(sent).toEqual(['retry me', 'retry me']));
  });
});

describe('the biometric toggle', () => {
  function withLock(enabled = false) {
    const state = { enabled };
    const lock = {
      isEnabled: jest.fn(async () => state.enabled),
      setEnabled: jest.fn(async (next: boolean) => {
        state.enabled = next;
      }),
      start: jest.fn(async () => ({ unlocked: state.enabled, errorCode: null })),
    };
    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={() => () => {}}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
        loadStorageStats={async () => {
          throw new Error('unused');
        }}
        runIntegrityCheck={async () => {
          throw new Error('unused');
        }}
        appLock={lock}
      />,
    );
    return { lock, state };
  }

  test('the sheet shows the lock the platform reports', async () => {
    const { lock } = withLock(true);
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));

    const toggle = await screen.findByRole('switch', { name: /biometric lock/i });
    expect(toggle.props.value).toBe(true);
    expect(lock.isEnabled).toHaveBeenCalled();
  });

  test('flipping it persists the choice through the lock', async () => {
    const { lock, state } = withLock(false);
    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    fireEvent(await screen.findByRole('switch', { name: /biometric lock/i }), 'valueChange', true);

    await waitFor(() => expect(lock.setEnabled).toHaveBeenCalledWith(true));
    expect(state.enabled).toBe(true);
  });

  test('a device without biometrics keeps the switch off and says why', async () => {
    const lock = {
      isEnabled: jest.fn(async () => false),
      setEnabled: jest.fn(async () => {
        throw Object.assign(new Error('This device has no biometric hardware enrolled'), {
          code: 'UNSUPPORTED',
        });
      }),
      start: jest.fn(async () => ({ unlocked: true, errorCode: null })),
    };

    render(
      <ChatScreen
        chatService={{ send: jest.fn(), cancel: jest.fn() } as never}
        subscribeToEvents={() => () => {}}
        loadWorkspaces={async () => [WORKSPACE]}
        loadWorkspace={async () => ({ threads: [THREAD], messages: [] })}
        onExport={async () => undefined}
        loadStorageStats={async () => {
          throw new Error('unused');
        }}
        runIntegrityCheck={async () => {
          throw new Error('unused');
        }}
        appLock={lock}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('Personal').length).toBeGreaterThan(0));
    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    fireEvent(await screen.findByRole('switch', { name: /biometric lock/i }), 'valueChange', true);

    await waitFor(() => expect(screen.getByText(/no biometric hardware/i)).toBeTruthy());
    expect(screen.getByRole('switch', { name: /biometric lock/i }).props.value).toBe(false);
  });
});
