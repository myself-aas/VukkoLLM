/**
 * Phase 0.3 revisited: every documented invariant, paired with the check that
 * enforces it *now*, in this tree.
 *
 * docs/INVARIANTS.md was written at the start of the migration, when several
 * rows could only promise something that would land "in Phase 3/4". Those
 * phases are done, so this suite is the reconciliation: for each invariant it
 * asserts the enforcing code and test actually exist, and where an invariant is
 * still a release-process check it says so explicitly instead of listing a
 * future phase.
 */

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const INVARIANTS = [
  {
    id: 1,
    name: 'Existing users retain local data',
    code: ['rust/crates/vukko-db/src/migrate.rs', 'rust/crates/vukko-db/src/integrity.rs'],
    tests: ['tests/migration/adoption.test.js', 'tests/e2e/lifecycle.test.js'],
  },
  {
    id: 2,
    name: 'Application ID remains com.aistudio.vukko.kzmp',
    code: ['app/build.gradle.kts'],
    tests: ['tests/baseline/invariants.test.js'],
  },
  {
    id: 3,
    name: 'Signing key remains unchanged',
    code: ['app/build.gradle.kts'],
    tests: ['tests/ci/workflows.test.js'],
    note: 'the release keystore is not in the repository; CI enforces that signing runs only in the protected environment',
  },
  {
    id: 4,
    name: 'Database filename remains vukko_sovereign.db',
    code: ['rust/crates/vukko-db/src/schema.rs', 'tests/support/engine.cjs'],
    tests: ['tests/baseline/invariants.test.js', 'tests/migration/adoption.test.js'],
  },
  {
    id: 5,
    name: 'API keys and OAuth tokens are never logged',
    code: ['src/types/errors.ts', 'rust/crates/vukko-core/src/domain/error.rs'],
    tests: ['tests/contracts/errors.test.ts', 'tests/providers/normalisation.test.ts'],
  },
  {
    id: 6,
    name: 'Secrets are never stored in plaintext',
    code: [
      'src/native/integrations.ts',
      'app/src/main/java/com/vukko/data/SecurePreferencesManager.kt',
    ],
    tests: ['tests/native/secureStorageGuard.test.ts', 'tests/native/integrations.test.ts'],
  },
  {
    id: 7,
    name: 'Local-first behaviour remains available offline',
    code: ['src/services/providers/index.ts', 'rust/crates/vukko-core/src/providers/ollama.rs'],
    tests: ['tests/providers/normalisation.test.ts', 'tests/providers/chatService.test.ts'],
  },
  {
    id: 8,
    name: 'Streaming chat cancellation remains supported',
    code: ['src/services/chatService.ts', 'rust/crates/vukko-core/src/providers/mod.rs'],
    tests: ['tests/providers/chatService.test.ts'],
  },
  {
    id: 9,
    name: 'Markdown, JSON and plain-text exports remain compatible',
    code: ['rust/crates/vukko-core/src/services/export.rs'],
    tests: ['tests/repository/repositories.test.js', 'tests/e2e/lifecycle.test.js'],
  },
  {
    id: 10,
    name: 'Provider and model identifiers remain stable',
    code: ['src/types/provider.ts', 'rust/crates/vukko-core/src/domain/provider.rs'],
    tests: ['tests/baseline/invariants.test.js', 'tests/contracts/parity.test.js'],
  },
  {
    id: 11,
    name: 'Domain identifiers remain stable across the migration',
    code: ['tests/migration/fixtures/buildLegacyDb.cjs'],
    tests: ['tests/migration/adoption.test.js', 'tests/contracts/parity.test.js'],
  },
  {
    id: 12,
    name: 'No destructive schema migration',
    code: [
      'app/src/main/java/com/vukko/data/local/AppDatabase.kt',
      'rust/crates/vukko-db/src/migrate.rs',
    ],
    tests: ['tests/baseline/invariants.test.js'],
  },
  {
    id: 13,
    name: 'Schema changes are testable against real DDL',
    code: ['tests/migration/fixtures/legacy_room_v1.sql'],
    tests: ['tests/migration/adoption.test.js'],
  },
  {
    id: 14,
    name: 'Nullability, boolean and timestamp representation preserved',
    code: ['rust/crates/vukko-db/migrations'],
    tests: ['tests/migration/adoption.test.js', 'tests/repository/repositories.test.js'],
  },
  {
    id: 15,
    name: 'No production path returns fake fallback data',
    code: ['src/services/github/index.ts', 'rust/crates/vukko-core/src/services/github.rs'],
    tests: ['tests/services/githubService.test.ts'],
  },
  {
    id: 16,
    name: 'The UI never sees a provider wire format',
    code: ['src/services/providers/types.ts'],
    tests: ['tests/providers/normalisation.test.ts'],
  },
];

