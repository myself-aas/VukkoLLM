import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';

export interface SettingsProps {
  visible: boolean;
  biometricLockEnabled?: boolean;
  onToggleBiometricLock?: (enabled: boolean) => void;
  onOpenStorage: () => void;
  onOpenGitHub: () => void;
  onClose: () => void;
}

/**
 * General settings.
 *
 * Only settings that do something are listed: each row here maps to a stored
 * value the rest of the app reads, so the sheet never grows decorative toggles.
 */
export function Settings({
  visible,
  biometricLockEnabled = false,
  onToggleBiometricLock,
  onOpenStorage,
  onOpenGitHub,
  onClose,
}: SettingsProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="settings">
          <Text style={styles.title}>Settings</Text>

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Biometric lock</Text>
              <Text style={styles.rowHint}>Ask for your fingerprint when Vukko opens</Text>
            </View>
            <Switch
              accessibilityRole="switch"
              accessibilityLabel="Biometric lock"
              value={biometricLockEnabled}
              onValueChange={(enabled) => onToggleBiometricLock?.(enabled)}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Storage"
            onPress={onOpenStorage}
            style={styles.row}
          >
            <Text style={styles.rowLabel}>Storage</Text>
            <Text style={styles.rowHint}>Counts, integrity, backups</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="GitHub"
            onPress={onOpenGitHub}
            style={styles.row}
          >
            <Text style={styles.rowLabel}>GitHub</Text>
            <Text style={styles.rowHint}>Connect an account to browse repositories</Text>
          </Pressable>

          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.headline, color: colors.textPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  rowHint: { ...typography.bodySmall, color: colors.textSecondary },
  close: {
    ...typography.title,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.sm,
  },
});
