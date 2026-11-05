import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { colors, fontFamily, radii, spacing, typography } from '../../theme';

export interface MarkdownTextProps {
  content: string;
  testID?: string;
}

/**
 * Assistant answers are Markdown, and the Compose `MarkdownText.kt` rendered
 * headings, lists and fenced code. This is the same surface: one component, one
 * style map, so a fenced block looks identical in a chat row and in a citation.
 *
 * The renderer is `react-native-markdown-display`; the style rules below are
 * the only place its output is coloured, which keeps the theme authoritative.
 */
export function MarkdownText({ content, testID }: MarkdownTextProps): React.JSX.Element {
  return (
    <View testID={testID}>
      <Markdown style={styles}>{content}</Markdown>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.bodyLarge, color: colors.textPrimary },
  heading1: { ...typography.headline, color: colors.textPrimary, marginVertical: spacing.sm },
  heading2: { ...typography.title, color: colors.textPrimary, marginVertical: spacing.sm },
  heading3: { ...typography.title, color: colors.textSecondary, marginVertical: spacing.xs },
  paragraph: { marginVertical: spacing.xs },
  strong: { fontWeight: '700', color: colors.textPrimary },
  em: { fontStyle: 'italic', color: colors.textSecondary },
  link: { color: colors.accent },
  bullet_list: { marginVertical: spacing.xs },
  ordered_list: { marginVertical: spacing.xs },
  list_item: { marginVertical: 2 },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accentMuted,
    paddingLeft: spacing.sm,
    marginVertical: spacing.xs,
  },
  code_inline: {
    fontFamily: fontFamily.mono,
    backgroundColor: colors.surfaceElevated,
    color: colors.accent,
    paddingHorizontal: 4,
    borderRadius: radii.sm,
  },
  code_block: {
    fontFamily: fontFamily.mono,
    backgroundColor: colors.surfaceElevated,
    color: colors.textPrimary,
    padding: spacing.md,
    borderRadius: radii.card,
    marginVertical: spacing.sm,
  },
  fence: {
    fontFamily: fontFamily.mono,
    backgroundColor: colors.surfaceElevated,
    color: colors.textPrimary,
    padding: spacing.md,
    borderRadius: radii.card,
    marginVertical: spacing.sm,
  },
  table: { borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm },
  th: { ...typography.label, color: colors.textSecondary },
  td: { ...typography.bodySmall, color: colors.textPrimary },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: spacing.md },
});

/** Plain text, for rows that must not render markup (the user's own turn). */
export function PlainText({ content }: { content: string }): React.JSX.Element {
  return <Text style={styles.body}>{content}</Text>;
}
