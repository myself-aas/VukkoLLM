import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme';

export interface AppProps {
  /**
   * The startup screen. Injected so the shell can be rendered without the
   * bridge: the real host supplies `ChatScreen` wired to the native module,
   * and tests supply a stand-in.
   */
  children?: React.ReactNode;
}

/**
 * Root component.
 *
 * It owns only the startup chrome — the theme background and the accessibility
 * header — and hands the body to `children`. Keeping the shell this thin is
 * what lets the whole app be mounted in a test with a fake bridge.
 */
export default function App({ children }: AppProps = {}): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Vukko
      </Text>
      {children ?? <Text style={styles.subtitle}>Local-first AI workspace</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingTop: 8,
  },
  title: {
    ...typography.title,
    color: colors.accent,
    textAlign: 'center',
    paddingVertical: 8,
  },
  subtitle: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
