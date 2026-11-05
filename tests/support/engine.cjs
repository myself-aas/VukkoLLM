/**
 * Test double for the Rust storage engine.
 *
 * This module implements, in JavaScript over `node:sqlite`, the exact contract
 * `vukko-core`'s repositories implement in Rust:
 *
 *   rust/crates/vukko-core/src/repository/workspace_repository.rs
 *   rust/crates/vukko-core/src/repository/thread_repository.rs
 *   rust/crates/vukko-core/src/repository/message_repository.rs
 *   rust/crates/vukko-core/src/repository/document_repository.rs
 *   rust/crates/vukko-core/src/repository/settings_repository.rs
 *   rust/crates/vukko-core/src/repository/storage_repository.rs
 *
 * It is test support, not production code (docs/RUST_VERIFICATION.md explains
 * why the environment cannot compile Rust). Every rule it enforces is stated in
 * the module comment of its Rust counterpart; if the two disagree, the Rust
 * implementation is wrong or this file is — either way a test fails.
 *
 * It also mirrors the event emission rules of the React Native store layer
 * (Phase 4 Step 4.3): one event per persisted mutation, drained by the caller.
 */

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { adoptDatabase } = require('../migration/support/adopt.cjs');

// ---------------------------------------------------------------- validation

class EngineError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'VukkoError';
    this.code = code;
    this.retryable = code === 'NETWORK' || code === 'STORAGE';
    if (details) this.details = details;
  }
}

const validation = (message, details) => new EngineError('VALIDATION', message, details);
const notFound = (what) => new EngineError('NOT_FOUND', `${what} not found`);

function requireText(value, field, { max = 10_000 } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validation(`${field} is required`);
  }
  if (value.length > max) throw validation(`${field} is too long`);
  return value.trim();
}

function requireId(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw validation(`${field} is required`);
  return value;
}

function requireRange(value, field, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw validation(`${field} must be a number`);
  }
  if (value < min || value > max) throw validation(`${field} must be between ${min} and ${max}`);
  return value;
}

const SENDERS = new Set(['USER', 'ASSISTANT', 'SYSTEM']);
const QUERY_MODES = new Set(['CHAT', 'QUERY', 'AGENT']);
const DOCUMENT_TYPES = new Set(['TEXT', 'PDF', 'WEB_LINK', 'MARKDOWN']);
const PROVIDERS = new Set([
  'GEMINI',
  'OPENAI',
  'ANTHROPIC',
  'DEEPSEEK',
  'GROQ',
  'OLLAMA',
  'INSTANCE',
]);
const BACKUP_TARGETS = new Set(['GITHUB', 'CLOUD_BUCKET']);

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful, versatile AI assistant powered by Vukko.';
const DATABASE_NAME = 'vukko_sovereign.db';
const CHUNK_SIZE = 512;

/** Turns a display name into the slug format the Kotlin client used. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(db, table, slug, ignoreId) {
  let candidate = slug || 'unnamed';
  let attempt = 2;
  for (;;) {
    const clash = db
      .prepare(`SELECT id FROM \`${table}\` WHERE slug = ? AND id IS NOT ?`)
      .get(candidate, ignoreId ?? null);
    if (!clash) return candidate;
    candidate = `${slug}-${attempt}`;
    attempt += 1;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const now = () => Date.now();

// ------------------------------------------------------------------- mapping

const messageFromRow = (row) => ({
  id: row.id,
  threadId: row.threadId,
  sender: row.sender,
  content: row.content,
  timestamp: row.timestamp,
  thinking: row.thinking ?? null,
  thinkingDurationMs: row.thinkingDurationMs ?? null,
  citations: parseJson(row.citationsJson, row.id),
  toolsUsed: parseJson(row.toolsUsedJson, row.id),
  attachments: parseJson(row.attachmentsJson, row.id),
  isStreaming: Boolean(row.isStreaming),
  isAgentExecution: Boolean(row.isAgentExecution),
  agentSteps: parseJson(row.agentStepsJson, row.id),
  createdDocumentId: row.createdDocumentId ?? null,
  createdDocumentName: row.createdDocumentName ?? null,
  isFavorite: Boolean(row.isFavorite),
  isPinned: Boolean(row.isPinned),
  tags: parseJson(row.tagsJson, row.id),
});

/**
 * Malformed JSON is a storage fault, not an empty collection: silently
 * returning `[]` for a corrupted row is how data loss hides (the Kotlin
 * `RoomConverters` swallowed it).
 */
