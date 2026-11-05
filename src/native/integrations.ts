/**
 * Native integration boundaries (MIGRATION_PLAN.md §10, Steps 7.1–7.6).
 *
 * Each factory below wraps an OS capability that must stay platform-side. The
 * rule behind all of them: the React layer owns *decisions*, the native layer
 * owns *mechanisms*, and nothing secret ever crosses into plain storage.
 *
 * The modules are injected rather than imported so the whole surface can be
 * exercised in Jest; the real ones are thin TurboModules registered by name.
 */

import type { VukkoError } from '../types/errors';
import { vukkoError } from '../types/errors';
import type { BackupResult, BackupSettings, BackupTarget } from '../types/backup';

// ----------------------------------------------------------- module contracts

export interface BiometricsModule {
  isAvailable(): Promise<boolean>;
  authenticate(options: {
    title: string;
    subtitle?: string;
  }): Promise<{ success: boolean; errorCode: string | null }>;
}

export interface SecureStorageModule {
  getSecret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface FileModule {
  pickDocuments(): Promise<PickedFile[]>;
  writeExport(fileName: string, content: string, mimeType: string): Promise<{ uri: string }>;
  shareFile(uri: string): Promise<void>;
}

export interface BackgroundTaskModule {
  scheduleBackup(): Promise<void>;
  cancelBackup(): Promise<void>;
  runBackupNow(): Promise<void>;
}

/** Where the home-screen widget reads its snapshot from. */
export interface WidgetWriter {
  write(snapshot: WidgetSnapshot): Promise<void>;
}

export interface VoiceModule {
  requestPermission(): Promise<'GRANTED' | 'DENIED'>;
  start(): Promise<void>;
  stop(): Promise<string>;
}

/** Plain key/value preferences. Never used for secrets. */
export interface PreferenceStore {
  get(name: string): string | null;
  set(name: string, value: string): void;
  remove(name: string): void;
}

// ------------------------------------------------------------ preference store

/** The in-memory store the tests and preview builds use. */
export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly values = new Map<string, string>();

