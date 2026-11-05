/**
 * Characterisation tests over the legacy Room v1 database.
 *
 * These tests freeze what the shipped Kotlin application stores today
 * (MIGRATION_PLAN.md §3, Step 0.1). Every later migration task asserts against
 * these facts, so a change in this file is a change in the compatibility
 * contract and must be a deliberate decision.
 */

const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { buildFixture, FIXTURE_NAMES, BASE_TIMESTAMP } = require('./buildLegacyDb.cjs');

let workDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'vukko-legacy-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function fixture(name) {
  return buildFixture(name, join(workDir, `${name}.db`));
}

function open(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n;
}

describe('legacy Room schema', () => {
  test('every fixture the migration tests need can be built', () => {
    expect(FIXTURE_NAMES).toEqual(
      expect.arrayContaining(['empty', 'workspace_only', 'nested', 'rich', 'corrupted', 'partial']),
    );
    for (const name of FIXTURE_NAMES) {
      expect(existsSync(fixture(name))).toBe(true);
    }
  });

  test('records Room schema version 1 in user_version', () => {
    const db = open(fixture('empty'));
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(1);
    db.close();
  });

  test('declares the four application tables and the two Room bookkeeping tables', () => {
    const db = open(fixture('empty'));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'android_metadata',
        'chat_messages',
        'chat_threads',
        'room_master_table',
        'workspace_documents',
        'workspaces',
      ]),
    );
    db.close();
  });

  test('keeps the indexes the Kotlin entities declared', () => {
    const db = open(fixture('empty'));
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'index_%'")
      .all()
      .map((row) => row.name)
      .sort();

    expect(indexes).toEqual([
      'index_chat_messages_isFavorite',
      'index_chat_messages_threadId',
      'index_chat_messages_timestamp',
      'index_chat_threads_isPinned',
      'index_chat_threads_updatedAt',
      'index_chat_threads_workspaceId',
      'index_workspace_documents_workspaceId',
    ]);
    db.close();
  });

  test('chat_threads.workspaceId is a cascading foreign key to workspaces.id', () => {
    const db = open(fixture('nested'));
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(chat_threads)').all();
    expect(foreignKeys).toEqual([
      expect.objectContaining({
        table: 'workspaces',
        from: 'workspaceId',
        to: 'id',
        on_delete: 'CASCADE',
      }),
    ]);
    db.close();
  });

  test('chat_messages.threadId is a cascading foreign key to chat_threads.id', () => {
    const db = open(fixture('nested'));
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(chat_messages)').all();
    expect(foreignKeys).toEqual([
      expect.objectContaining({
        table: 'chat_threads',
        from: 'threadId',
        to: 'id',
        on_delete: 'CASCADE',
      }),
    ]);
    db.close();
  });
});

