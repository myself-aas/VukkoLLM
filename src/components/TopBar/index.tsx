import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';

export interface TopBarProps {
  workspaceName: string;
  modelLabel: string;
  /** True when the selected model runs on the device or the LAN. */
  isLocalModel?: boolean;
  onOpenDrawer: () => void;
  onOpenModelPicker: () => void;
}

/**
 * The header: which workspace, which model, and the two drawers the Compose
 * `TopBar.kt` opened. The model label doubles as the picker's trigger.
 */
export function TopBar({
  workspaceName,
  modelLabel,
  isLocalModel = false,
  onOpenDrawer,
  onOpenModelPicker,
}: TopBarProps): React.JSX.Element {
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Workspaces"
        onPress={onOpenDrawer}
        style={styles.iconButton}
      >
        <Text style={styles.icon}>☰</Text>
      </Pressable>

      <View style={styles.center}>
        <Text style={styles.workspace} numberOfLines={1}>
          {workspaceName}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose model"
          onPress={onOpenModelPicker}
        >
          <Text style={styles.model} numberOfLines={1}>
            {modelLabel}
            {isLocalModel ? ' · on-device' : ''}
          </Text>
        </Pressable>
      </View>

      <View style={styles.iconButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  center: { flex: 1, alignItems: 'center' },
  workspace: { ...typography.title, color: colors.textPrimary },
  model: { ...typography.label, color: colors.accent, paddingVertical: 2 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  icon: { color: colors.textPrimary, fontSize: 20 },
});
