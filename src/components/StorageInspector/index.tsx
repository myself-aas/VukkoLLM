import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';
import type { IntegrityCheckResult, SovereignStorageStats } from '../../types/storage';

export interface StorageInspectorProps {
  stats: SovereignStorageStats;
  integrity?: IntegrityCheckResult | null;
}

/**
 * The storage inspector.
 *
 * Two jobs: show that the data is local (counts, file name, whether it is
 * encrypted), and show the integrity check *verbatim* when it fails. Hiding a
 * failed check would defeat the point of running one.
 */
export function StorageInspector({ stats, integrity }: StorageInspectorProps): React.JSX.Element {
  const rows: Array<[string, number]> = [
    ['Workspaces', stats.totalWorkspaces],
    ['Threads', stats.totalThreads],
    ['Messages', stats.totalMessages],
    ['Documents', stats.totalDocuments],
  ];

  return (
    <ScrollView contentContainerStyle={styles.container} testID="storage-inspector">
      <Text style={styles.title}>Sovereign storage</Text>
      <Text style={styles.subtitle}>
        {stats.databaseName} · {stats.storageType} · {stats.dataSovereigntyStatus}
      </Text>
      <Text style={styles.subtitle}>
        {stats.isLocalEncrypted ? 'Encrypted at rest' : 'Not encrypted at rest'}
      </Text>

      <View style={styles.grid}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.cell}>
            <Text style={styles.value}>{String(value)}</Text>
            <Text style={styles.label}>{label}</Text>
          </View>
        ))}
      </View>

      {integrity ? (
        <View style={[styles.integrity, !integrity.ok && styles.integrityFailed]}>
          <Text style={[styles.integrityTitle, !integrity.ok && styles.integrityTitleFailed]}>
            {integrity.ok ? 'Integrity check passed' : 'Integrity check failed'}
          </Text>
          <Text style={styles.integrityBody}>{integrity.integrityCheck}</Text>
          {integrity.foreignKeyViolations > 0 ? (
            <Text style={styles.integrityBody}>
              {integrity.foreignKeyViolations} foreign key violation(s)
            </Text>
          ) : null}
          <Text style={styles.integrityBody}>
            {integrity.backupPresent
              ? 'A pre-migration backup is still on disk.'
              : 'No pre-migration backup on disk.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.headline, color: colors.textPrimary },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  cell: {
    flexBasis: '45%',
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    gap: 2,
  },
  value: { ...typography.headline, color: colors.accent },
  label: { ...typography.label, color: colors.textSecondary, textTransform: 'uppercase' },
  integrity: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
    gap: 2,
  },
  integrityFailed: { borderColor: colors.error },
  integrityTitle: { ...typography.title, color: colors.success },
  integrityTitleFailed: { color: colors.error },
  integrityBody: { ...typography.bodySmall, color: colors.textPrimary },
});
