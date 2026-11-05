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
