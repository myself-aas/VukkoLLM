/**
 * Repository behaviour tests (MIGRATION_PLAN.md §6 Step 3.4).
 *
 * Contract under test — every rule here is also implemented in
 * `rust/crates/vukko-core/src/repository/*.rs`:
 *
 *  - ordering: workspaces by createdAt ASC; threads pinned-first then updatedAt
 *    DESC then createdAt DESC; messages by timestamp ASC then insertion order;
 *  - ids are generated and never caller-supplied; slugs are unique per table;
 *  - deletes cascade through the foreign keys and keep cached counters honest;
 *  - every mutation that changes a row publishes exactly one event;
 *  - invalid input is a VALIDATION error, a missing row is NOT_FOUND, and a
 *    record with malformed JSON columns fails loudly instead of being dropped;
 *  - timestamps are Unix milliseconds and monotonic within a thread.
 *
 * The harness drives `tests/support/engine.cjs`, which uses the migrations from
 * `rust/crates/vukko-db/migrations` and is the twin of `vukko-core`'s
 * repositories (docs/RUST_VERIFICATION.md).
 */

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { createEngine } = require('../support/engine.cjs');

let dir;
let engine;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vukko-repo-'));
  engine = createEngine(join(dir, 'vukko_sovereign.db'));
  await engine.initialize();
});

afterEach(() => {
  engine.close();
  rmSync(dir, { recursive: true, force: true });
});

function events() {
  return engine.drainEvents();
}

