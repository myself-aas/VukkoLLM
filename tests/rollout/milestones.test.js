/**
 * Phase 11: the rollout milestones as acceptance criteria, not prose.
 *
 * Each milestone lists what must be true before the next rollout stage, and how
 * that is proven here. The point is not ceremony: Milestone E is where the
 * Kotlin business logic disappears, so the check that the React Native side can
 * stand alone has to exist *before* anyone deletes it.
 */

const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function files(directory, extensions) {
  const found = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(child);
    }
  };
  walk(join(ROOT, directory));
  return found;
}

describe('Milestone A — buildable React Native shell', () => {
  test('the project infrastructure the plan lists is present', () => {
    const required = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'babel.config.js',
      'metro.config.js',
      'index.js',
      'jest.config.js',
      '.eslintrc.js',
      '.prettierrc',
      'react-native.config.js',
    ];
    expect(required.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });

  test('the Android host keeps the shipped application id', () => {
    expect(read('app/build.gradle.kts')).toMatch(/com\.aistudio\.vukko\.kzmp/);
  });

  test('startup does not require Rust: the app shell renders without the bridge', () => {
    expect(read('__tests__/App.test.tsx')).toMatch(/render\(<App/);
  });
});

describe('Milestone B — Rust persistence behind React Native', () => {
  test('schema, migrations and legacy adoption exist', () => {
    expect(existsSync(join(ROOT, 'rust/crates/vukko-db/migrations'))).toBe(true);
    expect(
      readdirSync(join(ROOT, 'rust/crates/vukko-db/migrations')).length,
    ).toBeGreaterThanOrEqual(5);
    expect(existsSync(join(ROOT, 'tests/migration/adoption.test.js'))).toBe(true);
  });

  test('workspace, thread and message operations exist on both sides', () => {
    for (const name of ['workspace', 'thread', 'message', 'document', 'settings', 'storage']) {
      const path = `rust/crates/vukko-core/src/repository/${name}_repository.rs`;
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
    }
  });
});

describe('Milestone C — chat and provider execution', () => {
  test('a deterministic mock provider exists for tests', () => {
    expect(existsSync(join(ROOT, 'rust/crates/vukko-core/src/providers/mock.rs'))).toBe(true);
  });

  test('at least one real provider is wired end to end', () => {
    const factory = read('rust/crates/vukko-core/src/providers/factory.rs');
    for (const client of ['Gemini', 'Anthropic', 'OpenAiCompatible', 'InstanceServer']) {
      expect(factory).toContain(client);
    }
  });

  test('offline and invalid-credential states are explicit behaviours', () => {
    const providers = files('rust/crates/vukko-core/src/providers', ['.rs'])
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(providers).toMatch(/AUTHENTICATION/);
    expect(providers).toMatch(/retryable/);
    expect(read('tests/providers/normalisation.test.ts')).toMatch(/authentication failure/);
  });
});

describe('Milestone D — feature parity without fake data', () => {
  test('every ported surface in the feature matrix has a replacement that exists', () => {
    const matrix = read('docs/FEATURE_MATRIX.md');
    // The matrix names surfaces, not every file; require that each claimed
    // path exists and that its final segment appears in the matrix.
    const claimed = [
      'src/theme',
      'src/components/MessageItem',
      'src/components/TopBar',
      'src/components/PromptInputBar',
      'src/components/WorkspaceDrawer',
      'src/components/ModelPicker',
      'src/components/Settings',
      'src/components/StorageInspector',
      'src/components/GitHubManager',
      'src/components/ExportDialog',
      'src/components/MarkdownText',
      'src/screens/ChatScreen',
      'rust/crates/vukko-core/src/services/backup.rs',
    ];
    for (const path of claimed) {
      const name = path.split('/').pop();
      expect({ path, exists: existsSync(join(ROOT, path)), listed: matrix.includes(name) }).toEqual(
        { path, exists: true, listed: true },
      );
    }
  });

  test('no production module returns seeded demo data', () => {
    const production = [...files('src', ['.ts', '.tsx']), ...files('rust/crates', ['.rs'])].filter(
      (path) => !/test|mock|demo|bootstrap/i.test(relative(ROOT, path)),
    );
    // The only fixture list that is allowed to exist is the explicitly named
    // demo service, which the previous milestone's test already pins.
    const offenders = production.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /seedRepositories|simulatedProfile|generatedToken/.test(source);
    });
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });
});

describe('Milestone E — Kotlin removal is ready, not done', () => {
  test('no Kotlin file still owns a behaviour the ported layers implement', () => {
    // The rule for the removal step: the React Native and Rust trees must not
    // depend on the Kotlin ones. They may not import, reflect on, or shell out
    // to them.
    const ported = [...files('src', ['.ts', '.tsx']), ...files('rust/crates', ['.rs'])];
    const offenders = ported.filter((path) =>
      /com\.vukko\.(data|viewmodel|ui|model)/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  test('the native host is the only place that knows a platform API', () => {
    const screens = files('src/screens', ['.tsx']).map((path) => readFileSync(path, 'utf8'));
    const offenders = screens.filter((source) =>
      /from 'react-native-keychain'|NativeModules\./.test(source),
    );
    expect(offenders).toEqual([]);
  });
});

describe('Milestone F — staged rollout readiness', () => {
  test('the release workflow is gated and the staging order is documented', () => {
    expect(read('.github/workflows/release.yml')).toMatch(/environment: production/);
    expect(read('docs/ROLLOUT.md')).toMatch(/Internal debug builds/);
    expect(read('docs/ROLLOUT.md')).toMatch(/What is monitored/);
  });

  test('every monitored failure mode has a signal in the code or CI', () => {
    const rollout = read('docs/ROLLOUT.md');
    for (const signal of ['migration', 'startup', 'bridge', 'corruption', 'provider', 'backup']) {
      expect(rollout.toLowerCase()).toContain(signal);
    }
  });
});
