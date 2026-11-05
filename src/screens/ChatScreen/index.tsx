import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyChatState } from '../../components/EmptyChatState';
import { ErrorState } from '../../components/ErrorState';
import { ExportDialog } from '../../components/ExportDialog';
import { GitHubManager } from '../../components/GitHubManager';
import { MessageItem } from '../../components/MessageItem';
import { ModelPicker } from '../../components/ModelPicker';
import { PromptInputBar } from '../../components/PromptInputBar';
import { Settings } from '../../components/Settings';
import { StorageInspector } from '../../components/StorageInspector';
import { TopBar } from '../../components/TopBar';
import { WorkspaceDrawer } from '../../components/WorkspaceDrawer';
import type { ChatService } from '../../services/chatService';
import type { NativeEvent } from '../../types/native';
import { colors } from '../../theme';
import { useChatStore } from './chatStore';

export interface ChatScreenProps {
  /** The chat lifecycle, injected so the screen can be tested with a fake. */
  chatService: ChatService;
  /** Subscribes to bridge events; returns the unsubscribe function. */
  subscribeToEvents: (listener: (event: NativeEvent) => void) => () => void;
  loadWorkspaces: () => Promise<import('../../types/workspace').Workspace[]>;
  loadWorkspace: (workspaceId: string) => Promise<{
    threads: import('../../types/workspace').WorkspaceThread[];
    messages: import('../../types/chat').ChatMessage[];
  }>;
  onExport: (format: import('../../types/export').ExportFormat, threadId: string) => Promise<void>;
}

/**
 * The chat screen: the Compose `ChatScreen.kt` port.
 *
 * The screen wires the store to the chat service and renders. It performs no
 * persistence and no provider calls itself, which is what keeps the behaviour
 * testable without a device.
 */
export function ChatScreen({
  chatService,
  subscribeToEvents,
  loadWorkspaces,
  loadWorkspace,
  onExport,
}: ChatScreenProps): React.JSX.Element {
  const store = useChatStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const openWorkspace = async (workspaceId: string) => {
    const result = await loadWorkspace(workspaceId);
    store.setThreads(result.threads);
    store.setMessages(result.messages);
    setDrawerOpen(false);
  };

  const openFirstWorkspace = React.useCallback(async () => {
    const workspaces = await loadWorkspaces();
    store.setWorkspaces(workspaces);
    const first = workspaces[0];
    if (!first) return;
    store.setWorkspace(first);
    const result = await loadWorkspace(first.id);
    store.setThreads(result.threads);
    store.setMessages(result.messages);
    // The screen owns the initial load; the deps are the injected loaders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One subscription for the life of the screen.
  React.useEffect(() => subscribeToEvents(onEvent), []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    void openFirstWorkspace();
  }, [openFirstWorkspace]);

  function onEvent(event: NativeEvent) {
    switch (event.type) {
      case 'message.delta':
        useChatStore.getState().appendDelta(event.requestId, event.messageId, event.delta);
        break;
      case 'message.completed':
        useChatStore.getState().complete(event.requestId, event.message.id);
        break;
      case 'message.failed':
        useChatStore.getState().fail(event.requestId, event.error);
        break;
      default:
        break;
    }
  }

  const send = async (prompt: string) => {
    const workspace = store.workspace;
    const model = store.selectedModel;
    if (!workspace) return;

    const userMessage = {
      id: `msg_local_${Date.now()}`,
      threadId: store.activeThreadId ?? '',
      sender: 'USER' as const,
      content: prompt,
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
    };
    const placeholder = {
      ...userMessage,
      id: `msg_pending_${Date.now()}`,
      sender: 'ASSISTANT' as const,
      content: '',
      isStreaming: true,
    };

    const state = await chatService.send({
      threadId: store.activeThreadId ?? '',
      content: prompt,
      provider: model?.provider ?? 'GEMINI',
      modelId: model?.id ?? 'gemini-2.5-flash',
    });

    useChatStore.getState().beginRequest(state.requestId, userMessage, placeholder);
  };

  return (
    <View style={styles.screen}>
      <TopBar
        workspaceName={store.workspace?.name ?? 'Vukko'}
        modelLabel={store.selectedModel?.name ?? 'Choose a model'}
        isLocalModel={store.selectedModel?.provider === 'OLLAMA'}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenModelPicker={() => setPickerOpen(true)}
      />

      {store.error ? <ErrorState error={store.error} onRetry={() => send(store.draft)} /> : null}

      <FlatList
        data={store.messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <MessageItem message={item} />}
        ListEmptyComponent={
          <EmptyChatState
            workspaceName={store.workspace?.name ?? 'Vukko'}
            onQuickAction={(action) => void send(String(action))}
          />
        }
        contentContainerStyle={styles.list}
      />

      <PromptInputBar
        onSend={(prompt) => void send(prompt)}
        onCancel={() => {
          if (store.activeRequestId) void chatService.cancel(store.activeRequestId);
        }}
        isStreaming={store.activeRequestId !== null}
        disabled={store.workspace === null}
      />

      <WorkspaceDrawer
        visible={drawerOpen}
        workspaces={store.workspaces}
        threads={store.threads}
        activeWorkspaceId={store.workspace?.id ?? null}
        activeThreadId={store.activeThreadId}
        onSelectWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
        onSelectThread={(threadId) => {
          store.setActiveThread(threadId);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
        onOpenSettings={() => {
          setDrawerOpen(false);
          setSettingsOpen(true);
        }}
        onOpenExport={() => {
          setDrawerOpen(false);
          setExportOpen(true);
        }}
      />

      <ModelPicker
        visible={pickerOpen}
        models={store.selectedModel ? [store.selectedModel] : []}
        needsApiKey={(provider) => store.providersNeedingKeys.includes(provider)}
        selectedModelId={store.selectedModel?.id ?? ''}
        onSelect={(model) => {
          store.setSelectedModel(model);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />

      <Settings
        visible={settingsOpen}
        onOpenStorage={() => {
          setSettingsOpen(false);
          setStorageOpen(true);
        }}
        onOpenGitHub={() => {
          setSettingsOpen(false);
          setGithubOpen(true);
        }}
        onClose={() => setSettingsOpen(false)}
      />

      <GitHubManager visible={githubOpen} onClose={() => setGithubOpen(false)} />

      {storageOpen ? (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={() => setStorageOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <StorageInspector
              stats={{
                databaseName: 'vukko.db',
                totalWorkspaces: store.workspaces.length,
                totalThreads: store.threads.length,
                totalMessages: store.messages.length,
                totalDocuments: 0,
                isLocalEncrypted: true,
                storageType: 'SQLite (Rust)',
                dataSovereigntyStatus: 'Local only',
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close storage inspector"
              onPress={() => setStorageOpen(false)}
            >
              <Text style={styles.modalClose}>Close</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}

      <ExportDialog
        visible={exportOpen}
        onExport={(format) => {
          setExportOpen(false);
          if (store.activeThreadId) void onExport(format, store.activeThreadId);
        }}
        onClose={() => setExportOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { flexGrow: 1, paddingVertical: 8 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay },
  modalClose: {
    color: colors.accent,
    textAlign: 'center',
    padding: 16,
  },
});