describe('workspaces', () => {
  test('create generates an id, slug and defaults, and announces the workspace', async () => {
    const workspace = await engine.workspaces.create({ name: 'Research Notes' });

    expect(workspace.id).toMatch(/^ws_[0-9a-f]{12}$/);
    expect(workspace.slug).toBe('research-notes');
    expect(workspace.queryMode).toBe('CHAT');
    expect(workspace.temperature).toBeCloseTo(0.7);
    expect(workspace.agentMaxSteps).toBe(5);
    expect(workspace.documentCount).toBe(0);
    expect(workspace.vectorCount).toBe(0);
    expect(workspace.createdAt).toBeGreaterThan(1_000_000_000_000);

    expect(events()).toEqual([
      { type: 'workspace.updated', workspace: expect.objectContaining({ id: workspace.id }) },
    ]);
  });

  test('lists workspaces oldest first', async () => {
    const first = await engine.workspaces.create({ name: 'First' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await engine.workspaces.create({ name: 'Second' });

    const listed = await engine.workspaces.list();
    expect(listed.map((workspace) => workspace.id)).toEqual([first.id, second.id]);
  });

  test('rejects an empty name and an out-of-range temperature', async () => {
    await expect(engine.workspaces.create({ name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(engine.workspaces.create({ name: 'Hot', temperature: 3.5 })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
  });

  test('makes duplicate names unique by slug', async () => {
    const a = await engine.workspaces.create({ name: 'Work' });
    const b = await engine.workspaces.create({ name: 'Work' });
    expect(a.slug).toBe('work');
    expect(b.slug).toBe('work-2');
  });

  test('update persists every editable field', async () => {
    const workspace = await engine.workspaces.create({ name: 'Draft' });
    const updated = await engine.workspaces.update({
      ...workspace,
      name: 'Final',
      description: 'desc',
      systemPrompt: 'be terse',
      temperature: 0.2,
      queryMode: 'AGENT',
      agentMaxSteps: 9,
      agentAllowDocumentSearch: false,
    });

    expect(updated).toMatchObject({
      id: workspace.id,
      name: 'Final',
      description: 'desc',
      systemPrompt: 'be terse',
      temperature: 0.2,
      queryMode: 'AGENT',
      agentMaxSteps: 9,
      agentAllowDocumentSearch: false,
    });
    expect((await engine.workspaces.get(workspace.id)).name).toBe('Final');
  });

  test('reports NOT_FOUND for a missing workspace', async () => {
    await expect(engine.workspaces.get('ws_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.workspaces.delete('ws_missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('delete cascades to threads, messages and documents', async () => {
    const workspace = await engine.workspaces.create({ name: 'Doomed' });
    const thread = await engine.threads.create({ workspaceId: workspace.id, name: 'Chat' });
    await engine.messages.createUserTurn(thread.id, 'hello there');
    await engine.documents.create({
      workspaceId: workspace.id,
      name: 'notes.md',
      type: 'MARKDOWN',
      content: 'body',
    });

    await engine.workspaces.delete(workspace.id);

    expect(await engine.workspaces.list()).toEqual([]);
    expect(await engine.counts()).toEqual({
      workspaces: 0,
      threads: 0,
      messages: 0,
      documents: 0,
    });
  });
});

describe('threads', () => {
  let workspace;

  beforeEach(async () => {
    workspace = await engine.workspaces.create({ name: 'Threads' });
  });

  test('create adds a thread pinned-first ordering works', async () => {
    const older = await engine.threads.create({ workspaceId: workspace.id, name: 'Older' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await engine.threads.create({ workspaceId: workspace.id, name: 'Newer' });

    let listed = await engine.threads.list(workspace.id);
    expect(listed.map((thread) => thread.id)).toEqual([newer.id, older.id]);

    await engine.threads.setPinned(older.id, true);
    listed = await engine.threads.list(workspace.id);
    expect(listed.map((thread) => thread.id)).toEqual([older.id, newer.id]);
  });

  test('renaming updates the timestamp and the slug stays stable', async () => {
    const thread = await engine.threads.create({ workspaceId: workspace.id, name: 'Plan' });
    const renamed = await engine.threads.rename(thread.id, 'Plan v2');

    expect(renamed.name).toBe('Plan v2');
    expect(renamed.slug).toBe(thread.slug);
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(thread.updatedAt);
  });

  test('creating a message keeps messageCount and the snippet in sync', async () => {
    const thread = await engine.threads.create({ workspaceId: workspace.id, name: 'Counts' });
    await engine.messages.createUserTurn(thread.id, 'first message');
    await engine.messages.createUserTurn(thread.id, 'second message');

    const listed = await engine.threads.list(workspace.id);
    expect(listed[0]).toMatchObject({
      id: thread.id,
      messageCount: 2,
      lastMessageSnippet: 'second message',
    });
  });

  test('an empty thread has a null snippet', async () => {
    await engine.threads.create({ workspaceId: workspace.id, name: 'Empty' });
    const [thread] = await engine.threads.list(workspace.id);
    expect(thread.lastMessageSnippet).toBeNull();
  });

  test('rejects a thread for a missing workspace', async () => {
    await expect(
      engine.threads.create({ workspaceId: 'ws_missing', name: 'Orphan' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('threads of different workspaces do not leak into each other', async () => {
    const other = await engine.workspaces.create({ name: 'Other' });
    await engine.threads.create({ workspaceId: workspace.id, name: 'Mine' });
    await engine.threads.create({ workspaceId: other.id, name: 'Theirs' });

    const mine = await engine.threads.list(workspace.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('Mine');
  });
});

describe('messages', () => {
  let thread;

  beforeEach(async () => {
    const workspace = await engine.workspaces.create({ name: 'Chats' });
    thread = await engine.threads.create({ workspaceId: workspace.id, name: 'Main' });
  });

  test('a user turn is stored with sender USER and empty JSON collections', async () => {
    const message = await engine.messages.createUserTurn(thread.id, 'Hello Vukko');

    expect(message).toMatchObject({
      threadId: thread.id,
      sender: 'USER',
      content: 'Hello Vukko',
      citations: [],
      toolsUsed: [],
      attachments: [],
      agentSteps: [],
      tags: [],
      isStreaming: false,
      isAgentExecution: false,
      isFavorite: false,
      isPinned: false,
      thinking: null,
      createdDocumentId: null,
    });
    expect(message.id).toMatch(/^msg_[0-9a-f]{12}$/);
  });

  test('messages come back in timestamp order even when inserted out of order', async () => {
    const second = await engine.messages.append({
      threadId: thread.id,
      sender: 'ASSISTANT',
      content: 'second',
      timestamp: 1_700_000_002_000,
    });
    const first = await engine.messages.append({
      threadId: thread.id,
      sender: 'USER',
      content: 'first',
      timestamp: 1_700_000_001_000,
    });

    const listed = await engine.messages.list(thread.id);
    expect(listed.map((message) => message.id)).toEqual([first.id, second.id]);
  });

  test('round-trips citations, tools, attachments, agent steps and tags', async () => {
    const message = await engine.messages.append({
      threadId: thread.id,
      sender: 'ASSISTANT',
      content: 'Answer',
      citations: [{ title: 'doc.md', source: 'Section 1', snippet: 'text', score: 0.9 }],
      toolsUsed: [
        {
          toolName: 'DocumentRAG',
          description: 'search',
          input: 'q',
          output: 'hit',
          isSuccess: true,
        },
      ],
      attachments: [
        {
          id: 'att_1',
          name: 'a.png',
          mimeType: 'image/png',
          sizeDisplay: '1 KB',
          previewText: null,
        },
      ],
      agentSteps: [
        {
          stepIndex: 1,
          title: 'Plan',
          description: 'd',
          toolName: 'Planner',
          status: 'COMPLETED',
          toolInput: null,
          toolOutput: 'ok',
          executionTimeMs: 12,
        },
      ],
      tags: ['answer'],
      isAgentExecution: true,
      createdDocumentId: 'doc_9',
      createdDocumentName: 'out.md',
    });

    const [reloaded] = await engine.messages.list(thread.id);
    expect(reloaded).toEqual(message);
    expect(reloaded.citations[0].score).toBeCloseTo(0.9);
    expect(reloaded.agentSteps[0].executionTimeMs).toBe(12);
  });

  test('a record with malformed JSON fails loudly instead of being silently emptied', async () => {
    await engine.messages.append({ threadId: thread.id, sender: 'USER', content: 'x' });
    await engine.rawExec("UPDATE chat_messages SET citationsJson = '{not json'");

    await expect(engine.messages.list(thread.id)).rejects.toMatchObject({ code: 'STORAGE' });
  });

  test('favourite and pin toggles are persisted as booleans', async () => {
    const message = await engine.messages.createUserTurn(thread.id, 'toggle me');
    await engine.messages.setFavorite(message.id, true);
    await engine.messages.setPinned(message.id, true);

    const [reloaded] = await engine.messages.list(thread.id);
    expect(reloaded.isFavorite).toBe(true);
    expect(reloaded.isPinned).toBe(true);

    await engine.messages.setFavorite(message.id, false);
    expect((await engine.messages.list(thread.id))[0].isFavorite).toBe(false);
  });

  test('tags replace the previous set and are normalised', async () => {
    const message = await engine.messages.createUserTurn(thread.id, 'tag me');
    await engine.messages.setTags(message.id, ['  alpha ', 'alpha', 'beta']);
    expect((await engine.messages.list(thread.id))[0].tags).toEqual(['alpha', 'beta']);

    await engine.messages.setTags(message.id, []);
    expect((await engine.messages.list(thread.id))[0].tags).toEqual([]);
  });

  test('delete removes one message and repairs the thread counters', async () => {
    const first = await engine.messages.createUserTurn(thread.id, 'one');
    await engine.messages.createUserTurn(thread.id, 'two');

    await engine.messages.delete(first.id);

    const listed = await engine.messages.list(thread.id);
    expect(listed.map((message) => message.content)).toEqual(['two']);
    const [reloadedThread] = await engine.threads.list((await engine.workspaces.list())[0].id);
    expect(reloadedThread.messageCount).toBe(1);
    expect(reloadedThread.lastMessageSnippet).toBe('two');
  });

  test('rejects a message for a missing thread and an empty body', async () => {
    await expect(engine.messages.createUserTurn('th_missing', 'hello')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(engine.messages.createUserTurn(thread.id, '   ')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  test('publishes one message.created event per stored message', async () => {
    events();
    await engine.messages.append({ threadId: thread.id, sender: 'ASSISTANT', content: 'hi' });
    const emitted = events();
    expect(emitted).toEqual([
      { type: 'message.created', message: expect.objectContaining({ content: 'hi' }) },
    ]);
  });
});

describe('documents', () => {
  let workspace;

  beforeEach(async () => {
    workspace = await engine.workspaces.create({ name: 'Docs' });
  });

  test('create derives display size, summary and vector count, and updates the workspace counters', async () => {
    const document = await engine.documents.create({
      workspaceId: workspace.id,
      name: 'notes.md',
      type: 'MARKDOWN',
      content: 'a'.repeat(2048),
    });

    expect(document.id).toMatch(/^doc_[0-9a-f]{12}$/);
    expect(document.size).toBe('2 KB');
    expect(document.contentSummary).toBe('a'.repeat(160));
    expect(document.fullContent).toHaveLength(2048);
    // 2048 bytes / 512-byte chunks, rounded up.
    expect(document.vectorCount).toBe(4);

    const reloaded = await engine.workspaces.get(workspace.id);
    expect(reloaded.documentCount).toBe(1);
    expect(reloaded.vectorCount).toBe(4);
  });

  test('delete decrements the workspace counters', async () => {
    const document = await engine.documents.create({
      workspaceId: workspace.id,
      name: 'notes.md',
      type: 'MARKDOWN',
      content: 'x'.repeat(1024),
    });
    await engine.documents.delete(document.id);

    const reloaded = await engine.workspaces.get(workspace.id);
    expect(reloaded.documentCount).toBe(0);
    expect(reloaded.vectorCount).toBe(0);
  });

  test('rejects an unknown document type', async () => {
    await expect(
      engine.documents.create({
        workspaceId: workspace.id,
        name: 'x.bin',
        type: 'EXECUTABLE',
        content: 'x',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('settings', () => {
  test('defaults match the Kotlin preferences', async () => {
    expect(await engine.settings.getAll()).toEqual({
      activeWorkspaceId: 'ws_default',
      activeThreadId: 'th_default',
      selectedProvider: 'GEMINI',
      selectedModelId: 'gemini-2.5-flash',
      instanceUrl: 'http://10.0.2.2:3001',
      webSearchEnabled: true,
      autoApproveTools: true,
      biometricLockEnabled: false,
      backupEnabled: false,
      backupFrequencyHours: 24,
      backupTarget: 'GITHUB',
    });
  });

  test('writes round-trip with their types', async () => {
    await engine.settings.set('selectedProvider', 'OLLAMA');
    await engine.settings.set('backupFrequencyHours', 6);
    await engine.settings.set('biometricLockEnabled', true);

    const settings = await engine.settings.getAll();
    expect(settings.selectedProvider).toBe('OLLAMA');
    expect(settings.backupFrequencyHours).toBe(6);
    expect(settings.biometricLockEnabled).toBe(true);
  });

  test('rejects an unknown key and a value of the wrong type', async () => {
    await expect(engine.settings.set('dropTables', 'yes')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(engine.settings.set('selectedProvider', 'NOT_A_PROVIDER')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(engine.settings.set('backupFrequencyHours', 'sometimes')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  test('never accepts a secret-shaped key', async () => {
    await expect(engine.settings.set('githubToken', 'ghp_x')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('storage stats and integrity', () => {
  test('counts every table the inspector shows', async () => {
    const workspace = await engine.workspaces.create({ name: 'Stats' });
    const thread = await engine.threads.create({ workspaceId: workspace.id, name: 'T' });
    await engine.messages.createUserTurn(thread.id, 'one');
    await engine.documents.create({
      workspaceId: workspace.id,
      name: 'd.md',
      type: 'MARKDOWN',
      content: 'body',
    });

    expect(await engine.storage.stats()).toEqual({
      databaseName: 'vukko_sovereign.db',
      totalWorkspaces: 1,
      totalThreads: 1,
      totalMessages: 1,
      totalDocuments: 1,
      isLocalEncrypted: true,
      storageType: 'Rust SQLite (Local Device Only)',
      dataSovereigntyStatus: 'Air-Gapped Sovereign Storage',
    });
  });

  test('integrity check reports ok and the real table counts', async () => {
    const report = await engine.storage.runIntegrityCheck();
    expect(report.ok).toBe(true);
    expect(report.integrityCheck).toBe('ok');
    expect(report.foreignKeyViolations).toBe(0);
    expect(report.tableCounts.map((count) => count.table)).toEqual([
      'workspaces',
      'chat_threads',
      'chat_messages',
      'workspace_documents',
    ]);
    expect(report.checkedAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('integrity check fails when a foreign key is violated', async () => {
    await engine.rawExec('PRAGMA foreign_keys = OFF;');
    await engine.rawExec(
      "INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, isPinned) VALUES ('th_ghost', 'ws_ghost', 'G', 'g', 1, 1, 0, 0)",
    );

    const report = await engine.storage.runIntegrityCheck();
    expect(report.ok).toBe(false);
    expect(report.foreignKeyViolations).toBeGreaterThan(0);
  });
});
