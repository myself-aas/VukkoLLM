/**
 * Phase 6, Step 6.2–6.3: the presentational components.
 *
 * These are the pieces every ported screen is built from, so they are tested
 * for behaviour rather than markup: a message renders its streamed text, its
 * reasoning collapses, a citation shows its source, an error shows what the
 * user can do about it, and every control keeps its accessibility role.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MessageItem } from '../../src/components/MessageItem';
import { TopBar } from '../../src/components/TopBar';
import { PromptInputBar } from '../../src/components/PromptInputBar';
import { EmptyChatState } from '../../src/components/EmptyChatState';
import { ErrorState } from '../../src/components/ErrorState';
import { ModelPicker } from '../../src/components/ModelPicker';
import { StorageInspector } from '../../src/components/StorageInspector';
import { ExportDialog } from '../../src/components/ExportDialog';
import type { ChatMessage } from '../../src/types/chat';
import type { VukkoError } from '../../src/types/errors';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    threadId: 'th_1',
    sender: 'ASSISTANT',
    content: 'Sovereignty means final authority.',
    timestamp: 1_700_000_000_000,
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
    ...overrides,
  };
}

describe('MessageItem', () => {
  test('renders assistant content and a streaming indicator', () => {
    render(<MessageItem message={message({ isStreaming: true })} />);

    expect(screen.getByText(/Sovereignty means final authority/)).toBeTruthy();
    expect(screen.getByTestId('streaming-indicator')).toBeTruthy();
  });

  test('reasoning is collapsed by default and expands on demand', () => {
    render(
      <MessageItem
        message={message({ thinking: 'Weighing the definitions.', thinkingDurationMs: 2400 })}
      />,
    );

    expect(screen.queryByText(/Weighing the definitions/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: /reasoning/i }));

    expect(screen.getByText(/Weighing the definitions/)).toBeTruthy();
    expect(screen.getByText(/2\.4s/)).toBeTruthy();
  });

  test('renders citations with their source', () => {
    render(
      <MessageItem
        message={message({
          citations: [
            { title: 'whitepaper.pdf', source: 'Section 2', snippet: 'hybrid RAG', score: 0.91 },
          ],
        })}
      />,
    );

    expect(screen.getByText(/whitepaper\.pdf/)).toBeTruthy();
    expect(screen.getByText(/Section 2/)).toBeTruthy();
  });

  test('a user message is labelled as the sender', () => {
    render(<MessageItem message={message({ sender: 'USER', content: 'What is sovereignty?' })} />);
    expect(screen.getByText('You')).toBeTruthy();
  });

  test('a failed message shows the error instead of empty text', () => {
    render(
      <MessageItem
        message={message({ content: '', isStreaming: false })}
        error={{
          code: 'NETWORK',
          message: 'The provider is unreachable',
          retryable: true,
        }}
      />,
    );

    expect(screen.getByText(/unreachable/)).toBeTruthy();
    expect(screen.getByText(/Try again/)).toBeTruthy();
  });
});

describe('TopBar', () => {
  test('names the workspace and exposes the drawer button', () => {
    const onOpenDrawer = jest.fn();
    render(
      <TopBar
        workspaceName="Personal"
        modelLabel="Gemini 2.5 Flash"
        onOpenDrawer={onOpenDrawer}
        onOpenModelPicker={jest.fn()}
      />,
    );

    expect(screen.getByText('Personal')).toBeTruthy();
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: /workspaces/i }));
    expect(onOpenDrawer).toHaveBeenCalled();
  });

  test('a local model is marked as running on the device', () => {
    render(
      <TopBar
        workspaceName="Personal"
        modelLabel="llama3.2"
        isLocalModel
        onOpenDrawer={jest.fn()}
        onOpenModelPicker={jest.fn()}
      />,
    );
    expect(screen.getByText(/on-device/i)).toBeTruthy();
  });
});

describe('PromptInputBar', () => {
  test('sends trimmed text and clears the field', () => {
    const onSend = jest.fn();
    render(<PromptInputBar onSend={onSend} disabled={false} />);

    const input = screen.getByPlaceholderText(/message/i);
    fireEvent.changeText(input, '  What is sovereignty?  ');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('What is sovereignty?');
    expect(input.props.value).toBe('');
  });

  test('an empty prompt cannot be sent', () => {
    const onSend = jest.fn();
    render(<PromptInputBar onSend={onSend} disabled={false} />);

    fireEvent.changeText(screen.getByPlaceholderText(/message/i), '   ');
    fireEvent.press(screen.getByRole('button', { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  test('cancels a request that is already streaming', () => {
    const onCancel = jest.fn();
    render(<PromptInputBar onSend={jest.fn()} onCancel={onCancel} isStreaming disabled={false} />);

    fireEvent.press(screen.getByRole('button', { name: /stop/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('EmptyChatState', () => {
  test('offers the quick actions the Compose empty state offered', () => {
    const onQuickAction = jest.fn();
    render(<EmptyChatState workspaceName="Personal" onQuickAction={onQuickAction} />);

    fireEvent.press(screen.getByRole('button', { name: /summarise a document/i }));
    expect(onQuickAction).toHaveBeenCalledWith('SUMMARISE_DOCUMENT');
  });
});

describe('ErrorState', () => {
  const cases: Array<[VukkoError, RegExp]> = [
    [
      { code: 'NETWORK', message: 'The provider is unreachable', retryable: true },
      /Check your connection/i,
    ],
    [{ code: 'AUTHENTICATION', message: 'Invalid API key', retryable: false }, /Settings/i],
    [{ code: 'VALIDATION', message: 'Context length exceeded', retryable: false }, /shorten/i],
  ];

  test.each(cases)('code %o offers a next step', (error, advice) => {
    render(<ErrorState error={error} onRetry={jest.fn()} />);
    expect(screen.getByText(advice)).toBeTruthy();
    expect(screen.getByText(error.message)).toBeTruthy();
  });

  test('a retryable error offers a retry button and uses it', () => {
    const onRetry = jest.fn();
    render(
      <ErrorState
        error={{ code: 'NETWORK', message: 'offline', retryable: true }}
        onRetry={onRetry}
      />,
    );
    fireEvent.press(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  test('a non-retryable error offers no retry button', () => {
    render(
      <ErrorState
        error={{ code: 'AUTHENTICATION', message: 'Invalid API key', retryable: false }}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('ModelPicker', () => {
  const catalogue = [
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'GEMINI',
      contextWindow: '1M',
      supportsVision: true,
      supportsReasoning: true,
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'OPENAI',
      contextWindow: '128k',
      supportsVision: true,
      supportsReasoning: false,
    },
    {
      id: 'llama3.2:latest',
      name: 'Llama 3.2 3B (Local)',
      provider: 'OLLAMA',
      contextWindow: '8k',
      supportsVision: false,
      supportsReasoning: false,
    },
  ] as const;

  test('groups models by provider and reports the selection', () => {
    const onSelect = jest.fn();
    render(
      <ModelPicker
        visible
        models={[...catalogue]}
        needsApiKey={() => true}
        onSelect={onSelect}
        onClose={jest.fn()}
        selectedModelId="gpt-4o"
      />,
    );

    expect(screen.getByText('Google Gemini')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: /gemini 2\.5 flash/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'gemini-2.5-flash' }));
  });

  test('a model that needs a key says so', () => {
    render(
      <ModelPicker
        visible
        models={[...catalogue]}
        needsApiKey={(provider) => provider === 'OPENAI'}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        selectedModelId=""
      />,
    );
    expect(screen.getByText(/requires an API key/i)).toBeTruthy();
  });

  test('a local model is advertised as needing no key', () => {
    render(
      <ModelPicker
        visible
        models={[...catalogue]}
        needsApiKey={(provider) => provider !== 'OLLAMA'}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        selectedModelId=""
      />,
    );
    expect(screen.getByText(/runs on your device/i)).toBeTruthy();
  });

  test('the picker shows context windows so the choice is informed', () => {
    render(
      <ModelPicker
        visible
        models={[...catalogue]}
        needsApiKey={() => false}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        selectedModelId=""
      />,
    );
    expect(screen.getByText(/128k/)).toBeTruthy();
  });
});

describe('StorageInspector', () => {
  const stats = {
    databaseName: 'vukko.db',
    totalWorkspaces: 3,
    totalThreads: 12,
    totalMessages: 340,
    totalDocuments: 9,
    isLocalEncrypted: true,
    storageType: 'SQLite (Rust)',
    dataSovereigntyStatus: 'Local only',
  };

  test('reports every metric the Kotlin dialog reported', () => {
    render(<StorageInspector stats={stats} />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('340')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText(/vukko\.db/)).toBeTruthy();
  });

  test('a failed integrity check is shown as a warning, not hidden', () => {
    render(
      <StorageInspector
        stats={stats}
        integrity={{
          ok: false,
          integrityCheck: 'database disk image is malformed',
          foreignKeyViolations: 2,
          backupPresent: true,
          tableCounts: [{ table: 'chats', rows: 12 }],
          checkedAt: 1_700_000_000_000,
        }}
      />,
    );

    expect(screen.getByText(/malformed/)).toBeTruthy();
    expect(screen.getByText(/2 foreign key/)).toBeTruthy();
    expect(screen.getByText(/backup/i)).toBeTruthy();
  });
});

describe('ExportDialog', () => {
  test('offers exactly the three supported formats', () => {
    render(<ExportDialog visible onExport={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole('button', { name: /markdown/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^json$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /plain text/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pdf/i })).toBeNull();
  });

  test('reports the chosen format', () => {
    const onExport = jest.fn();
    render(<ExportDialog visible onExport={onExport} onClose={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: /^json$/i }));
    expect(onExport).toHaveBeenCalledWith('json');
  });

  test('a hidden dialog renders nothing', () => {
    render(<ExportDialog visible={false} onExport={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByTestId('export-dialog')).toBeNull();
  });
});
