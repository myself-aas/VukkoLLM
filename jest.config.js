module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/rust/'],
  // Node's built-in SQLite (used by the migration fixture tests) is still an
  // experimental API and prints an ExperimentalWarning on import.
  silent: false,
  transformIgnorePatterns: [
    'node_modules/(?!(?:' +
      [
        '(?:jest-)?react-native',
        '@react-native(?:-community)?',
        '@react-navigation',
        'react-native-screens',
        'react-native-safe-area-context',
        'react-native-gesture-handler',
        'react-native-reanimated',
        'react-native-markdown-display',
      ].join('|') +
      ')/)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
