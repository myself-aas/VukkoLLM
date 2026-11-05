/**
 * Legacy Room → Rust adoption tests (MIGRATION_PLAN.md §6 Steps 3.1–3.3).
 *
 * These execute the *real* migration SQL that `vukko-db` embeds
 * (`rust/crates/vukko-db/migrations/*.sql`, loaded by path) against the legacy
 * fixtures, through `tests/migration/support/adopt.cjs` — a test oracle that
 * performs the same ten steps in the same order as the Rust runner:
 *
 *   1 detect `vukko_sovereign.db`, 2 copy to a backup, 3 inspect user_version and
 *   Room metadata, 4 apply forward-only migrations transactionally, 5 validate
 *   counts and foreign keys, 6 mark complete, 7 retain the backup until the next
 *   successful launch, 8 recover (restore backup) when validation fails.
 *
 * The oracle exists because this environment has no Rust toolchain (see
 * docs/RUST_VERIFICATION.md); it is the executable half of the same design and
 * lives under tests/ only.
 */

const {
  mkdtempSync,
  rmSync,
  copyFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { buildFixture } = require('./fixtures/buildLegacyDb.cjs');
const { adoptDatabase, SCHEMA_VERSION, MIGRATIONS_DIR } = require('./support/adopt.cjs');

let workDir;
let counter = 0;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'vukko-adopt-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function dbPathFor(name) {
  counter += 1;
  return buildFixture(name, join(workDir, `${name}-${counter}.db`));
}

function counts(path) {
  const db = new DatabaseSync(path);
  const result = {};
  for (const table of ['workspaces', 'chat_threads', 'chat_messages', 'workspace_documents']) {
    result[table] = db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n;
  }
  db.close();
  return result;
}

