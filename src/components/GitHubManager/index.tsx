import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { GitHubService } from '../../services/github';
import { colors, radii, spacing, typography } from '../../theme';

export interface GitHubManagerProps {
  visible: boolean;
  service?: GitHubService;
  onClose: () => void;
}

/**
 * The GitHub sheet.
 *
 * It renders the connection state the service reports, and nothing else: there
 * is no simulated profile shown while unlinked and no fixture repository list.
 * Until a real token exists the sheet says so.
 */
export function GitHubManager({
  visible,
  service,
  onClose,
}: GitHubManagerProps): React.JSX.Element | null {
  if (!visible) return null;

  const connected = service?.isConnected() ?? false;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="github-manager">
          <Text style={styles.title}>GitHub</Text>
          <Text style={styles.status}>
            {connected ? 'Connected' : 'Not connected — no repositories can be shown'}
          </Text>
          <Text style={styles.hint}>
            Vukko never shows placeholder repositories. Connecting uses GitHub's device flow, and
            the token is kept in the platform keystore.
          </Text>
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
  status: { ...typography.bodyMedium, color: colors.accent },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  close: {
    ...typography.title,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.sm,
  },
});