describe('legacy fixture contents', () => {
  test('empty fixture has the schema but no rows', () => {
    const db = open(fixture('empty'));
    for (const table of ['workspaces', 'chat_threads', 'chat_messages', 'workspace_documents']) {
      expect(count(db, table)).toBe(0);
    }
    db.close();
  });

  test('workspace_only fixture holds exactly one workspace and nothing else', () => {
    const db = open(fixture('workspace_only'));
    expect(count(db, 'workspaces')).toBe(1);
    expect(count(db, 'chat_threads')).toBe(0);
    expect(db.prepare('SELECT id, name FROM workspaces').get()).toEqual({
      id: 'ws_default',
      name: 'Default Workspace',
    });
    db.close();
  });

  test('nested fixture preserves workspace → thread → message hierarchy', () => {
    const db = open(fixture('nested'));
    expect(count(db, 'workspaces')).toBe(2);
    expect(count(db, 'chat_threads')).toBe(3);
    expect(count(db, 'chat_messages')).toBe(4);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  test('messages come back in ascending timestamp order for a thread', () => {
    const db = open(fixture('nested'));
    const rows = db
      .prepare('SELECT id, timestamp FROM chat_messages WHERE threadId = ? ORDER BY timestamp ASC')
      .all('th_default');
    expect(rows.map((row) => row.id)).toEqual(['msg_1', 'msg_2']);
    expect(rows[0].timestamp).toBeLessThan(rows[1].timestamp);
    db.close();
  });

  test('threads come back pinned first, then most recently updated', () => {
    const db = open(fixture('nested'));
    const rows = db
      .prepare(
        'SELECT id FROM chat_threads WHERE workspaceId = ? ORDER BY isPinned DESC, updatedAt DESC, createdAt DESC',
      )
      .all('ws_default');
    expect(rows.map((row) => row.id)).toEqual(['th_notes', 'th_default']);
    db.close();
  });

  test('JSON columns round-trip citations, attachments, tools, agent steps and tags', () => {
    const db = open(fixture('rich'));
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg_2');

    expect(JSON.parse(row.citationsJson)).toEqual([
      {
        title: 'vukko-getting-started.pdf',
        source: 'Section 1.1',
        snippet: 'Vukko is a full-stack AI application engineered for privacy.',
        score: 0.95,
      },
    ]);
    expect(JSON.parse(row.attachmentsJson)).toEqual([
      {
        id: 'att_1',
        name: 'screenshot.png',
        mimeType: 'image/png',
        sizeDisplay: '184 KB',
        previewText: null,
      },
    ]);
    expect(JSON.parse(row.toolsUsedJson)[0]).toEqual(
      expect.objectContaining({ toolName: 'DocumentRAG', isSuccess: true }),
    );
    expect(JSON.parse(row.tagsJson)).toEqual(['welcome', 'privacy']);

    const agentRow = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg_agent_2');
    expect(JSON.parse(agentRow.agentStepsJson).map((step) => step.stepIndex)).toEqual([1, 2]);
    expect(agentRow.isAgentExecution).toBe(1);
    expect(agentRow.createdDocumentId).toBe('doc_agent_created_1');
    db.close();
  });

  test('nullable columns stay null rather than becoming empty strings', () => {
    const db = open(fixture('rich'));
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg_1');
    expect(row.thinking).toBeNull();
    expect(row.thinkingDurationMs).toBeNull();
    expect(row.createdDocumentId).toBeNull();

    const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get('th_notes');
    expect(thread.lastMessageSnippet).toBeNull();
    db.close();
  });

  test('boolean columns are stored as 0/1 integers', () => {
    const db = open(fixture('rich'));
    const row = db
      .prepare('SELECT isFavorite, isPinned FROM chat_messages WHERE id = ?')
      .get('msg_2');
    expect(row).toEqual({ isFavorite: 1, isPinned: 0 });
    db.close();
  });

  test('timestamps are Unix milliseconds, not seconds', () => {
    const db = open(fixture('rich'));
    const { createdAt } = db
      .prepare('SELECT createdAt FROM workspaces WHERE id = ?')
      .get('ws_default');
    expect(createdAt).toBe(BASE_TIMESTAMP);
    // 1.7e12 ms is 2023; a seconds-based timestamp would be ~1.7e9.
    expect(createdAt).toBeGreaterThan(1_000_000_000_000);
    db.close();
  });

  test('documents keep nullable-ish empty metadata as empty strings, not null', () => {
    const db = open(fixture('rich'));
    const row = db.prepare('SELECT * FROM workspace_documents WHERE id = ?').get('doc_blank');
    expect(row.contentSummary).toBe('');
    expect(row.fullContent).toBe('');
    expect(row.vectorCount).toBe(0);
    expect(row.type).toBe('WEB_LINK');
    db.close();
  });
});

describe('legacy failure modes', () => {
  test('a corrupted page raises instead of returning partial data', () => {
    const db = open(fixture('corrupted'));
    expect(() => db.prepare('SELECT * FROM chat_messages').all()).toThrow();
    db.close();
  });

  test('a partially written database is detectable by its missing bookkeeping table', () => {
    const db = open(fixture('partial'));
    const hasMasterTable = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'room_master_table'",
      )
      .get().n;
    expect(hasMasterTable).toBe(0);
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    db.close();
  });
});