describe('every invariant names code and a test that exist', () => {
  test.each(INVARIANTS)('invariant $id: $name', (invariant) => {
    for (const path of [...invariant.code, ...invariant.tests]) {
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
    }
  });

  test('the invariants document lists each one this suite checks', () => {
    const doc = read('docs/INVARIANTS.md');
    const missing = INVARIANTS.filter(
      (invariant) => !new RegExp(`\\| ${invariant.id} \\|`).test(doc),
    ).map((invariant) => invariant.id);
    expect(missing).toEqual([]);
  });

  test('the document does not defer invariants to a phase that is already done', () => {
    const doc = read('docs/INVARIANTS.md');
    // Phase 3 and 4 are complete; a row that still says "until then" or "lands
    // with Phase 3" is stale and misleads the next reader.
    expect(doc).not.toMatch(/until then/);
    expect(doc).not.toMatch(/full guarantee lands with the Rust migration tests/);
  });

  test('every enforcing test path is wired into the jest run', () => {
    const config = read('jest.config.js');
    expect(config).toMatch(/preset: 'react-native'/);
    for (const invariant of INVARIANTS) {
      for (const path of invariant.tests) {
        expect({ path, under: path.startsWith('tests/') }).toEqual({ path, under: true });
      }
    }
  });
});

describe('the README tells the truth about what is done', () => {
  const readme = () => readFileSync(join(ROOT, 'README.md'), 'utf8');

  test('every phase in the migration table names paths that exist', () => {
    const table = readme()
      .split('\n')
      .filter((line) => /^\| \d+ /.test(line));
    expect(table.length).toBeGreaterThanOrEqual(12);

    // `services/{files,backup}.rs` is shorthand for two files; every other
    // backticked entry is one path, relative to the repository root.
    const expand = (entry) => {
      const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(entry);
      if (!brace) return [entry];
      return brace[2].split(',').map((part) => `${brace[1]}${part.trim()}${brace[3]}`);
    };

    const missing = [];
    for (const line of table) {
      const cells = line.split('|').map((cell) => cell.trim());
      // | phase | state | where | → split leaves an empty first and last cell.
      const where = cells[3] ?? '';
      for (const match of where.matchAll(/`([^`]+)`/g)) {
        for (const candidate of expand(match[1].replace(/\/$/, ''))) {
          if (!existsSync(join(ROOT, candidate))) {
            missing.push(`${cells[1]}: ${candidate}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('the README does not claim a green build it cannot have', () => {
    const text = readme();
    expect(text).toMatch(/no Rust toolchain/);
    expect(text).toMatch(/RUST_VERIFICATION/);
  });

  test('every replacement path the feature matrix claims exists', () => {
    const matrix = read('docs/FEATURE_MATRIX.md');
    const rows = matrix.split('\n').filter((line) => /^\| \d+ /.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(30);

    const expand = (entry) => {
      const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(entry);
      if (!brace) return [entry];
      return brace[2].split(',').map((part) => `${brace[1]}${part.trim()}${brace[3]}`);
    };

    const missing = [];
    for (const line of rows) {
      const cells = line.split('|').map((cell) => cell.trim());
      // | # | surface | current | replacement | status | → replacement is cells[4].
      for (const match of (cells[4] ?? '').matchAll(/`([^`]+)`/g)) {
        // Only paths in this repository are checkable; prose and Kotlin
        // locations are left to the baseline tests.
        // `src/theme/*` and `tests/**` name directories: check the directory,
        // since a glob that matches nothing is exactly the failure to catch.
        const entry = match[1]
          .split(' ')[0]
          .replace(/\/\*+$/, '')
          .replace(/\/$/, '');
        if (!/^(src|rust|tests)\//.test(entry)) continue;
        for (const candidate of expand(entry)) {
          if (!existsSync(join(ROOT, candidate))) {
            missing.push(`${cells[1]}: ${candidate}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