describe('migration files are the source of truth', () => {
  test('the four numbered migrations exist and are ordered', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    expect(files).toEqual([
      '0001_legacy_room_schema.sql',
      '0002_add_indexes.sql',
      '0003_add_backup_metadata.sql',
      '0004_add_provider_secrets_metadata.sql',
      '0005_add_app_settings.sql',
    ]);
    expect(SCHEMA_VERSION).toBe(5);
  });

  test('no migration drops a table or a legacy column', () => {
    const offenders = [];
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      // The session table is the only thing allowed to be deleted from, and no
      // migration may drop a legacy table.
      if (/DROP\s+TABLE/i.test(sql)) offenders.push(file);
      if (
        /ALTER\s+TABLE\s+`?(workspaces|chat_threads|chat_messages|workspace_documents)`?\s+DROP/i.test(
          sql,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('fresh install', () => {
  test('creates the schema at the current version with no legacy rows', () => {
    const path = join(workDir, 'fresh.db');
    const result = adoptDatabase(path);

    expect(result.status).toBe('COMPLETED');
    expect(result.ownership).toBe('RUST');
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(SCHEMA_VERSION);
    expect(result.migratedFromLegacy).toBe(false);
    expect(result.backupPath).toBeNull();

    const db = new DatabaseSync(path);
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(SCHEMA_VERSION);
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name)
      .sort();
    expect(tables).toEqual(
      expect.arrayContaining([
        'app_settings',
        'backup_runs',
        'chat_messages',
        'chat_threads',
        'provider_secrets',
        'workspace_documents',
        'workspaces',
      ]),
    );
    db.close();
  });

  test('is idempotent: adopting twice changes nothing', () => {
    const path = join(workDir, 'fresh-twice.db');
    adoptDatabase(path);
    const first = counts(path);
    const second = adoptDatabase(path);

    expect(second.status).toBe('COMPLETED');
    expect(second.fromVersion).toBe(SCHEMA_VERSION);
    expect(second.toVersion).toBe(SCHEMA_VERSION);
    expect(second.migrationsApplied).toBe(0);
    expect(counts(path)).toEqual(first);
  });
});

describe('legacy adoption preserves every row', () => {
  test.each(['empty', 'workspace_only', 'nested', 'rich'])('%s fixture', (fixture) => {
    const path = dbPathFor(fixture);
    const before = counts(path);

    const result = adoptDatabase(path);

    expect(result.status).toBe('COMPLETED');
    expect(result.ownership).toBe('RUST');
    expect(result.migratedFromLegacy).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(SCHEMA_VERSION);
    expect(counts(path)).toEqual(before);

    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON;');
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  test('keeps identifiers, timestamps, JSON columns and nullability byte-identical', () => {
    const path = dbPathFor('rich');

    const readLegacy = () => {
      const db = new DatabaseSync(path);
      const rows = {
        workspaces: db.prepare('SELECT * FROM workspaces ORDER BY id').all(),
        threads: db.prepare('SELECT * FROM chat_threads ORDER BY id').all(),
        messages: db.prepare('SELECT * FROM chat_messages ORDER BY id').all(),
        documents: db.prepare('SELECT * FROM workspace_documents ORDER BY id').all(),
      };
      db.close();
      return rows;
    };

    const before = readLegacy();
    adoptDatabase(path);
    const after = readLegacy();

    // Legacy columns only: new columns may be added, existing values may not move.
    const legacyProjection = (row, columns) =>
      Object.fromEntries(columns.map((column) => [column, row[column]]));

    const messageColumns = [
      'id',
      'threadId',
      'sender',
      'content',
      'timestamp',
      'thinking',
      'thinkingDurationMs',
      'citationsJson',
      'toolsUsedJson',
      'attachmentsJson',
      'isStreaming',
      'isAgentExecution',
      'agentStepsJson',
      'createdDocumentId',
      'createdDocumentName',
      'isFavorite',
      'isPinned',
      'tagsJson',
    ];

    expect(after.messages.map((row) => legacyProjection(row, messageColumns))).toEqual(
      before.messages.map((row) => legacyProjection(row, messageColumns)),
    );
    // Derived counters are the one thing migration 0002 rewrites on purpose:
    // they are a cache the Kotlin app maintained by hand, and the seed data
    // shipped with wrong values. Everything else must be identical.
    const withoutCounters = (row) => {
      const { documentCount, vectorCount, messageCount, ...rest } = row;
      return rest;
    };
    expect(after.workspaces.map(withoutCounters)).toEqual(before.workspaces.map(withoutCounters));
    expect(after.threads.map(withoutCounters)).toEqual(before.threads.map(withoutCounters));
    expect(after.documents).toEqual(before.documents);
  });

  test('repairs the derived counters the Kotlin client kept by hand', () => {
    const path = dbPathFor('rich');
    const db = new DatabaseSync(path);
    // Seed data shipped inconsistent counters: ws_default claims 2 documents
    // while only 1 row exists, and th_default claims 2 messages.
    expect(
      db.prepare("SELECT documentCount FROM workspaces WHERE id = 'ws_default'").get(),
    ).toEqual({
      documentCount: 2,
    });
    db.close();

    adoptDatabase(path);

    const after = new DatabaseSync(path);
    const expected = after
      .prepare(
        'SELECT w.id, COUNT(d.id) AS documents, COALESCE(SUM(d.vectorCount), 0) AS vectors FROM workspaces w LEFT JOIN workspace_documents d ON d.workspaceId = w.id GROUP BY w.id ORDER BY w.id',
      )
      .all();
    for (const row of expected) {
      const actual = after
        .prepare('SELECT documentCount, vectorCount FROM workspaces WHERE id = ?')
        .get(row.id);
      expect(actual).toEqual({ documentCount: row.documents, vectorCount: row.vectors });
    }

    const threads = after.prepare('SELECT id, messageCount FROM chat_threads').all();
    for (const thread of threads) {
      const actual = after
        .prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE threadId = ?')
        .get(thread.id).n;
      expect(thread.messageCount).toBe(actual);
    }
    after.close();
  });

  test('writes a backup before touching the database and keeps it until the next launch', () => {
    const path = dbPathFor('rich');
    const originalBytes = readFileSync(path);

    const result = adoptDatabase(path);

    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath)).toBe(true);
    expect(readFileSync(result.backupPath).equals(originalBytes)).toBe(true);

    // The backup is what the recovery path restores, so it must still open as a
    // legacy database.
    const backupDb = new DatabaseSync(result.backupPath);
    expect(backupDb.prepare('PRAGMA user_version').get().user_version).toBe(1);
    expect(backupDb.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n).toBe(4);
    backupDb.close();

    // Next successful launch retires it.
    const next = adoptDatabase(path);
    expect(next.status).toBe('COMPLETED');
    expect(existsSync(result.backupPath)).toBe(false);
  });
});

describe('legacy data repair', () => {
  test('normalises unknown enum values the way the Kotlin domain layer did', () => {
    const path = dbPathFor('nested');
    const db = new DatabaseSync(path);
    db.prepare("UPDATE chat_messages SET sender = 'ROBOT' WHERE id = 'msg_1'").run();
    db.prepare("UPDATE workspaces SET queryMode = 'WEIRD' WHERE id = 'ws_default'").run();
    db.close();

    adoptDatabase(path);

    const check = new DatabaseSync(path);
    expect(check.prepare("SELECT sender FROM chat_messages WHERE id = 'msg_1'").get().sender).toBe(
      'ASSISTANT',
    );
    expect(
      check.prepare("SELECT queryMode FROM workspaces WHERE id = 'ws_default'").get().queryMode,
    ).toBe('CHAT');
    check.close();
  });

  test('rejects an invalid sender written after migration', () => {
    const path = dbPathFor('nested');
    adoptDatabase(path);

    const db = new DatabaseSync(path);
    expect(() =>
      db
        .prepare(
          "INSERT INTO chat_messages (id, threadId, sender, content, timestamp, citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, agentStepsJson, isFavorite, isPinned, tagsJson) VALUES ('m', 'th_default', 'ROBOT', 'x', 1, '[]', '[]', '[]', 0, 0, '[]', 0, 0, '[]')",
        )
        .run(),
    ).toThrow(/sender/);
    db.close();
  });
});

describe('failure paths keep the user data intact', () => {
  test('a corrupted database is refused, untouched, with an explicit error', () => {
    const path = dbPathFor('corrupted');
    const originalBytes = readFileSync(path);

    expect(() => adoptDatabase(path)).toThrow(expect.objectContaining({ code: 'STORAGE' }));

    expect(readFileSync(path).equals(originalBytes)).toBe(true);
    const db = new DatabaseSync(path);
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(1);
    db.close();
  });

  test('a database from a newer schema is refused instead of downgraded', () => {
    const path = dbPathFor('nested');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99;');
    db.close();

    expect(() => adoptDatabase(path)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));

    const check = new DatabaseSync(path);
    expect(check.prepare('PRAGMA user_version').get().user_version).toBe(99);
    check.close();
  });

  test('orphan rows fail validation and restore the backup', () => {
    const path = dbPathFor('nested');
    // A database written while foreign keys were disabled can hold orphans.
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = OFF;');
    db.prepare(
      "INSERT INTO chat_messages (id, threadId, sender, content, timestamp, citationsJson, toolsUsedJson, attachmentsJson, isStreaming, isAgentExecution, agentStepsJson, isFavorite, isPinned, tagsJson) VALUES ('orphan', 'th_gone', 'USER', 'x', 1, '[]', '[]', '[]', 0, 0, '[]', 0, 0, '[]')",
    ).run();
    db.close();

    expect(() => adoptDatabase(path)).toThrow(expect.objectContaining({ code: 'STORAGE' }));

    const check = new DatabaseSync(path);
    expect(check.prepare('PRAGMA user_version').get().user_version).toBe(1);
    expect(
      check.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE id = 'orphan'").get().n,
    ).toBe(1);
    check.close();
  });

  test('a half-written legacy database is still adopted', () => {
    const path = dbPathFor('partial');
    const result = adoptDatabase(path);
    expect(result.status).toBe('COMPLETED');
    expect(result.migratedFromLegacy).toBe(true);
    expect(counts(path).workspaces).toBe(2);
  });
});

describe('recovery', () => {
  test('a failed migration can be recovered from its retained backup', () => {
    const path = dbPathFor('nested');
    const originalBytes = readFileSync(path);

    // Simulate a crash mid-migration: backup written, state marked MIGRATING.
    const backupPath = `${path}.premigration-backup`;
    copyFileSync(path, backupPath);
    const statePath = `${path}.migration-state.json`;
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({
        status: 'MIGRATING',
        fromVersion: 1,
        toVersion: SCHEMA_VERSION,
        backupPath,
      }),
    );

    const result = adoptDatabase(path);

    expect(result.recovered).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(readFileSync(path).equals(originalBytes)).toBe(false);
    expect(existsSync(statePath)).toBe(false);
  });
});
