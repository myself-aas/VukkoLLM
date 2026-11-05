import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';
import type { LLMModel, ProviderType } from '../../types/provider';
import { PROVIDERS } from '../../types/provider';

export interface ModelPickerProps {
  visible: boolean;
  models: LLMModel[];
  /** Whether choosing this provider still needs a key before it can run. */
  needsApiKey: (provider: ProviderType) => boolean;
  selectedModelId: string;
  onSelect: (model: LLMModel) => void;
  onClose: () => void;
}

/**
 * The model sheet.
 *
 * Models are grouped by provider, and each group states whether it still needs
 * a key — the Kotlin sheet let a user pick an unusable model and only found out
 * after sending, which is the failure this label removes.
 */
export function ModelPicker({
  visible,
  models,
  needsApiKey,
  selectedModelId,
  onSelect,
  onClose,
}: ModelPickerProps): React.JSX.Element {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="model-picker">
          <Text style={styles.title}>Choose a model</Text>
          <ScrollView>
            {PROVIDERS.map((provider) => {
              const group = models.filter((model) => model.provider === provider.type);
              if (group.length === 0) return null;
              const needsKey = needsApiKey(provider.type);
              return (
                <View key={provider.type} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupName}>{provider.displayName}</Text>
                    <Text style={styles.groupHint}>
                      {provider.isLocal
                        ? 'Runs on your device'
                        : needsKey
                          ? 'Requires an API key'
                          : 'Key configured'}
                    </Text>
                  </View>
                  {group.map((model) => (
                    <Pressable
                      key={model.id}
                      accessibilityRole="button"
                      accessibilityLabel={model.name}
                      onPress={() => onSelect(model)}
                      style={[styles.row, model.id === selectedModelId && styles.rowSelected]}
                    >
                      <Text style={styles.rowName}>{model.name}</Text>
                      <Text style={styles.rowMeta}>
                        {model.contextWindow}
                        {model.supportsVision ? ' · vision' : ''}
                        {model.supportsReasoning ? ' · reasoning' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </ScrollView>
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
    maxHeight: '80%',
    gap: spacing.sm,
  },
  title: { ...typography.headline, color: colors.textPrimary },
  group: { gap: spacing.xs, marginTop: spacing.md },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  groupName: { ...typography.label, color: colors.accent, textTransform: 'uppercase' },
  groupHint: { ...typography.label, color: colors.textSecondary },
  row: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowSelected: { borderColor: colors.accent },
  rowName: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.bodySmall, color: colors.textSecondary },
  close: { ...typography.title, color: colors.accent, textAlign: 'center', padding: spacing.sm },
});
