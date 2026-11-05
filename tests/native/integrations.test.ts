/**
 * Phase 7: the native integration boundaries.
 *
 * Every one of these modules wraps an OS capability the plan keeps platform-
 * side (biometrics, keystore, files, background work, widget, voice). The tests
 * below pin the parts that must not drift — that no biometric data is stored,
 * that secrets never reach plain SQLite or AsyncStorage, that only sandboxed
 * paths are handed to Rust, and that a backup never claims success it did not
 * have.
 */

import {
  createBiometricLock,
  createSecureStorage,
  createFileService,
  createBackupScheduler,
  createWidgetSnapshotPublisher,
  createVoiceInput,
  SECRET_NAMES,
  loadSessionPreferences,
  saveSessionPreferences,
  InMemoryPreferenceStore,
  type BiometricsModule,
  type SecureStorageModule,
  type FileModule,
  type BackgroundTaskModule,
  type VoiceModule,
} from '../../src/native/integrations';
import type { BackupResult, BackupSettings } from '../../src/types/backup';

// --------------------------------------------------------------- test doubles

function biometrics(success = true): BiometricsModule {
  return {
    isAvailable: jest.fn(async () => true),
    authenticate: jest.fn(async () => ({ success, errorCode: success ? null : 'USER_CANCEL' })),
  };
}

function secureStorage(): SecureStorageModule & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  return {
    secrets,
    getSecret: jest.fn(async (name: string) => secrets.get(name) ?? null),
    setSecret: jest.fn(async (name: string, value: string) => {
      secrets.set(name, value);
    }),
    clearAll: jest.fn(async () => {
      secrets.clear();
    }),
  };
}

