import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';
import type { ExportFormat } from '../../types/export';

const FORMATS: Array<{ format: ExportFormat; label: string; hint: string }> = [
  { format: 'markdown', label: 'Markdown', hint: 'Readable, with headings and code fences' },
  { format: 'json', label: 'JSON', hint: 'Every message and its metadata' },
  { format: 'text', label: 'Plain text', hint: 'Just the conversation' },
];

export interface ExportDialogProps {
  visible: boolean;
  onExport: (format: ExportFormat) => void;
  onClose: () => void;
}

/**
 * Export chooser. Exactly the three formats the Rust exporter writes — offering
 * a fourth here would only produce an error after the tap.
 */
export function ExportDialog({
  visible,
  onExport,
  onClose,
}: ExportDialogProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="export-dialog">
          <Text style={styles.title}>Export this thread</Text>
          {FORMATS.map((entry) => (
            <Pressable
              key={entry.format}
              accessibilityRole="button"
              accessibilityLabel={entry.label}
              onPress={() => onExport(entry.format)}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>{entry.label}</Text>
              <Text style={styles.rowHint}>{entry.hint}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    padding: spacing.xl,
  },
  sheet: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.sheet,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.headline, color: colors.textPrimary },
  row: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    gap: 2,
  },
  rowLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  rowHint: { ...typography.bodySmall, color: colors.textSecondary },
  cancel: {
    ...typography.title,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.sm,
  },
});
