module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['node_modules/', 'android/', 'ios/', 'rust/', 'tests/', 'coverage/'],
  rules: {
    'react-native/no-inline-styles': 'warn',
  },
  overrides: [
    {
      // Jest globals (`jest`, `describe`, `test`, `expect`) are injected at
      // runtime by the test runner, so the setup file and the suites need the
      // jest environment rather than the app one.
      files: ['jest.setup.js', 'jest.config.js', 'scripts/**', 'tests/**', '__tests__/**'],
      env: { jest: true, node: true },
      parserOptions: { sourceType: 'script' },
    },
  ],
};