  get(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  remove(name: string): void {
    this.values.delete(name);
  }

  /** Test helper: the whole store, for asserting nothing secret was written. */
  dump(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

// ----------------------------------------------------------------- preference

/** Non-secret session preferences, the ones the Kotlin app kept in SharedPreferences. */
export interface SessionPreferences {
  selectedProvider?: string;
  selectedModelId?: string;
  instanceUrl?: string;
  ollamaUrl?: string;
  biometricLockEnabled?: boolean;
  lastWorkspaceId?: string;
  lastThreadId?: string;
}

const PREFERENCE_PREFIX = 'session.';

/** Anything secret-looking is refused rather than quietly persisted. */
const FORBIDDEN_PREFERENCE = /key|token|secret|password|authorization|credential/i;

export async function saveSessionPreferences(
  store: PreferenceStore,
  preferences: SessionPreferences,
): Promise<void> {
  for (const [name, value] of Object.entries(preferences)) {
    if (FORBIDDEN_PREFERENCE.test(name)) {
      throw vukkoError({
        code: 'VALIDATION',
        message: `${name} is a secret; use secure storage`,
      });
    }
    if (value === undefined) continue;
    store.set(
      `${PREFERENCE_PREFIX}${name}`,
      typeof value === 'boolean' ? String(value) : String(value),
    );
  }
}

export async function loadSessionPreferences(
  store: PreferenceStore,
): Promise<SessionPreferences> {
  const read = (name: string) => store.get(`${PREFERENCE_PREFIX}${name}`);
  const boolean = (name: string) => {
    const value = read(name);
    return value === null ? undefined : value === 'true';
  };
  const text = (name: string) => read(name) ?? undefined;

  return {
    selectedProvider: text('selectedProvider'),
    selectedModelId: text('selectedModelId'),
    instanceUrl: text('instanceUrl'),
    ollamaUrl: text('ollamaUrl'),
    biometricLockEnabled: boolean('biometricLockEnabled'),
    lastWorkspaceId: text('lastWorkspaceId'),
    lastThreadId: text('lastThreadId'),
  };
}

// ------------------------------------------------------- Step 7.1 biometrics

export interface BiometricLock {
  isAvailable(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  unlock(): Promise<{ unlocked: boolean; errorCode: string | null }>;
}

const BIOMETRIC_PREFERENCE = 'security.biometricLock';

/**
 * The app lock.
 *
 * Only the enabled flag is stored — the BiometricPrompt API owns the actual
 * credential, and no biometric material ever reaches this process.
 */
export function createBiometricLock(options: {
  module: BiometricsModule;
  preferences: PreferenceStore;
}): BiometricLock {
  const { module, preferences } = options;

  return {
    isAvailable: () => module.isAvailable(),

    async isEnabled() {
      return preferences.get(BIOMETRIC_PREFERENCE) === 'true';
    },

    async setEnabled(enabled) {
      if (!enabled) {
        preferences.set(BIOMETRIC_PREFERENCE, 'false');
        return;
      }
      if (!(await module.isAvailable())) {
        throw vukkoError({
          code: 'UNSUPPORTED',
          message: 'This device has no biometric hardware enrolled',
        });
      }
      preferences.set(BIOMETRIC_PREFERENCE, 'true');
    },

    async unlock() {
      if (preferences.get(BIOMETRIC_PREFERENCE) !== 'true') {
        return { unlocked: true, errorCode: null };
      }
      const result = await module.authenticate({
        title: 'Unlock Vukko',
        subtitle: 'Your data stays on this device',
      });
      return { unlocked: result.success, errorCode: result.errorCode };
    },
  };
}

// ---------------------------------------------------- Step 7.2 secure storage

/** Keystore entry names. Stable: they key real user secrets. */
export const SECRET_NAMES = {
  apiKey: (provider: string) => `provider.${provider}.apiKey`,
  githubToken: 'github.oauthToken',
} as const;

export interface SecureStorage {
  getApiKey(provider: string): Promise<string | null>;
  setApiKey(provider: string, key: string): Promise<void>;
  getGitHubToken(): Promise<string | null>;
  setGitHubToken(token: string): Promise<void>;
  clearAll(): Promise<void>;
}

/**
 * Secrets live in the Android Keystore / iOS Keychain and nowhere else.
 *
 * Note what this object does *not* expose: no path to SQLite, no path to the
 * preference store, no "list everything" call. A key can only be read by its
 * exact name, which keeps it out of diagnostics and out of the database file.
 */
export function createSecureStorage(options: {
  module: SecureStorageModule;
  preferences: PreferenceStore;
}): SecureStorage {
  const { module } = options;

  return {
    async getApiKey(provider) {
      return module.getSecret(SECRET_NAMES.apiKey(provider));
    },
    async setApiKey(provider, key) {
      await module.setSecret(SECRET_NAMES.apiKey(provider), key);
    },
    async getGitHubToken() {
      return module.getSecret(SECRET_NAMES.githubToken);
    },
    async setGitHubToken(token) {
      await module.setSecret(SECRET_NAMES.githubToken, token);
    },
    async clearAll() {
      await module.clearAll();
    },
  };
}

// --------------------------------------------------------- Step 7.3 files

export type ImportKind =
  | 'PDF'
  | 'MARKDOWN'
  | 'TEXT'
  | 'IMAGE'
  | 'WEB_LINK'
  | 'UNSUPPORTED';

export interface ImportCandidate {
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** A path Rust can open, or null when the platform handed out a content URI. */
  path: string | null;
  /** True when the host must copy the file into the sandbox before ingesting. */
  requiresCopy: boolean;
  kind: ImportKind;
}

export interface FileService {
  pickDocuments(): Promise<ImportCandidate[]>;
  writeExport(fileName: string, content: string, mimeType: string): Promise<{ uri: string }>;
  share(uri: string): Promise<void>;
}

/**
 * What a picked file is, as far as *ingestion* is concerned.
 *
 * An image is reported as `IMAGE` rather than `UNSUPPORTED` so the caller can
 * offer the right action — attach it to a message for vision — instead of a
 * generic failure. Only PDF, Markdown and text are embedded as documents,
 * matching `DocumentType`.
 */
function classify(mimeType: string, name: string): ImportKind {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'text/markdown') return 'MARKDOWN';
  if (mimeType.startsWith('text/')) return 'TEXT';
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (/^https?:\/\//.test(name)) return 'WEB_LINK';
  return 'UNSUPPORTED';
}

/**
 * Document import.
 *
 * Rust receives paths inside the app sandbox, never a foreign `content://` URI:
 * a URI's permission grant is not something the Rust layer can hold, so the
 * host copies the bytes first and says so with `requiresCopy`.
 */
export function createFileService(options: {
  module: FileModule;
  sandboxRoot: string;
}): FileService {
  const { module, sandboxRoot } = options;

  return {
    async pickDocuments() {
      const picked = await module.pickDocuments();
      return picked.map((file) => {
        const path = file.uri.startsWith('file://') ? file.uri.replace('file://', '') : null;
        const insideSandbox = path !== null && path.startsWith(sandboxRoot);
        return {
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          path: path !== null && (insideSandbox || path.startsWith('/')) ? path : null,
          requiresCopy: !(path !== null && insideSandbox),
          kind: classify(file.mimeType, file.name),
        };
      });
    },

    writeExport(fileName, content, mimeType) {
      return module.writeExport(fileName, content, mimeType);
    },

    share(uri) {
      return module.shareFile(uri);
    },
  };
}

// -------------------------------------------------- Step 7.4 background backup

export interface BackupScheduler {
  schedule(settings?: BackupSettings): Promise<void>;
  cancel(): Promise<void>;
  runNow(options?: { manual?: boolean }): Promise<void>;
  report(result: BackupResult): Promise<void>;
  lastResult(): Promise<BackupResult | null>;
}

/**
 * Background backup.
 *
 * Scheduling stays native (WorkManager / BGTaskScheduler); this wrapper only
 * decides *whether* to schedule and remembers the last result. A target that
 * cannot work is refused before it is scheduled, so the user is never told a
 * backup is running when it is not.
 */
export function createBackupScheduler(options: { module: BackgroundTaskModule }): BackupScheduler {
  const { module } = options;
  let result: BackupResult | null = null;

  const unsupportedTarget = (target: BackupTarget) =>
    target === 'CLOUD_BUCKET'
      ? vukkoError({
          code: 'UNSUPPORTED',
          message: 'Cloud bucket backups are not implemented; use a GitHub repository',
          details: { target },
        })
      : null;

  return {
    async schedule(settings) {
      if (settings) {
        if (!settings.enabled) {
          await module.cancelBackup();
          return;
        }
        if (settings.target === 'GITHUB' && settings.repository.trim().length === 0) {
          throw vukkoError({
            code: 'VALIDATION',
            message: 'Choose a GitHub repository before scheduling a backup',
          });
        }
        const unsupported = unsupportedTarget(settings.target);
        if (unsupported) throw unsupported;
      }
      await module.scheduleBackup();
    },

    cancel: () => module.cancelBackup(),

    runNow() {
      return module.runBackupNow();
    },

    async report(next) {
      result = next;
    },

    async lastResult() {
      return result;
    },
  };
}

// --------------------------------------------------------- Step 7.5 widget

export interface WidgetSnapshot {
  activeWorkspaceName: string;
  activeThreadTitle: string;
  lastMessagePreview: string;
  updatedAt: number;
}

export interface WidgetSnapshotPublisher {
  publish(snapshot: WidgetSnapshot): Promise<void>;
  publishIfActive(
    snapshot: WidgetSnapshot | null,
    context?: { activeThreadId?: string | null },
  ): Promise<void>;
}

/** The widget renders a preview, not a transcript: 120 characters is enough. */
const PREVIEW_LIMIT = 120;

export function createWidgetSnapshotPublisher(options: {
  writer: WidgetWriter;
}): WidgetSnapshotPublisher {
  const { writer } = options;

  return {
    async publish(snapshot) {
      await writer.write({
        activeWorkspaceName: snapshot.activeWorkspaceName,
        activeThreadTitle: snapshot.activeThreadTitle,
        lastMessagePreview: snapshot.lastMessagePreview.slice(0, PREVIEW_LIMIT),
        updatedAt: snapshot.updatedAt,
      });
    },

    async publishIfActive(snapshot, context) {
      if (!snapshot) return;
      if (context && !context.activeThreadId) return;
      await this.publish(snapshot);
    },
  };
}

// ---------------------------------------------------------- Step 7.6 voice

export interface VoiceInput {
  transcribe(): Promise<{ text: string | null; error: VukkoError | null }>;
}

/**
 * Voice input.
 *
 * Permissions, the audio session and the recorder stay native. This wrapper
 * hands the transcript back to the composer rather than sending it, so the user
 * always sees — and can edit — what was heard before it leaves the device.
 */
export function createVoiceInput(options: { module: VoiceModule }): VoiceInput {
  const { module } = options;

  return {
    async transcribe() {
      const permission = await module.requestPermission();
      if (permission !== 'GRANTED') {
        return {
          text: null,
          error: vukkoError({
            code: 'UNSUPPORTED',
            message: 'Microphone access is required for voice input',
          }),
        };
      }

      await module.start();
      const transcript = (await module.stop()).trim();
      if (transcript.length === 0) {
        return {
          text: null,
          error: vukkoError({ code: 'VALIDATION', message: 'Nothing was transcribed' }),
        };
      }
      return { text: transcript, error: null };
    },
  };
}
