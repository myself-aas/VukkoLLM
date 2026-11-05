import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';
import type { Workspace, WorkspaceThread } from '../../types/workspace';

export interface WorkspaceDrawerProps {
  visible: boolean;
  workspaces: Workspace[];
  threads: WorkspaceThread[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectThread: (threadId: string) => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onClose: () => void;
}

/**
 * Workspaces and their threads.
 *
 * Threads are listed newest first, matching the Compose drawer, which ordered
 * by `updatedAt` descending and pinned threads to the top.
 */
export function WorkspaceDrawer({
  visible,
  workspaces,
  threads,
  activeWorkspaceId,
  activeThreadId,
  onSelectWorkspace,
  onSelectThread,
  onOpenSettings,
  onOpenExport,
  onClose,
}: WorkspaceDrawerProps): React.JSX.Element | null {
  if (!visible) return null;

  const ordered = [...threads].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
    return right.updatedAt - left.updatedAt;
  });

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.drawer} testID="workspace-drawer">
          <Text style={styles.heading}>Workspaces</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {workspaces.map((workspace) => (
              <Pressable
                key={workspace.id}
                accessibilityRole="button"
                accessibilityLabel={workspace.name}
                onPress={() => onSelectWorkspace(workspace.id)}
                style={[styles.chip, workspace.id === activeWorkspaceId && styles.chipActive]}
              >
                <Text style={styles.chipLabel}>{workspace.name}</Text>
                <Text style={styles.chipMeta}>{workspace.documentCount} docs</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.heading}>Threads</Text>
          <ScrollView>
            {ordered.length === 0 ? (
              <Text style={styles.empty}>No threads yet.</Text>
            ) : (
              ordered.map((thread) => (
                <Pressable
                  key={thread.id}
                  accessibilityRole="button"
                  accessibilityLabel={thread.name}
                  onPress={() => onSelectThread(thread.id)}
                  style={[styles.thread, thread.id === activeThreadId && styles.threadActive]}
                >
                  <Text style={styles.threadName} numberOfLines={1}>
                    {thread.isPinned ? '📌 ' : ''}
                    {thread.name}
                  </Text>
                  <Text style={styles.threadMeta} numberOfLines={1}>
                    {thread.messageCount} messages · {thread.lastMessageSnippet ?? 'empty'}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export thread"
            onPress={onOpenExport}
          >
            <Text style={styles.settings}>Export this thread</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={onOpenSettings}
          >
            <Text style={styles.settings}>Settings</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  drawer: {
    width: '82%',
    height: '100%',
    backgroundColor: colors.surface,
    borderTopRightRadius: radii.sheet,
    borderBottomRightRadius: radii.sheet,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heading: { ...typography.label, color: colors.textSecondary, textTransform: 'uppercase' },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: colors.accent },
  chipLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  chipMeta: { ...typography.label, color: colors.textSecondary },
  thread: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing.xs,
  },
  threadActive: { backgroundColor: colors.accentMuted },
  threadName: { ...typography.bodyMedium, color: colors.textPrimary },
  threadMeta: { ...typography.bodySmall, color: colors.textSecondary },
  empty: { ...typography.bodySmall, color: colors.textSecondary },
  settings: { ...typography.title, color: colors.accent, paddingVertical: spacing.md },
});