function parseJson(raw, messageId) {
  try {
    const value = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    throw new EngineError('STORAGE', `malformed JSON column in message ${messageId}`);
  }
}

const workspaceFromRow = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  systemPrompt: row.systemPrompt,
  temperature: row.temperature,
  queryMode: row.queryMode,
  vectorCount: row.vectorCount,
  documentCount: row.documentCount,
  createdAt: row.createdAt,
  agentMaxSteps: row.agentMaxSteps,
  agentAllowWebSearch: Boolean(row.agentAllowWebSearch),
  agentAllowFileCreation: Boolean(row.agentAllowFileCreation),
  agentAllowDocumentSearch: Boolean(row.agentAllowDocumentSearch),
});

const threadFromRow = (row) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  slug: row.slug,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  messageCount: row.messageCount,
  lastMessageSnippet: row.lastMessageSnippet ?? null,
  isPinned: Boolean(row.isPinned),
});

const documentFromRow = (row) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  type: row.type,
  size: row.size,
  vectorCount: row.vectorCount,
  contentSummary: row.contentSummary,
  fullContent: row.fullContent,
  dateAdded: row.dateAdded,
});

// ------------------------------------------------------------------- settings

/**
 * Key → reader. The keys are the Kotlin preference names so an upgrade can copy
 * them verbatim; every value is stored as TEXT and coerced back on read.
 */
const SETTINGS = {
  activeWorkspaceId: { kind: 'string', fallback: 'ws_default' },
  activeThreadId: { kind: 'string', fallback: 'th_default' },
  selectedProvider: { kind: 'enum', values: PROVIDERS, fallback: 'GEMINI' },
  selectedModelId: { kind: 'string', fallback: 'gemini-2.5-flash' },
  instanceUrl: { kind: 'string', fallback: 'http://10.0.2.2:3001' },
  webSearchEnabled: { kind: 'boolean', fallback: true },
  autoApproveTools: { kind: 'boolean', fallback: true },
  biometricLockEnabled: { kind: 'boolean', fallback: false },
  backupEnabled: { kind: 'boolean', fallback: false },
  backupFrequencyHours: { kind: 'number', min: 1, max: 168, fallback: 24 },
  backupTarget: { kind: 'enum', values: BACKUP_TARGETS, fallback: 'GITHUB' },
};

/** Preference names as the Kotlin app spelled them. */
const SETTING_KEYS = {
  activeWorkspaceId: 'active_workspace_id',
  activeThreadId: 'active_thread_id',
  selectedProvider: 'selected_provider',
  selectedModelId: 'selected_model_id',
  instanceUrl: 'instance_url',
  webSearchEnabled: 'tool_web_search',
  autoApproveTools: 'tool_auto_approve',
  biometricLockEnabled: 'biometric_lock_enabled',
  backupEnabled: 'backup_enabled',
  backupFrequencyHours: 'backup_frequency',
  backupTarget: 'backup_target',
};

function coerceSetting(key, raw) {
  const spec = SETTINGS[key];
  if (!spec) throw validation(`unknown setting: ${key}`);
  switch (spec.kind) {
    case 'boolean':
      return raw === 'true';
    case 'number':
      return Number(raw);
    default:
      return raw;
  }
}

// -------------------------------------------------------------------- engine

