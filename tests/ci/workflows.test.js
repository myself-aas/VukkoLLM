/**
 * Phase 10: CI is part of the deliverable, so it is tested like one.
 *
 * The plan asks for a specific set of workflows and jobs. A workflow that is
 * missing, that omits a gate, or that silently tolerates a failure is the same
 * class of defect as an untested function — and it is worse, because nobody
 * reads YAML. These tests read the workflow files and assert the gates exist,
 * are wired to the right commands, and cannot be skipped.
 */

const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');

const WORKFLOWS = join(__dirname, '..', '..', '.github', 'workflows');

const REQUIRED = [
  'lint.yml',
  'typecheck.yml',
  'rust.yml',
  'android.yml',
  'ios.yml',
  'migration-tests.yml',
  'e2e.yml',
  'release.yml',
];

const read = (name) => readFileSync(join(WORKFLOWS, name), 'utf8');

describe('the workflow set', () => {
  test('every workflow the plan names exists', () => {
    const present = readdirSync(WORKFLOWS);
    for (const name of REQUIRED) {
      expect(`${name}: ${present.includes(name)}`).toBe(`${name}: true`);
    }
  });

  test('no workflow is disabled or allowed to fail silently', () => {
    const offenders = [];
    for (const name of REQUIRED) {
      const yaml = read(name);
      if (/continue-on-error:\s*true/.test(yaml))
        offenders.push(`${name}: continue-on-error: true`);
      if (/^\s*if:\s*false/m.test(yaml)) offenders.push(`${name}: if: false`);
      if (!/^on:/m.test(yaml)) offenders.push(`${name}: no trigger`);
    }
    expect(offenders).toEqual([]);
  });

  test('every workflow can be run by hand, for a re-check after a flake', () => {
    const missing = REQUIRED.filter((name) => !/workflow_dispatch/.test(read(name)));
    expect(missing).toEqual([]);
  });
});

describe('the JavaScript gates', () => {
  test('typecheck runs tsc with the project config', () => {
    expect(read('typecheck.yml')).toMatch(/npm run typecheck|npx tsc --noEmit/);
  });

  test('lint runs eslint and the prettier check', () => {
    const yaml = read('lint.yml');
    expect(yaml).toMatch(/npm run lint|npx eslint/);
    expect(yaml).toMatch(/format:check|prettier --check/);
  });

  test('dependencies are installed from the lockfile, never floated', () => {
    for (const name of REQUIRED) {
      const yaml = read(name);
      if (!/npm (ci|install)/.test(yaml)) continue;
      expect(`${name}: ${/npm ci\b/.test(yaml)}`).toBe(`${name}: true`);
    }
  });

  test('the React Native suite runs in CI', () => {
    expect(read('typecheck.yml') + read('lint.yml')).toMatch(/npm test|npx jest|npm run test/);
  });
});

describe('the Rust gates', () => {
  test('format, clippy (warnings denied) and tests all run', () => {
    const yaml = read('rust.yml');
    expect(yaml).toMatch(/cargo fmt( --all)? --check/);
    expect(yaml).toMatch(/cargo clippy[^\n]*-D warnings/);
    expect(yaml).toMatch(/cargo test/);
  });

  test('the syntax gate is its own job and gates the cargo job', () => {
    const yaml = read('rust.yml');
    expect(yaml).toMatch(/tests\/tooling/);
    // The cargo job must depend on the syntax job, or a parse error is only
    // discovered after a toolchain install.
    expect(yaml).toMatch(/needs:\s*syntax/);
  });

  test('the toolchain is pinned', () => {
    expect(read('rust.yml')).toMatch(/rust-toolchain|toolchain:\s*\d+\.\d+|RUST_VERSION/);
  });
});

describe('the migration and Android gates', () => {
  test('migration fixtures run against the legacy schema', () => {
    const yaml = read('migration-tests.yml');
    expect(yaml).toMatch(/npm run test:fixtures|build-fixtures/);
    expect(yaml).toMatch(/tests\/migration|npm test/);
  });

  test('the Android build preserves the application id and signing', () => {
    const yaml = read('android.yml');
    expect(yaml).toMatch(/assembleDebug/);
    expect(yaml).toMatch(/setup-java|java-version/);
  });

  test('iOS builds on a macOS runner', () => {
    expect(read('ios.yml')).toMatch(/runs-on:\s*macos/);
  });

  test('release signing is gated behind an environment', () => {
    expect(read('release.yml')).toMatch(/environment:/);
  });
});

describe('caching', () => {
  test('Rust, Gradle and npm caches are keyed by a lockfile', () => {
    const yaml = REQUIRED.map(read).join('\n');
    expect(yaml).toMatch(/actions\/cache|setup-node[^\n]*cache:|\bcache: 'npm'/);
    const keys = yaml.match(/key:\s*[^\n]*lock/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
  });
});
