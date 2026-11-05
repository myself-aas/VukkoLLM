/**
 * App startup session (MIGRATION_PLAN.md §7 Steps 7.1–7.2).
 *
 * Two things happen before the first screen may show data:
 *
 * 1. the app lock is cleared — if the user enabled it, the platform
 *    authenticates them first;
 * 2. the session is loaded — which model was selected, and which providers
 *    still need a key.
 *
 * Both are thin compositions of `src/native/integrations.ts`, which owns every
 * platform call. This file decides only the order and what a failure means, so
 * the shell can be started in a test with an in-memory keystore.
 */

import {
  loadSessionPreferences,
  type BiometricLock,
  type PreferenceStore,
  type SecureStorage,
} from '../native/integrations';
import { DEFAULT_MODELS, findModel, type LLMModel, type ProviderType } from '../types/provider';
import { PROVIDERS } from '../services/providers';

/** What the shell needs to know before it renders a transcript. */
export interface StartupSession {
  selectedModel: LLMModel;
  /** Providers whose key is missing; the picker labels them as unusable. */
  providersNeedingKeys: ProviderType[];
}

export interface AppLock {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  /** Whether the workspace may be shown. A cancelled prompt is `unlocked: false`. */
  start(): Promise<{ unlocked: boolean; errorCode: string | null }>;
}

/**
 * The lock the app opens behind.
 *
 * Deliberately not merged with `loadStartupSession`: a screen that only needs
 * to know "may I draw?" must not have to hold a keystore.
 */
export function createAppLock({ biometrics }: { biometrics: BiometricLock }): AppLock {
  return {
    isEnabled: () => biometrics.isEnabled(),
    setEnabled: (enabled) => biometrics.setEnabled(enabled),
    start: () => biometrics.unlock(),
  };
}

/**
 * Providers that cannot run without a key.
 *
 * Derived from the provider descriptors rather than a second hard-coded list: a
 * provider whose `requiresApiKey` flips must not keep appearing ready here.
 */
const KEYED_PROVIDERS = (Object.keys(PROVIDERS) as ProviderType[]).filter(
  (provider) => PROVIDERS[provider].requiresApiKey,
);

/**
 * Reads the persisted selection and the key readiness.
 *
 * A model id written by a build that no longer ships that model resolves through
 * `findModel` to the first catalogue entry, which is what the Kotlin
 * `ProviderRegistry.findModel` did — the app must never boot with no model.
 */
export async function loadStartupSession(options: {
  preferences: PreferenceStore;
  secure: SecureStorage;
}): Promise<StartupSession> {
  const { preferences, secure } = options;
  const stored = (await loadSessionPreferences(preferences)).selectedModelId;
  // `DEFAULT_MODELS` is a non-empty literal, so index 0 always exists; the cast
  // keeps `StartupSession` free of an `undefined` arm every caller must handle.
  const selectedModel = (stored ? findModel(stored) : DEFAULT_MODELS[0]) as LLMModel;

  const missing = await Promise.all(
    KEYED_PROVIDERS.map(async (provider) => {
      const key = await secure.getApiKey(provider);
      // An empty secret is not a key: the keystore hands back whatever was
      // written, and a blank entry must not make a provider look configured.
      return key !== null && key.length > 0 ? null : provider;
    }),
  );

  return {
    selectedModel,
    providersNeedingKeys: missing.filter((provider): provider is ProviderType => provider !== null),
  };
}
