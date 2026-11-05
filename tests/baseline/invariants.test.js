/**
 * Step 0.3 invariants, enforced statically against the Kotlin sources.
 *
 * Each test names the invariant it protects from MIGRATION_PLAN.md §3 Step 0.3.
 * These run in Node against the tracked files, so they hold for both the Kotlin
 * and the React Native/Rust implementations: the values below may not drift.
 */

const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { join, relative } = require('node:path');

const repoRoot = join(__dirname, '..', '..');
const kotlinRoot = join(repoRoot, 'app', 'src', 'main', 'java', 'com', 'vukko');
const gradleFile = join(repoRoot, 'app', 'build.gradle.kts');
const manifestFile = join(repoRoot, 'app', 'src', 'main', 'AndroidManifest.xml');

function read(path) {
  return readFileSync(path, 'utf8');
}

function walk(dir, extensions) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const kotlinFiles = () => walk(kotlinRoot, ['.kt']);

function kotlinSource(relPath) {
  return read(join(kotlinRoot, relPath));
}

describe('invariant: application identity is preserved', () => {
  test('applicationId stays com.aistudio.vukko.kzmp', () => {
    expect(read(gradleFile)).toMatch(/applicationId\s*=\s*"com\.aistudio\.vukko\.kzmp"/);
  });

  test('namespace, minSdk 26 and compile/target SDK 36 are unchanged', () => {
    const gradle = read(gradleFile);
    expect(gradle).toMatch(/namespace\s*=\s*"com\.vukko"/);
    expect(gradle).toMatch(/minSdk\s*=\s*26/);
    expect(gradle).toMatch(/compileSdk\s*=\s*36/);
    expect(gradle).toMatch(/targetSdk\s*=\s*36/);
  });

  test('debug and release signing configuration is preserved', () => {
    const gradle = read(gradleFile);
    expect(gradle).toMatch(/create\("debugConfig"\)/);
    expect(gradle).toMatch(/storeFile = file\(\"\$\{rootDir\}\/debug\.keystore\"\)/);
    expect(gradle).toMatch(/keyAlias = "androiddebugkey"/);
    // Release builds keep a signing path defined in Gradle; the release keystore
    // itself never enters the repository (see .gitignore: *.keystore).
    expect(gradle).toMatch(/release \{/);
  });

  test('launcher identity and application label are unchanged', () => {
    const manifest = read(manifestFile);
    expect(manifest).toContain('android:label="@string/app_name"');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
  });

  test('the permissions the app ships with are unchanged', () => {
    const manifest = read(manifestFile);
    for (const permission of [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.USE_BIOMETRIC',
      'android.permission.RECORD_AUDIO',
    ]) {
      expect(manifest).toContain(`<uses-permission android:name="${permission}" />`);
    }
  });
});

describe('invariant: local data survives an upgrade', () => {
  test('database filename stays vukko_sovereign.db', () => {
    expect(kotlinSource('data/local/AppDatabase.kt')).toMatch(
      /DATABASE_NAME\s*=\s*"vukko_sovereign\.db"/,
    );
  });

  test('the Room database no longer falls back to destroying user data', () => {
    const source = kotlinSource('data/local/AppDatabase.kt');
    expect(source).not.toMatch(/fallbackToDestructiveMigration/);
  });

  test('Room schema export is enabled so real schemas can be used as fixtures', () => {
    expect(kotlinSource('data/local/AppDatabase.kt')).toMatch(/exportSchema\s*=\s*true/);
  });

  test('API keys and OAuth tokens are not stored in SharedPreferences', () => {
    const prefs = kotlinSource('data/PreferencesManager.kt');
    // Secret-bearing preference keys that must move to Keystore-backed storage.
    expect(prefs).not.toMatch(/"api_key_/);
    expect(prefs).not.toMatch(/"instance_api_key"/);
    expect(prefs).not.toMatch(/"github_token"/);
    expect(prefs).not.toMatch(/"github_ssh_key"/);
    expect(prefs).not.toMatch(/"github_device_code"/);
  });

  test('no Kotlin source logs credentials', () => {
    const offenders = kotlinFiles()
      .filter((file) =>
        /\bLog\.[vdiwe]\([^)]*(token|apiKey|api_key|secret|sshKey)/i.test(read(file)),
      )
      .map((file) => relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });
});

describe('invariant: domain identifiers remain stable', () => {
  test('provider identifiers are unchanged', () => {
    const source = kotlinSource('model/LLMProvider.kt');
    for (const provider of [
      'GEMINI',
      'OPENAI',
      'ANTHROPIC',
      'DEEPSEEK',
      'GROQ',
      'OLLAMA',
      'INSTANCE',
    ]) {
      expect(source).toMatch(new RegExp(`\\b${provider}\\(`));
    }
  });

  test('model identifiers are unchanged', () => {
    const source = kotlinSource('model/LLMProvider.kt');
    for (const model of [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'deepseek-chat',
      'deepseek-reasoner',
      'gpt-4o',
      'o3-mini',
      'claude-3-5-sonnet-20241022',
      'llama-3.3-70b-versatile',
      'llama3.2:latest',
      'vukko-workspace-default',
    ]) {
      expect(source).toContain(`"${model}"`);
    }
  });

  test('query mode and sender enum wire values are unchanged', () => {
    expect(kotlinSource('model/Workspace.kt')).toMatch(
      /enum class QueryMode\s*\{[\s\S]*CHAT[\s\S]*QUERY[\s\S]*AGENT/,
    );
    expect(kotlinSource('model/ChatMessage.kt')).toMatch(
      /enum class MessageSender\s*\{[\s\S]*USER[\s\S]*ASSISTANT[\s\S]*SYSTEM/,
    );
  });

  test('the bootstrap seed identifiers stay stable (they exist in shipped installs)', () => {
    const source = kotlinSource('data/DataRepository.kt');
    for (const id of [
      'ws_default',
      'ws_dev',
      'ws_research',
      'ws_agent',
      'th_default',
      'th_notes',
    ]) {
      expect(source).toContain(`"${id}"`);
    }
  });
});

describe('invariant: offline-first behaviour remains available', () => {
  test('local search over the Room database exists and stays local', () => {
    const repository = kotlinSource('data/DataRepository.kt');
    expect(repository).toMatch(/fun searchOfflineMessages/);
    expect(repository).toMatch(/fun searchOfflineThreads/);
  });

  test('backup work is scheduled by the platform scheduler, not by a UI timer', () => {
    expect(kotlinSource('data/sync/BackupManager.kt')).toMatch(/WorkManager/);
    expect(kotlinSource('data/sync/BackupManager.kt')).toMatch(/enqueueUniquePeriodicWork/);
  });
});

describe('invariant: export formats stay compatible', () => {
  test('markdown, json and plain-text exports keep their documented headers', () => {
    const repository = kotlinSource('data/DataRepository.kt');
    expect(repository).toContain('"markdown", "md" ->');
    expect(repository).toContain('"json" ->');
    expect(repository).toContain('# Vukko Chat Export (Local Sovereign Storage)');
    expect(repository).toContain('dataSovereignty');
  });
});

describe('invariant: streaming cancellation remains supported', () => {
  test('the chat executor keeps a cancellable streaming path', () => {
    const repository = kotlinSource('data/DataRepository.kt');
    expect(repository).toMatch(/isStreaming\s*=\s*true/);
    expect(repository).toMatch(/delay\(/);
  });
});
