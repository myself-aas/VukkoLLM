module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: [
    'node_modules/',
    'android/',
    'ios/',
    'rust/',
    'tests/',
    'coverage/',
    // Archived RN drafts, kept for reference only (see legacy-reference/README).
    // Linting dead code to the same standard as shipped code produces warnings
    // nobody will ever fix, which is how a lint gate gets loosened for real.
    'legacy-reference/',
  ],
  rules: {
    'react-native/no-inline-styles': 'warn',
    // `void promise` is the deliberate fire-and-forget marker in this codebase:
    // it says "this promise is intentionally not awaited" at the call site, and
    // every one of them is either a UI event handler or a store notification.
    // The rule's default forbids it, which would push those calls into
    // `.catch(() => {})` or a floating promise — both worse.
    'no-void': ['error', { allowAsStatement: true }],
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
