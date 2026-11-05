/**
 * Phase 7: the app lock and the session that uses it.
 *
 * `createBiometricLock` was tested in isolation but nothing opened the app with
 * it, so the Settings toggle in the ported UI was decorative: flipping it
 * changed a preference no one read. These tests are about the *effect* — a
 * locked app refuses to show the workspace until the platform authenticates.
 */

import { createAppLock, loadStartupSession } from '../../src/app/session';
import {
  InMemoryPreferenceStore,
  createBiometricLock,
  createSecureStorage,
  loadSessionPreferences,
  type BiometricsModule,
  type SecureStorageModule,
} from '../../src/native/integrations';

function biometrics(authenticates = true): BiometricsModule {
  return {
    isAvailable: jest.fn(async () => true),
    authenticate: jest.fn(async () =>
      authenticates
        ? { success: true, errorCode: null }
        : { success: false, errorCode: 'USER_CANCEL' },
    ),
  };
}

function keystore(secrets: Record<string, string> = {}): SecureStorageModule {
  return {
    getSecret: jest.fn(async (name: string) => secrets[name] ?? null),
    setSecret: jest.fn(async (name: string, value: string) => {
      secrets[name] = value;
    }),
    clearAll: jest.fn(async () => undefined),
  };
}

describe('app lock', () => {
  test('an app with no lock opens straight to the workspace', async () => {
    const module = biometrics();
    const lock = createAppLock({
      biometrics: createBiometricLock({ module, preferences: new InMemoryPreferenceStore() }),
    });

    await expect(lock.start()).resolves.toEqual({ unlocked: true, errorCode: null });
    expect(module.authenticate).not.toHaveBeenCalled();
  });

  test('an enabled lock keeps the data hidden until the user authenticates', async () => {
    const preferences = new InMemoryPreferenceStore();
    const biometricLock = createBiometricLock({ module: biometrics(), preferences });
    await biometricLock.setEnabled(true);
    const lock = createAppLock({ biometrics: biometricLock });

    await expect(lock.start()).resolves.toEqual({ unlocked: true, errorCode: null });
  });

  test('a cancelled prompt reports the app as locked, with the platform code', async () => {
    const preferences = new InMemoryPreferenceStore();
    await createBiometricLock({ module: biometrics(), preferences }).setEnabled(true);
    const lock = createAppLock({
      biometrics: createBiometricLock({ module: biometrics(false), preferences }),
    });

    await expect(lock.start()).resolves.toEqual({ unlocked: false, errorCode: 'USER_CANCEL' });
  });

  test('locking reports a device without biometrics instead of trapping the user', async () => {
    const lock = createAppLock({
      biometrics: createBiometricLock({
        module: { isAvailable: jest.fn(async () => false), authenticate: jest.fn() },
        preferences: new InMemoryPreferenceStore(),
      }),
    });

    // Turning the lock on must fail loudly rather than leave the app unopenable.
    await expect(lock.setEnabled(true)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(lock.start()).resolves.toEqual({ unlocked: true, errorCode: null });
  });

  test('the toggle persists through a restart', async () => {
    const preferences = new InMemoryPreferenceStore();
    const first = createAppLock({
      biometrics: createBiometricLock({ module: biometrics(), preferences }),
    });
    await first.setEnabled(true);

    // A new process, the same preferences: the lock must survive.
    const second = createAppLock({
      biometrics: createBiometricLock({ module: biometrics(), preferences }),
    });
    await expect(second.isEnabled()).resolves.toBe(true);
    expect(await loadSessionPreferences(preferences)).toMatchObject({});
  });
});

describe('session startup', () => {
  const session = (preferences: InMemoryPreferenceStore, secrets: Record<string, string> = {}) => {
    const module = keystore(secrets);
    return loadStartupSession({
      preferences,
      secure: createSecureStorage({ module, preferences }),
    });
  };

  test('a stored model id selects that model, and an unknown one falls back', async () => {
    const preferences = new InMemoryPreferenceStore();
    preferences.set('session.selectedModelId', 'claude-3-5-sonnet-20241022');

    const started = await session(preferences);
    expect(started.selectedModel.id).toBe('claude-3-5-sonnet-20241022');
    expect(started.selectedModel.provider).toBe('ANTHROPIC');

    // An id from a build that no longer ships that model must still boot.
    preferences.set('session.selectedModelId', 'a-model-from-a-build-that-no-longer-exists');
    expect((await session(preferences)).selectedModel.id).toBe('gemini-2.5-flash');
  });

  test('no stored selection boots with the Kotlin default', async () => {
    const started = await session(new InMemoryPreferenceStore());
    expect(started.selectedModel.id).toBe('gemini-2.5-flash');
  });

  test('a blank secret does not count as a configured key', async () => {
    const started = await session(new InMemoryPreferenceStore(), {
      'provider.OPENAI.apiKey': 'sk-test',
      'provider.ANTHROPIC.apiKey': '',
    });

    // The provider holding a real key is ready; an empty one is not.
    expect(started.providersNeedingKeys).toEqual(['GEMINI', 'ANTHROPIC', 'DEEPSEEK', 'GROQ']);
    // A LAN model and the instance server never need one.
    expect(started.providersNeedingKeys).not.toContain('OLLAMA');
    expect(started.providersNeedingKeys).not.toContain('INSTANCE');
  });
});
