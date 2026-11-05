import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '../../theme';

export interface PromptInputBarProps {
  onSend: (prompt: string) => void;
  /** Replaces the send button while a response is streaming. */
  onCancel?: () => void;
  isStreaming?: boolean;
  disabled: boolean;
  placeholder?: string;
}

/**
 * The composer.
 *
 * Two rules live here rather than in every screen: a prompt is trimmed before
 * it is sent (so an accidental leading newline is not a message), and an empty
 * prompt cannot be sent at all. While a response streams the primary button
 * becomes Stop, matching the Compose input bar.
 */
export function PromptInputBar({
  onSend,
  onCancel,
  isStreaming = false,
  disabled,
  placeholder = 'Message Vukko…',
}: PromptInputBarProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const canSend = value.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
  };

  return (
    <View style={styles.bar}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        multiline
        editable={!disabled}
        accessibilityLabel="Message"
      />
      {isStreaming ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={onCancel}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>Stop</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={submit}
          disabled={!canSend}
          style={[styles.action, !canSend && styles.actionDisabled]}
        >
          <Text style={styles.actionLabel}>Send</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    margin: spacing.lg,
    ...shadows.card,
  },
  input: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
    maxHeight: 140,
    paddingVertical: spacing.xs,
  },
  action: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionDisabled: { backgroundColor: colors.accentMuted },
  actionLabel: { ...typography.label, color: colors.background, fontWeight: '600' },
});