function createEngine(databasePath) {
  let db = null;
  const events = [];

  const emit = (event) => events.push(event);

  const refreshThreadCounters = (threadId, snippet) => {
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE threadId = ?')
      .get(threadId).n;
    db.prepare(
      'UPDATE chat_threads SET messageCount = ?, lastMessageSnippet = ?, updatedAt = ? WHERE id = ?',
    ).run(count, snippet, now(), threadId);
  };

  const refreshWorkspaceCounters = (workspaceId) => {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS documents, COALESCE(SUM(vectorCount), 0) AS vectors FROM workspace_documents WHERE workspaceId = ?',
      )
      .get(workspaceId);
    db.prepare('UPDATE workspaces SET documentCount = ?, vectorCount = ? WHERE id = ?').run(
      row.documents,
      row.vectors,
      workspaceId,
    );
  };

  const workspaces = {
    async list() {
      return db
        .prepare('SELECT * FROM workspaces ORDER BY createdAt ASC, id ASC')
        .all()
        .map(workspaceFromRow);
    },
    async get(id) {
      const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(requireId(id, 'id'));
      if (!row) throw notFound(`workspace ${id}`);
      return workspaceFromRow(row);
    },
    async create(input = {}) {
      const name = requireText(input.name, 'name', { max: 120 });
      const temperature = requireRange(input.temperature ?? 0.7, 'temperature', 0, 2);
      const queryMode = input.queryMode ?? 'CHAT';
      if (!QUERY_MODES.has(queryMode)) throw validation(`unknown query mode: ${queryMode}`);
      const createdAt = now();
      const id = newId('ws');
      const slug = uniqueSlug(db, 'workspaces', slugify(name));

      db.prepare(
        `INSERT INTO workspaces (id, name, slug, description, systemPrompt, temperature, queryMode,
          vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch,
          agentAllowFileCreation, agentAllowDocumentSearch)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 5, 1, 1, 1)`,
      ).run(
        id,
        name,
        slug,
        (input.description ?? '').trim(),
        (input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT).trim(),
        temperature,
        queryMode,
        createdAt,
      );

      const workspace = await workspaces.get(id);
      emit({ type: 'workspace.updated', workspace });
      return workspace;
    },
    async update(workspace) {
      const existing = await workspaces.get(requireId(workspace.id, 'id'));
      const name = requireText(workspace.name ?? existing.name, 'name', { max: 120 });
      const temperature = requireRange(
        workspace.temperature ?? existing.temperature,
        'temperature',
        0,
        2,
      );
      const queryMode = workspace.queryMode ?? existing.queryMode;
      if (!QUERY_MODES.has(queryMode)) throw validation(`unknown query mode: ${queryMode}`);
      const maxSteps = requireRange(
        workspace.agentMaxSteps ?? existing.agentMaxSteps,
        'agentMaxSteps',
        1,
        20,
      );

      db.prepare(
        `UPDATE workspaces SET name = ?, description = ?, systemPrompt = ?, temperature = ?,
          queryMode = ?, agentMaxSteps = ?, agentAllowWebSearch = ?, agentAllowFileCreation = ?,
          agentAllowDocumentSearch = ? WHERE id = ?`,
      ).run(
        name,
        workspace.description ?? existing.description,
        workspace.systemPrompt ?? existing.systemPrompt,
        temperature,
        queryMode,
        maxSteps,
        (workspace.agentAllowWebSearch ?? existing.agentAllowWebSearch) ? 1 : 0,
        (workspace.agentAllowFileCreation ?? existing.agentAllowFileCreation) ? 1 : 0,
        (workspace.agentAllowDocumentSearch ?? existing.agentAllowDocumentSearch) ? 1 : 0,
        existing.id,
      );

      const updated = await workspaces.get(existing.id);
      emit({ type: 'workspace.updated', workspace: updated });
      return updated;
    },
    async delete(id) {
      await workspaces.get(id);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    },
  };

  const threads = {
    async list(workspaceId) {
      requireId(workspaceId, 'workspaceId');
      return db
        .prepare(
          `SELECT * FROM chat_threads WHERE workspaceId = ?
           ORDER BY isPinned DESC, updatedAt DESC, createdAt DESC, id ASC`,
        )
        .all(workspaceId)
        .map(threadFromRow);
    },
    async get(id) {
      const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(requireId(id, 'id'));
      if (!row) throw notFound(`thread ${id}`);
      return threadFromRow(row);
    },
    async create(input = {}) {
      const workspace = await workspaces.get(requireId(input.workspaceId, 'workspaceId'));
      const name = requireText(input.name, 'name', { max: 120 });
      const timestamp = now();
      const id = newId('th');
      db.prepare(
        `INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, lastMessageSnippet, isPinned)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0)`,
      ).run(
        id,
        workspace.id,
        name,
        uniqueSlug(db, 'chat_threads', slugify(name)),
        timestamp,
        timestamp,
      );

      const thread = await threads.get(id);
      emit({ type: 'thread.updated', thread });
      return thread;
    },
    async rename(id, name) {
      const thread = await threads.get(id);
      const trimmed = requireText(name, 'name', { max: 120 });
      db.prepare('UPDATE chat_threads SET name = ?, updatedAt = ? WHERE id = ?').run(
        trimmed,
        now(),
        thread.id,
      );
      const updated = await threads.get(thread.id);
      emit({ type: 'thread.updated', thread: updated });
      return updated;
    },
    async setPinned(id, isPinned) {
      const thread = await threads.get(id);
      db.prepare('UPDATE chat_threads SET isPinned = ? WHERE id = ?').run(
        isPinned ? 1 : 0,
        thread.id,
      );
      emit({ type: 'thread.updated', thread: await threads.get(thread.id) });
    },
    async delete(id) {
      await threads.get(id);
      db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
    },
  };

  const messages = {
    async list(threadId) {
      requireId(threadId, 'threadId');
      return db
        .prepare('SELECT * FROM chat_messages WHERE threadId = ? ORDER BY timestamp ASC, rowid ASC')
        .all(threadId)
        .map(messageFromRow);
    },
    async get(id) {
      const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(requireId(id, 'id'));
      if (!row) throw notFound(`message ${id}`);
      return messageFromRow(row);
    },
    async append(input = {}) {
      const threadId = requireId(input.threadId, 'threadId');
      const thread = await threads.get(threadId);
      const sender = input.sender ?? 'USER';
      if (!SENDERS.has(sender)) throw validation(`unknown sender: ${sender}`);
      // A streaming placeholder legitimately starts empty; every other message
      // must carry text (an empty user turn is a UI bug, not a transcript).
      const content =
        input.isStreaming && (input.content ?? '') === ''
          ? ''
          : requireText(input.content, 'content', { max: 200_000 });
      const timestamp = input.timestamp ?? now();
      if (!Number.isInteger(timestamp) || timestamp <= 0)
        throw validation('timestamp must be integer milliseconds');

      const id = input.id ?? newId('msg');
      const encode = (value) => JSON.stringify(value ?? []);

      db.prepare(
        `INSERT INTO chat_messages (id, threadId, sender, content, timestamp, thinking, thinkingDurationMs,
          citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, agentStepsJson,
          createdDocumentId, createdDocumentName, isFavorite, isPinned, tagsJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        thread.id,
        sender,
        content,
        timestamp,
        input.thinking ?? null,
        input.thinkingDurationMs ?? null,
        encode(input.citations),
        encode(input.toolsUsed),
        encode(input.attachments),
        input.isStreaming ? 1 : 0,
        input.isAgentExecution ? 1 : 0,
        encode(input.agentSteps),
        input.createdDocumentId ?? null,
        input.createdDocumentName ?? null,
        input.isFavorite ? 1 : 0,
        input.isPinned ? 1 : 0,
        encode(input.tags),
      );

      refreshThreadCounters(thread.id, content.slice(0, 120));
      const message = await messages.get(id);
      emit({ type: 'message.created', message });
      return message;
    },
    async createUserTurn(threadId, content) {
      return messages.append({ threadId, sender: 'USER', content });
    },
    async setFavorite(id, isFavorite) {
      const message = await messages.get(id);
      db.prepare('UPDATE chat_messages SET isFavorite = ? WHERE id = ?').run(
        isFavorite ? 1 : 0,
        message.id,
      );
      emit({ type: 'message.updated', message: await messages.get(message.id) });
    },
    async setPinned(id, isPinned) {
      const message = await messages.get(id);
      db.prepare('UPDATE chat_messages SET isPinned = ? WHERE id = ?').run(
        isPinned ? 1 : 0,
        message.id,
      );
      emit({ type: 'message.updated', message: await messages.get(message.id) });
    },
    async setTags(id, tags) {
      const message = await messages.get(id);
      if (!Array.isArray(tags)) throw validation('tags must be an array');
      const normalised = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
      if (normalised.length > 32) throw validation('too many tags');
      db.prepare('UPDATE chat_messages SET tagsJson = ? WHERE id = ?').run(
        JSON.stringify(normalised),
        message.id,
      );
      emit({ type: 'message.updated', message: await messages.get(message.id) });
    },
    /**
     * Appends streamed text to a message that is still streaming.
     *
     * A late delta for a message that already completed or failed is a
     * `CANCELLED` error rather than a silent append: the Rust repository
     * (`message_repository::append_delta`) rejects it for the same reason, and
     * silently accepting it would resurrect a cancelled answer.
     */
    async appendDelta(id, delta) {
      const message = await messages.get(id);
      if (!message.isStreaming) throw new EngineError('CANCELLED', 'request cancelled');
      if (typeof delta !== 'string') throw validation('delta must be a string');
      db.prepare('UPDATE chat_messages SET content = content || ? WHERE id = ?').run(delta, id);
      return messages.get(id);
    },
    /** Finishes a streaming message with its final content and metadata. */
    async complete(id, finalContent, options = {}) {
      const message = await messages.get(id);
      if (typeof finalContent !== 'string') {
        throw validation('final content must be a string');
      }
      db.prepare(
        `UPDATE chat_messages SET content = ?, isStreaming = 0, thinking = ?,
           thinkingDurationMs = ?, citationsJson = ? WHERE id = ?`,
      ).run(
        finalContent,
        options.thinking ?? message.thinking,
        options.thinkingDurationMs ?? message.thinkingDurationMs,
        JSON.stringify(options.citations ?? message.citations),
        id,
      );
      refreshThreadCounters(message.threadId, finalContent.slice(0, 120));
      const completed = await messages.get(id);
      emit({ type: 'message.updated', message: completed });
      return completed;
    },
    /** Marks a message as failed: it stops streaming and stores no content. */
    async fail(id, reason) {
      await messages.get(id);
      db.prepare('UPDATE chat_messages SET isStreaming = 0 WHERE id = ?').run(id);
      const failed = await messages.get(id);
      emit({ type: 'message.failed', message: failed, reason: String(reason ?? '') });
      return failed;
    },
    async delete(id) {
      const message = await messages.get(id);
      db.prepare('DELETE FROM chat_messages WHERE id = ?').run(message.id);
      const last = db
        .prepare(
          'SELECT content FROM chat_messages WHERE threadId = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1',
        )
        .get(message.threadId);
      refreshThreadCounters(message.threadId, last ? last.content.slice(0, 120) : null);
      emit({ type: 'thread.updated', thread: await threads.get(message.threadId) });
    },
  };

  const documents = {
    async list(workspaceId) {
      requireId(workspaceId, 'workspaceId');
      return db
        .prepare(
          'SELECT * FROM workspace_documents WHERE workspaceId = ? ORDER BY dateAdded DESC, id ASC',
        )
        .all(workspaceId)
        .map(documentFromRow);
    },
    async get(id) {
      const row = db
        .prepare('SELECT * FROM workspace_documents WHERE id = ?')
        .get(requireId(id, 'id'));
      if (!row) throw notFound(`document ${id}`);
      return documentFromRow(row);
    },
    async create(input = {}) {
      const workspace = await workspaces.get(requireId(input.workspaceId, 'workspaceId'));
      const name = requireText(input.name, 'name', { max: 255 });
      const type = input.type ?? 'TEXT';
      if (!DOCUMENT_TYPES.has(type)) throw validation(`unknown document type: ${type}`);
      const content = typeof input.content === 'string' ? input.content : '';
      const bytes = Buffer.byteLength(content, 'utf8');
      const vectorCount = Math.ceil(bytes / CHUNK_SIZE);
      const id = newId('doc');

      db.prepare(
        `INSERT INTO workspace_documents (id, workspaceId, name, type, size, vectorCount, contentSummary, fullContent, dateAdded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        workspace.id,
        name,
        type,
        formatBytes(bytes),
        vectorCount,
        content.slice(0, 160),
        content,
        now(),
      );

      refreshWorkspaceCounters(workspace.id);
      const document = await documents.get(id);
      emit({ type: 'workspace.updated', workspace: await workspaces.get(workspace.id) });
      return document;
    },
    async delete(id) {
      const document = await documents.get(id);
      db.prepare('DELETE FROM workspace_documents WHERE id = ?').run(document.id);
      refreshWorkspaceCounters(document.workspaceId);
      emit({ type: 'workspace.updated', workspace: await workspaces.get(document.workspaceId) });
    },
  };

  const settings = {
    async getAll() {
      const stored = new Map(
        db
          .prepare('SELECT key, value FROM app_settings')
          .all()
          .map((row) => [row.key, row.value]),
      );
      const result = {};
      for (const [key, spec] of Object.entries(SETTINGS)) {
        const raw = stored.get(SETTING_KEYS[key]);
        result[key] = raw === undefined ? spec.fallback : coerceSetting(key, raw);
      }
      return result;
    },
    async set(key, value) {
      if (!SETTINGS[key]) throw validation(`unknown setting: ${key}`);
      const spec = SETTINGS[key];
      switch (spec.kind) {
        case 'boolean':
          if (typeof value !== 'boolean') throw validation(`${key} must be a boolean`);
          break;
        case 'number':
          if (typeof value !== 'number' || Number.isNaN(value)) {
            throw validation(`${key} must be a number`);
          }
          if (value < spec.min || value > spec.max) {
            throw validation(`${key} must be between ${spec.min} and ${spec.max}`);
          }
          break;
        case 'enum':
          if (!spec.values.has(value))
            throw validation(`${key} must be one of ${[...spec.values]}`);
          break;
        default:
          if (typeof value !== 'string') throw validation(`${key} must be a string`);
      }
      db.prepare(
        `INSERT INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      ).run(SETTING_KEYS[key], String(value), now());
      return value;
    },
  };

  const storage = {
    async stats() {
      const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n;
      return {
        databaseName: DATABASE_NAME,
        totalWorkspaces: count('workspaces'),
        totalThreads: count('chat_threads'),
        totalMessages: count('chat_messages'),
        totalDocuments: count('workspace_documents'),
        isLocalEncrypted: true,
        storageType: 'Rust SQLite (Local Device Only)',
        dataSovereigntyStatus: 'Air-Gapped Sovereign Storage',
      };
    },
    async runIntegrityCheck() {
      const integrityCheck = db.prepare('PRAGMA integrity_check').get().integrity_check;
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      const tables = ['workspaces', 'chat_threads', 'chat_messages', 'workspace_documents'];
      return {
        ok: integrityCheck === 'ok' && violations.length === 0,
        integrityCheck,
        foreignKeyViolations: violations.length,
        backupPresent: false,
        tableCounts: tables.map((table) => ({
          table,
          rows: db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n,
        })),
        checkedAt: now(),
      };
    },
  };

  /**
   * The export renderer, mirroring `services/export.rs`.
   *
   * The header, the per-message headings and the JSON shape are byte-compatible
   * with the Rust exporter, because a user who exports the same thread from the
   * Kotlin app and from this one must be able to diff the files.
   */
  const exports = {
    async thread(threadId, format, exportedAt = now()) {
      requireId(threadId, 'threadId');
      const thread = await threads.get(threadId);
      const rows = await messages.list(thread.id);
      const label = (sender) => (sender === 'USER' ? 'USER' : 'ASSISTANT');

      let content;
      let extension;
      let mimeType;
      switch (format) {
        case 'md':
        case 'markdown': {
          const lines = [
            '# Vukko Chat Export (Local Sovereign Storage)',
            `*Thread ID: ${thread.id}*`,
            `*Storage: Rust SQLite (\`${DATABASE_NAME}\`)*`,
            '',
          ];
          for (const message of rows) {
            lines.push(`### ${label(message.sender)}`);
            lines.push(message.content);
            lines.push('');
            if (message.citations.length > 0) {
              lines.push('**Citations:**');
              for (const citation of message.citations) {
                lines.push(`- [${citation.title}] ${citation.snippet}`);
              }
              lines.push('');
            }
          }
          content = lines.join('\n');
          extension = 'md';
          mimeType = 'text/markdown';
          break;
        }
        case 'json': {
          content = JSON.stringify(
            {
              threadId: thread.id,
              database: DATABASE_NAME,
              dataSovereignty: true,
              messages: rows.map((message) => ({
                sender: label(message.sender),
                content: message.content,
              })),
            },
            null,
            2,
          );
          extension = 'json';
          mimeType = 'application/json';
          break;
        }
        case 'txt':
        case 'text': {
          content = rows
            .map((message) => `${label(message.sender)}: ${message.content}`)
            .join('\n\n');
          extension = 'txt';
          mimeType = 'text/plain';
          break;
        }
        default:
          throw validation(`unknown export format: ${format}`);
      }

      return {
        format,
        fileName: `vukko_thread_${thread.id}_${exportedAt}.${extension}`,
        mimeType,
        content,
        bytes: content.length,
        messageCount: rows.length,
        exportedAt,
      };
    },
  };

  /** A backup archive, mirroring `services/backup.rs`. */
  const backups = {
    async archive(completedAt = now()) {
      const all = await workspaces.list();
      const archive = JSON.stringify({ workspaces: all }, null, 2);
      const seconds = Math.floor(completedAt / 1000);
      const date = new Date(seconds * 1000);
      const pad = (value) => String(value).padStart(2, '0');
      const fileName =
        `vukko_backup_${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.json`;
      const checksum = createHash('sha256').update(archive).digest('hex');
      return { fileName, checksum, archive, workspaceCount: all.length, completedAt };
    },
  };

  return {
    async initialize() {
      adoptDatabase(databasePath);
      db = new DatabaseSync(databasePath);
      db.exec('PRAGMA foreign_keys = ON;');
      return {
        databaseName: DATABASE_NAME,
        migrationsApplied: 0,
        migratedFromLegacy: false,
        workspaceCount: 0,
        warnings: [],
      };
    },
    close() {
      try {
        db?.close();
      } catch {
        // Already closed.
      }
    },
    workspaces,
    threads,
    messages,
    documents,
    settings,
    storage,
    exports,
    backups,
    async counts() {
      const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n;
      return {
        workspaces: count('workspaces'),
        threads: count('chat_threads'),
        messages: count('chat_messages'),
        documents: count('workspace_documents'),
      };
    },
    /** Test escape hatch for constructing corrupt states; never used by the app. */
    async rawExec(sql) {
      db.exec(sql);
    },
    /** Returns and clears the events published since the last drain. */
    drainEvents() {
      return events.splice(0, events.length);
    },
  };
}

module.exports = { createEngine, EngineError, slugify, FETCH_SETTINGS: SETTINGS };
