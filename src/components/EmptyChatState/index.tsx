import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';

/**
 * The quick actions the empty chat screen offers. The ids are stable: they are
 * the values the composer forwards to the chat service.
 */
export const QUICK_ACTIONS = [
  { id: 'SUMMARISE_DOCUMENT', label: 'Summarise a document' },
  { id: 'EXPLAIN_CODE', label: 'Explain this code' },
  { id: 'SEARCH_WORKSPACE', label: 'Search my workspace' },
  { id: 'BRAINSTORM', label: 'Brainstorm with me' },
] as const;

export type QuickActionId = (typeof QUICK_ACTIONS)[number]['id'];

export interface EmptyChatStateProps {
  workspaceName: string;
  onQuickAction: (action: QuickActionId) => void;
}

/** The empty transcript: what this workspace is for, and how to start. */
export function EmptyChatState({
  workspaceName,
  onQuickAction,
}: EmptyChatStateProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{workspaceName}</Text>
      <Text style={styles.subtitle}>
        Everything you write here stays on this device. Nothing is sent anywhere until you pick a
        model.
      </Text>
      <View style={styles.actions}>
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onQuickAction(action.id)}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title: { ...typography.display, color: colors.textPrimary },
  subtitle: { ...typography.bodyMedium, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  action: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionLabel: { ...typography.bodySmall, color: colors.accent },
});
