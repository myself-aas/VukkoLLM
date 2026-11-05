/**
 * Global Jest setup.
 *
 * Native modules are mocked here rather than per test so component tests stay
 * about behaviour. Every mock below mirrors the real module's public surface:
 * a test that passes against a missing export is a test of nothing.
 */

// ---------------------------------------------------------------- navigation
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }) => React.createElement(View, null, children),
    SafeAreaView: View,
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

jest.mock('react-native-screens', () => {
  const actual = jest.requireActual('react-native-screens');
  return { ...actual, enableScreens: jest.fn() };
});

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return { GestureHandlerRootView: View };
});

// --------------------------------------------------------------- native deps
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
  ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode' },
  setGenericPassword: jest.fn(async () => ({ service: 'vukko' })),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => []),
  types: { allFiles: 'public.item' },
}));

// The bridge module is generated from src/native/specs; tests replace it with
// a controllable fake through __tests__/support/fakeNativeModule.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return actual;
});

global.__DEV__ = true;
