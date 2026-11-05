import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';
import type { ChatMessage } from '../../types/chat';
import type { VukkoError } from '../../types/errors';

export interface MessageItemProps {
  message: ChatMessage;
  /** The request failed: show the error where the answer would have been. */
  error?: VukkoError | null;
}

/**
 * One transcript row.
 *
 * Presentational only: it renders what the store gives it and raises nothing.
 * Reasoning is collapsed by default — it is diagnostic prose, not the answer —
 * and the streaming indicator is a testable node so the list can assert that a
 * row is still being written.
 */
export function MessageItem({ message, error }: MessageItemProps): React.JSX.Element {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const isUser = message.sender === 'USER';

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      <Text style={styles.sender}>{isUser ? 'You' : 'Vukko'}</Text>

      {message.isAgentExecution && message.agentSteps.length > 0 ? (
        <View style={styles.agentSteps} testID="agent-steps">
          {message.agentSteps.map((step) => (
            <Text key={`${step.stepIndex}-${step.toolName}`} style={styles.agentStep}>
              {step.title}
            </Text>
          ))}
        </View>
      ) : null}

      {message.thinking ? (
        <View style={styles.reasoning}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reasoning"
            onPress={() => setReasoningOpen((open) => !open)}
          >
            <Text style={styles.reasoningToggle}>
              {reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
              {message.thinkingDurationMs === null
                ? ''
                : ` · ${(message.thinkingDurationMs / 1000).toFixed(1)}s`}
            </Text>
          </Pressable>
          {reasoningOpen ? <Text style={styles.reasoningBody}>{message.thinking}</Text> : null}
        </View>
      ) : null}

      {message.content.length > 0 ? <Text style={styles.content}>{message.content}</Text> : null}
      {message.isStreaming ? <View testID="streaming-indicator" style={styles.streaming} /> : null}

      {message.citations.length > 0 ? (
        <View style={styles.citations}>
          {message.citations.map((citation) => (
            <View key={`${citation.title}-${citation.source}`} style={styles.citation}>
              <Text style={styles.citationTitle}>{citation.title}</Text>
              <Text style={styles.citationSource}>{citation.source}</Text>
              <Text style={styles.citationSnippet}>{citation.snippet}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <View style={styles.error} testID="message-error">
          <Text style={styles.errorText}>{error.message}</Text>
          {error.retryable ? <Text style={styles.errorHint}>Try again</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, gap: spacing.xs },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  sender: { ...typography.label, color: colors.textSecondary, textTransform: 'uppercase' },
  content: { ...typography.bodyLarge, color: colors.textPrimary },
  streaming: { width: 12, height: 12, borderRadius: radii.pill, backgroundColor: colors.accent },
  reasoning: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.sm,
    gap: spacing.xs,
  },
  reasoningToggle: { ...typography.label, color: colors.accent },
  reasoningBody: { ...typography.bodySmall, color: colors.textSecondary, fontStyle: 'italic' },
  citations: { gap: spacing.xs, marginTop: spacing.xs },
  citation: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  citationTitle: { ...typography.bodySmall, color: colors.accent },
  citationSource: { ...typography.label, color: colors.textSecondary },
  citationSnippet: { ...typography.bodySmall, color: colors.textPrimary },
  agentSteps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  agentStep: {
    ...typography.label,
    color: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
  },
  error: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.sm,
    gap: 2,
  },
  errorText: { ...typography.bodySmall, color: colors.error },
  errorHint: { ...typography.label, color: colors.textSecondary },
});
