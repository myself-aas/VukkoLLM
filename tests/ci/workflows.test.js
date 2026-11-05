/**
 * Phase 10: CI is part of the deliverable, so it is tested like one.
 *
 * The plan asks for a specific set of workflows and jobs. A workflow that is
 * missing, that omits a gate, or that silently tolerates a failure is the same
 * class of defect as an untested function — and it is worse, because nobody
 * reads YAML. These tests read the workflow files and assert the gates exist,
 * are wired to the right commands, and cannot be skipped.
 */

const { existsSync, readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const ROOT = join(__dirname, '..', '..');

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

describe('the toolchain every workflow needs', () => {
  test('the Node version file every workflow reads is committed', () => {
    // `setup-node` fails the whole job when `node-version-file` is missing, and
    // the failure happens before any step of ours runs: ten red checks that say
    // nothing about the code. A file that exists locally but is git-ignored
    // looks present to every local test and is absent on a runner.
    // Every workflow, not just the ones the plan names: a template workflow is
    // still a check that runs on every pull request.
    const pinned = readdirSync(WORKFLOWS).filter((name) =>
      /node-version-file:\s*\S+/.test(read(name)),
    );
    expect(pinned.length).toBeGreaterThan(0);

    for (const name of pinned) {
      const match = /node-version-file:\s*(\S+)/.exec(read(name));
      const file = match[1];
      const tracked = execFileSync('git', ['ls-files', '--error-unmatch', file], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      expect(`${file} is tracked: ${tracked.trim() === file}`).toBe(`${file} is tracked: true`);
    }
  });

  test('the pinned Node version satisfies the engine the package declares', () => {
    const pinned = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
    const { engines } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const minimum = Number(/>=([0-9]+)/.exec(engines.node)[1]);
    expect(Number(pinned.split('.')[0])).toBeGreaterThanOrEqual(minimum);
  });
});

describe('workflows only run what this repository has', () => {
  test('a workflow that runs a script ships that script', () => {
    // These files arrive from a project template, and a template can reference
    // things the repository never had: scripts/translations/verify.mjs and
    // App.tsx were both missing while their workflow ran on every pull request.
    // A permanently red check is not a failing gate, it is noise that teaches
    // reviewers to ignore red.
    const offenders = [];
    for (const name of readdirSync(WORKFLOWS)) {
      const yaml = read(name);
      for (const match of yaml.matchAll(
        /run:\s+(?:node|npx tsx|ts-node)\s+([\w./-]+\.(?:mjs|cjs|js|ts))/g,
      )) {
        const script = match[1];
        if (!existsSync(join(ROOT, script))) offenders.push(`${name}: ${script}`);
      }
      // `paths:` filters must name directories that exist, or the workflow can
      // never trigger. `pull_request` branches and step filters are not paths.
      const paths = /^\s*paths:\n((?:\s+- .*\n)+)/gm;
      for (const block of yaml.matchAll(paths)) {
        for (const quoted of block[1].matchAll(/'([^']+)'/g)) {
          const directory = quoted[1].replace(/\/\*+$/, '');
          if (!existsSync(join(ROOT, directory))) {
            offenders.push(`${name}: path filter ${directory}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('failure diagnostics', () => {
  test('the uploaded fixture path is where the fixture script writes', () => {
    // The build script owns the output directory; a workflow that guesses it
    // uploads nothing, and `if-no-files-found: ignore` hides that.
    const build = readFileSync(join(ROOT, 'scripts', 'build-fixtures.cjs'), 'utf8');
    const written = /['"]([\w./]*fixtures[\w./]*)['"]/.exec(build);
    const workflow = read('migration-tests.yml');
    const upload =
      /Upload the fixture database on failure[\s\S]*?path:\s*([\s\S]*?)if-no-files-found/;
    const block = upload.exec(workflow);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/fixtures\/out\/\*\.db/);
    expect(block[1]).toContain('fixtures/out');
    expect(written).not.toBeNull();
  });

  test('a missing upload is an error, not a shrug', () => {
    expect(read('migration-tests.yml')).toMatch(/if-no-files-found:\s*error/);
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

describe('the packaging contract', () => {
  const read = (path) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

  test('the Rust toolchain is pinned in one place the workflow agrees with', () => {
    const toolchain = read('rust/rust-toolchain.toml');
    const workflow = read('.github/workflows/rust.yml');
    const pinned = /channel = "(\d+\.\d+\.\d+)"/.exec(toolchain)?.[1];
    expect(pinned).toBeTruthy();
    expect(workflow).toContain(`RUST_VERSION: ${pinned}`);
  });

  test('the pinned Rust version is the floor the graph actually needs', () => {
    // The pin is not a preference. A lower number does not build slower, it does
    // not build: `getrandom 0.4` needs Cargo's edition2024 support (1.85+) and
    // `uuid 1.29` declares `rust-version = 1.89`, which is how 1.79 was found to
    // be unable to parse a transitive dependency's manifest at all.
    const pinned = /channel = "(\d+)\.(\d+)\.(\d+)"/.exec(read('rust/rust-toolchain.toml'));
    const major = Number(pinned[1]);
    const minor = Number(pinned[2]);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(89);

    // The workspace floor and the pin are the same statement, said twice; a
    // divergence means one of them is stale and only CI would notice.
    expect(read('rust/Cargo.toml')).toContain(`rust-version = "${major}.${minor}"`);

    // Crates inherit the workspace floor rather than repeating it: a crate that
    // hard-codes its own version is exactly how the two drift apart.
    for (const crate of ['vukko-core', 'vukko-db', 'vukko-bridge']) {
      expect(read(`rust/crates/${crate}/Cargo.toml`)).toContain('rust-version.workspace = true');
    }
  });

  test('clippy denies warnings without denying its optional advice', () => {
    // `-D warnings` covers the default groups, which is the gate. It must not
    // start denying `clippy::pedantic`: the crates opt into pedantic as a warn
    // so the suggestions are visible, and denying them turns doc-backtick and
    // "# Errors section" advice into build failures.
    const clippy = /cargo clippy[^\n]*/.exec(read('.github/workflows/rust.yml'))?.[0] ?? '';
    expect(clippy).toContain('-D warnings');
    expect(clippy).not.toMatch(/pedantic/);
  });

  test('the packaging guide names every target the plan requires', () => {
    const guide = read('rust/README.md');
    for (const target of [
      'aarch64-linux-android',
      'armv7-linux-androideabi',
      'x86_64-linux-android',
      'aarch64-apple-ios',
      'aarch64-apple-ios-sim',
    ]) {
      expect(`${target}: ${guide.includes(target)}`).toBe(`${target}: true`);
    }
    expect(guide).toMatch(/jniLibs/);
    expect(guide).toMatch(/XCFramework/);
  });

  test('the workspace crates match the documented layout', () => {
    const workspace = read('rust/Cargo.toml');
    for (const member of ['vukko-core', 'vukko-db', 'vukko-bridge']) {
      expect(workspace).toContain(`crates/${member}`);
    }
  });
});