function files(): FileModule {
  return {
    pickDocuments: jest.fn(async () => [
      {
        uri: 'file:///data/user/0/com.vukko/cache/paper.pdf',
        name: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
      {
        uri: 'content://com.android.providers.downloads/document/42',
        name: 'notes.md',
        mimeType: 'text/markdown',
        sizeBytes: 512,
      },
    ]),
    writeExport: jest.fn(async (fileName: string) => ({ uri: `file:///exports/${fileName}` })),
    shareFile: jest.fn(async () => undefined),
  };
}

function backgroundTasks(): BackgroundTaskModule {
  return {
    scheduleBackup: jest.fn(async () => undefined),
    cancelBackup: jest.fn(async () => undefined),
    runBackupNow: jest.fn(async () => undefined),
  };
}

describe('biometric lock', () => {
  test('only the enabled/disabled preference is remembered', async () => {
    const module = biometrics();
    const preferences = new InMemoryPreferenceStore();
    const lock = createBiometricLock({ module, preferences });

    await lock.setEnabled(true);
    expect(await lock.isEnabled()).toBe(true);
    expect(preferences.dump()).toEqual({ 'security.biometricLock': 'true' });
  });

  test('unlocking requires an authentication when the lock is enabled', async () => {
    const module = biometrics(true);
    const lock = createBiometricLock({ module, preferences: new InMemoryPreferenceStore() });
    await lock.setEnabled(true);

    await expect(lock.unlock()).resolves.toEqual({ unlocked: true, errorCode: null });
    expect(module.authenticate).toHaveBeenCalledWith({
      title: 'Unlock Vukko',
      subtitle: 'Your data stays on this device',
    });
  });

  test('a cancelled prompt leaves the app locked and says why', async () => {
    const lock = createBiometricLock({
      module: biometrics(false),
      preferences: new InMemoryPreferenceStore(),
    });
    await lock.setEnabled(true);

    await expect(lock.unlock()).resolves.toEqual({ unlocked: false, errorCode: 'USER_CANCEL' });
  });

  test('a disabled lock does not prompt at all', async () => {
    const module = biometrics(true);
    const lock = createBiometricLock({ module, preferences: new InMemoryPreferenceStore() });

    await expect(lock.unlock()).resolves.toEqual({ unlocked: true, errorCode: null });
    expect(module.authenticate).not.toHaveBeenCalled();
  });

  test('enabling the lock on a device without biometrics is refused', async () => {
    const module: BiometricsModule = {
      isAvailable: jest.fn(async () => false),
      authenticate: jest.fn(),
    };
    const lock = createBiometricLock({ module, preferences: new InMemoryPreferenceStore() });

    await expect(lock.setEnabled(true)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(await lock.isEnabled()).toBe(false);
  });
});

describe('secure storage', () => {
  test('secrets go to the keystore, never to preferences', async () => {
    const module = secureStorage();
    const preferences = new InMemoryPreferenceStore();
    const storage = createSecureStorage({ module, preferences });

    await storage.setApiKey('OPENAI', 'sk-live-abc123');
    expect(module.secrets.get(SECRET_NAMES.apiKey('OPENAI'))).toBe('sk-live-abc123');
    expect(await storage.getApiKey('OPENAI')).toBe('sk-live-abc123');

    // Nothing secret is written to the preference store.
    expect(JSON.stringify(preferences.dump())).not.toContain('sk-live-abc123');
  });

  test('a missing key reads as null rather than throwing', async () => {
    const storage = createSecureStorage({
      module: secureStorage(),
      preferences: new InMemoryPreferenceStore(),
    });
    await expect(storage.getApiKey('GEMINI')).resolves.toBeNull();
  });

  test('the GitHub token lives under its own keystore entry', async () => {
    const module = secureStorage();
    const storage = createSecureStorage({ module, preferences: new InMemoryPreferenceStore() });

    await storage.setGitHubToken('gho_token');
    expect(await storage.getGitHubToken()).toBe('gho_token');
    expect([...module.secrets.keys()]).toEqual(['github.oauthToken']);
  });

  test('disconnecting clears every secret in one call', async () => {
    const module = secureStorage();
    const storage = createSecureStorage({ module, preferences: new InMemoryPreferenceStore() });

    await storage.setApiKey('OPENAI', 'sk-1');
    await storage.setGitHubToken('gho-1');
    await storage.clearAll();

    expect(module.secrets.size).toBe(0);
  });

  test('a key written to the store is never written to the database file', async () => {
    // The guard that matters: the storage layer offers no path to SQLite.
    const storage = createSecureStorage({
      module: secureStorage(),
      preferences: new InMemoryPreferenceStore(),
    });
    expect(Object.keys(storage).sort()).toEqual(
      ['clearAll', 'getApiKey', 'getGitHubToken', 'setApiKey', 'setGitHubToken'].sort(),
    );
  });
});

describe('files and document imports', () => {
  test('only sandboxed paths reach Rust, and content URIs are copied first', async () => {
    const module = files();
    // The app-private directory: a file here is openable by the app, and by
    // the Rust library it links.
    const service = createFileService({ module, sandboxRoot: '/data/user/0/com.vukko' });

    const picked = await service.pickDocuments();

    expect(picked).toHaveLength(2);
    expect(picked[0]).toMatchObject({
      path: '/data/user/0/com.vukko/cache/paper.pdf',
      requiresCopy: false,
      kind: 'PDF',
    });
    // A content:// URI is not a path Rust can open: it is marked for copying.
    expect(picked[1]).toMatchObject({ path: null, requiresCopy: true, kind: 'MARKDOWN' });
  });

  test('an unsupported type is reported, not silently ingested', async () => {
    const module: FileModule = {
      ...files(),
      pickDocuments: jest.fn(async () => [
        {
          uri: 'file:///x/archive.zip',
          name: 'archive.zip',
          mimeType: 'application/zip',
          sizeBytes: 10,
        },
      ]),
    };
    const service = createFileService({ module, sandboxRoot: '/tmp' });

    const picked = await service.pickDocuments();
    expect(picked[0]).toMatchObject({ kind: 'UNSUPPORTED' });
  });

  test('an export is written to a shareable file', async () => {
    const module = files();
    const service = createFileService({ module, sandboxRoot: '/tmp' });

    const result = await service.writeExport('thread.md', '# Vukko', 'text/markdown');
    expect(result.uri).toBe('file:///exports/thread.md');
    await service.share('file:///exports/thread.md');
    expect(module.shareFile).toHaveBeenCalledWith('file:///exports/thread.md');
  });
});

describe('background backup', () => {
  const settings: BackupSettings = {
    enabled: true,
    frequencyHours: 24,
    target: 'GITHUB',
    repository: 'owner/repo',
    cloudBucket: '',
    lastBackupTimestamp: 0,
  };

  test('the three scheduling calls are all the UI needs', async () => {
    const module = backgroundTasks();
    const scheduler = createBackupScheduler({ module });

    await scheduler.schedule();
    await scheduler.cancel();
    await scheduler.runNow();
    await scheduler.runNow({ manual: true });

    expect(module.scheduleBackup).toHaveBeenCalledTimes(1);
    expect(module.cancelBackup).toHaveBeenCalledTimes(1);
    expect(module.runBackupNow).toHaveBeenCalledTimes(2);
  });

  test('an unsupported cloud target is never scheduled as if it worked', async () => {
    const module = backgroundTasks();
    const scheduler = createBackupScheduler({ module });

    await expect(scheduler.schedule({ ...settings, target: 'CLOUD_BUCKET' })).rejects.toMatchObject(
      { code: 'UNSUPPORTED' },
    );
    expect(module.scheduleBackup).not.toHaveBeenCalled();
  });

  test('a disabled backup is not scheduled', async () => {
    const module = backgroundTasks();
    const scheduler = createBackupScheduler({ module });

    await scheduler.schedule({ ...settings, enabled: false });
    expect(module.scheduleBackup).not.toHaveBeenCalled();
  });

  test('a backup result is reported verbatim, including UNSUPPORTED', async () => {
    const result: BackupResult = {
      status: 'UNSUPPORTED',
      fileName: null,
      workspaceCount: 0,
      checksum: null,
      completedAt: 1_700_000_000_000,
      reason: 'CLOUD_BUCKET is not implemented',
    };
    const scheduler = createBackupScheduler({ module: backgroundTasks() });

    await scheduler.report(result);
    expect(await scheduler.lastResult()).toEqual(result);
  });
});

describe('widget snapshot', () => {
  test('only the four fields the widget renders are published', async () => {
    const writer = { write: jest.fn(async () => undefined) };
    const publisher = createWidgetSnapshotPublisher({ writer });

    await publisher.publish({
      activeWorkspaceName: 'Personal',
      activeThreadTitle: 'Sovereignty',
      lastMessagePreview: 'final authority',
      updatedAt: 1_700_000_000_000,
    });

    const snapshot = writer.write.mock.calls[0]?.[0];
    expect(Object.keys(snapshot).sort()).toEqual(
      ['activeThreadTitle', 'activeWorkspaceName', 'lastMessagePreview', 'updatedAt'].sort(),
    );
  });

  test('a message preview is truncated so the snapshot stays small', async () => {
    const writer = { write: jest.fn(async () => undefined) };
    const publisher = createWidgetSnapshotPublisher({ writer });

    await publisher.publish({
      activeWorkspaceName: 'Personal',
      activeThreadTitle: 'Long',
      lastMessagePreview: 'x'.repeat(400),
      updatedAt: 1,
    });

    expect(writer.write.mock.calls[0]?.[0].lastMessagePreview.length).toBeLessThanOrEqual(120);
  });

  test('nothing is published while the app has no active thread', async () => {
    const writer = { write: jest.fn(async () => undefined) };
    const publisher = createWidgetSnapshotPublisher({ writer });

    await publisher.publishIfActive(null);
    expect(writer.write).not.toHaveBeenCalled();
  });
});

describe('voice input', () => {
  test('transcript text is returned for the composer, not sent directly', async () => {
    const module: VoiceModule = {
      requestPermission: jest.fn(async () => 'GRANTED'),
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => 'What is sovereignty?'),
    };
    const voice = createVoiceInput({ module });

    await expect(voice.transcribe()).resolves.toEqual({
      text: 'What is sovereignty?',
      error: null,
    });
  });

  test('a denied permission is an explicit error, not an empty transcript', async () => {
    const module: VoiceModule = {
      requestPermission: jest.fn(async () => 'DENIED'),
      start: jest.fn(),
      stop: jest.fn(),
    };
    const voice = createVoiceInput({ module });

    const result = await voice.transcribe();
    expect(result.text).toBeNull();
    expect(result.error).toMatchObject({ code: 'UNSUPPORTED' });
    expect(module.start).not.toHaveBeenCalled();
  });

  test('an empty transcript is reported rather than inserted', async () => {
    const module: VoiceModule = {
      requestPermission: jest.fn(async () => 'GRANTED'),
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => '   '),
    };
    const voice = createVoiceInput({ module });

    const result = await voice.transcribe();
    expect(result.text).toBeNull();
    expect(result.error).toMatchObject({ code: 'VALIDATION' });
  });
});

describe('session preferences', () => {
  test('non-secret preferences round-trip through the store', async () => {
    const store = new InMemoryPreferenceStore();
    await saveSessionPreferences(store, {
      selectedProvider: 'GEMINI',
      selectedModelId: 'gemini-2.5-flash',
      instanceUrl: 'http://10.0.2.2:3001',
    });

    await expect(loadSessionPreferences(store)).resolves.toEqual({
      selectedProvider: 'GEMINI',
      selectedModelId: 'gemini-2.5-flash',
      instanceUrl: 'http://10.0.2.2:3001',
    });
  });

  test('a stored API key is refused at the door', async () => {
    const store = new InMemoryPreferenceStore();
    store.set('selectedProvider', 'OPENAI');

    await expect(() =>
      saveSessionPreferences(store, { apiKey: 'sk-live-abc' } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
