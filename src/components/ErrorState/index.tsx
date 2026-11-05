import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';
import type { ErrorCode, VukkoError } from '../../types/errors';

/**
 * What the user can do about each failure.
 *
 * The Kotlin app swallowed provider failures and showed a plausible answer
 * instead. Now a failure is always visible, and always carries a next step:
 * an error the user cannot act on is only slightly better than no error.
 */
const ADVICE: Record<ErrorCode, string> = {
  NETWORK: 'Check your connection and try again.',
  AUTHENTICATION: 'Add or replace the API key in Settings.',
  VALIDATION: 'Shorten the prompt or start a new thread.',
  NOT_FOUND: 'Pick another model in the model picker.',
  NOT_INITIALIZED: 'Reopen the app so storage can start.',
  STORAGE: 'Free up space, then retry.',
  CANCELLED: 'The request was cancelled.',
  UNSUPPORTED: 'This model cannot do that; choose another one.',
};

export interface ErrorStateProps {
  error: VukkoError;
  /**
   * What "Retry" does. Omitted when there is nothing to retry: a retry that
   * resends nothing is a button that fails silently, which is worse than no
   * button at all. `retryable` alone is not enough to justify showing one.
   */
  onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{error.message}</Text>
      <Text style={styles.advice}>{ADVICE[error.code]}</Text>
      {error.retryable && onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  title: { ...typography.title, color: colors.error },
  message: { ...typography.bodyMedium, color: colors.textPrimary },
  advice: { ...typography.bodySmall, color: colors.textSecondary },
  retry: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryLabel: { ...typography.label, color: colors.background, fontWeight: '600' },
});
