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
import type { AppLock } from '../../app/session';
import type { ChatService } from '../../services/chatService';
import type { NativeEvent } from '../../types/native';
import { DEFAULT_MODELS } from '../../types/provider';
import type { IntegrityCheckResult, SovereignStorageStats } from '../../types/storage';
import type { ErrorCode, VukkoError } from '../../types/errors';
import { colors, spacing, typography } from '../../theme';
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
  /** `getStorageStats()` on the bridge. Injected like every other native call. */
  loadStorageStats: () => Promise<SovereignStorageStats>;
  /** `runIntegrityCheck()` on the bridge. */
  runIntegrityCheck: () => Promise<IntegrityCheckResult>;
  /**
   * Which providers still need an API key. Optional because the host reads it
   * from secure storage, which tests and preview builds do not have; absent, the
   * picker says nothing rather than guessing.
   */
  loadProvidersNeedingKeys?: () => Promise<import('../../types/provider').ProviderType[]>;
  /**
   * The app lock. Optional: without it the Settings switch is not rendered at
   * all, because a toggle that stores a preference nothing reads is a lie.
   */
  appLock?: AppLock;
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
  loadStorageStats,
  runIntegrityCheck,
  loadProvidersNeedingKeys,
  appLock,
}: ChatScreenProps): React.JSX.Element {
  const store = useChatStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // The inspector shows measured values only: a failed read is a visible error,
  // never a grid of zeros that looks like an empty database.
  const [storage, setStorage] = useState<{
    stats: SovereignStorageStats | null;
    integrity: IntegrityCheckResult | null;
    error: VukkoError | null;
  }>({ stats: null, integrity: null, error: null });
  // The prompt of the request that failed. Retry resends *this*, never the
  // composer draft: the composer clears on send, so a draft-based retry would
  // send an empty string.
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  const [biometricLock, setBiometricLock] = useState<{
    enabled: boolean;
    error: string | null;
  }>({ enabled: false, error: null });

  const openWorkspace = async (workspaceId: string) => {
    const next = store.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!next) return;
    setDrawerOpen(false);
    // The header must name the workspace being opened, not the previous one;
    // the transcript is cleared by setActiveThread before the rows arrive.
    store.setWorkspace(next);
    store.setActiveThread(null);
    const result = await loadWorkspace(workspaceId);
    store.setThreads(result.threads);
    store.setMessages(result.messages);
  };

  const toggleBiometricLock = async (enabled: boolean) => {
    if (!appLock) return;
    try {
      await appLock.setEnabled(enabled);
      setBiometricLock({ enabled, error: null });
    } catch (cause) {
      // A device with no enrolled biometrics refuses the lock. Report it and
      // leave the switch off rather than showing an enabled lock that cannot
      // ever be opened.
      setBiometricLock({
        enabled: false,
        error: cause instanceof Error ? cause.message : 'The app lock is unavailable',
      });
    }
  };

  const openStorage = async () => {
    setSettingsOpen(false);
    setStorageOpen(true);
    setStorage({ stats: null, integrity: null, error: null });
    try {
      const [stats, integrity] = await Promise.all([loadStorageStats(), runIntegrityCheck()]);
      setStorage({ stats, integrity, error: null });
    } catch (cause) {
      // Both reads are storage reads: a code the bridge already chose is kept,
      // anything else (a programming error, a missing module) is reported as a
      // storage failure rather than dressed up as something specific.
      const code = (cause as { code?: ErrorCode }).code;
      setStorage({
        stats: null,
        integrity: null,
        error: {
          code: code === 'NOT_INITIALIZED' || code === 'STORAGE' ? code : 'STORAGE',
          message: cause instanceof Error ? cause.message : 'Storage could not be read',
          retryable: true,
        },
      });
    }
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

  // Provider readiness is a property of secure storage, not of the screen: it
  // is read once on mount and only if the host supplies the reader.
  React.useEffect(() => {
    if (!appLock) return;
    void appLock.isEnabled().then(
      (enabled) => setBiometricLock({ enabled, error: null }),
      () => setBiometricLock({ enabled: false, error: null }),
    );
  }, [appLock]);

  React.useEffect(() => {
    if (!loadProvidersNeedingKeys) return;
    void loadProvidersNeedingKeys().then(
      (providers) => useChatStore.getState().setProvidersNeedingKeys(providers),
      () => useChatStore.getState().setProvidersNeedingKeys([]),
    );
  }, [loadProvidersNeedingKeys]);

  function onEvent(event: NativeEvent) {
    switch (event.type) {
      case 'message.delta':
        useChatStore.getState().appendDelta(event.requestId, event.messageId, event.delta);
        break;
      case 'message.completed':
        useChatStore.getState().complete(event.requestId, event.message);
        break;
      case 'message.failed': {
        // Capture the prompt before the store clears the request: after `fail`
        // the transcript no longer identifies which turn failed.
        const state = useChatStore.getState();
        const failed = state.messages.find(
          (message) => message.isStreaming && message.sender === 'ASSISTANT',
        );
        if (failed) {
          const turnIndex = state.messages.indexOf(failed) - 1;
          const turn = state.messages[turnIndex];
          if (turn?.sender === 'USER') setFailedPrompt(turn.content);
        }
        useChatStore.getState().fail(event.requestId, event.error);
        break;
      }
      default:
        break;
    }
  }

  const send = async (prompt: string) => {
    const workspace = store.workspace;
    const requestPrompt = prompt.trim();
    const model = store.selectedModel;
    if (!workspace) return;
    if (!model) {
      // Never guess a provider: sending as "GEMINI by default" is how a key the
      // user never configured gets used, or a local-only workspace leaves the
      // device. The host loads the persisted model before this screen sends.
      useChatStore.getState().reportError({
        code: 'NOT_FOUND',
        message: 'Choose a model before sending',
        retryable: false,
      });
      return;
    }

    let state;
    try {
      state = await chatService.send({
        threadId: store.activeThreadId ?? '',
        content: requestPrompt,
        provider: model.provider,
        modelId: model.id,
      });
    } catch (cause) {
      // A send that fails before streaming (an empty prompt, a storage error)
      // still has to tell the user; swallowing it would leave a blank screen.
      const code = (cause as { code?: ErrorCode }).code;
      setFailedPrompt(null);
      useChatStore.getState().reportError({
        code: code === 'VALIDATION' ? 'VALIDATION' : 'STORAGE',
        message: cause instanceof Error ? cause.message : 'The message could not be sent',
        retryable: false,
      });
      return;
    }
    setFailedPrompt(null);

    // The service allocates and persists both rows, so the transcript must
    // render *those* ids: a locally invented id would receive no deltas.
    const base = {
      timestamp: state.startedAt,
      thinking: null,
      thinkingDurationMs: null,
      citations: [],
      toolsUsed: [],
      attachments: [],
      isAgentExecution: false,
      agentSteps: [],
      createdDocumentId: null,
      createdDocumentName: null,
      isFavorite: false,
      isPinned: false,
      tags: [],
    };

    useChatStore.getState().beginRequest(
      state.requestId,
      {
        ...base,
        id: `msg_local_user_${state.requestId}`,
        threadId: state.threadId,
        sender: 'USER',
        content: requestPrompt,
        isStreaming: false,
      },
      {
        ...base,
        id: state.assistantMessageId,
        threadId: state.threadId,
        sender: 'ASSISTANT',
        content: '',
        isStreaming: true,
      },
    );
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

      {store.error ? (
        <ErrorState
          error={store.error}
          onRetry={
            failedPrompt === null
              ? undefined
              : () => {
                  useChatStore.getState().clearError();
                  void send(failedPrompt);
                }
          }
        />
      ) : null}

      <FlatList
        data={store.messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <MessageItem message={item} />}
        ListEmptyComponent={
          <EmptyChatState
            workspaceName={store.workspace?.name ?? 'Vukko'}
            onQuickAction={(action) => {
              void send(String(action));
            }}
          />
        }
        contentContainerStyle={styles.list}
      />

      <PromptInputBar
        onSend={(prompt) => {
          void send(prompt);
        }}
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
        onSelectWorkspace={(workspaceId) => {
          void openWorkspace(workspaceId);
        }}
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
        models={[...DEFAULT_MODELS]}
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
        biometricLockEnabled={appLock ? biometricLock.enabled : undefined}
        biometricLockError={biometricLock.error}
        onToggleBiometricLock={
          appLock
            ? (enabled) => {
                void toggleBiometricLock(enabled);
              }
            : undefined
        }
        onOpenStorage={() => {
          void openStorage();
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
            {storage.stats ? (
              <StorageInspector stats={storage.stats} integrity={storage.integrity} />
            ) : storage.error ? (
              <ErrorState
                error={storage.error}
                onRetry={() => {
                  void openStorage();
                }}
              />
            ) : (
              <Text style={styles.modalLoading}>Reading storage…</Text>
            )}
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
  modalLoading: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  list: { flexGrow: 1, paddingVertical: 8 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay },
  modalClose: {
    color: colors.accent,
    textAlign: 'center',
    padding: 16,
  },
});
