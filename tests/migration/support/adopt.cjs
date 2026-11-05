/**
 * Test oracle for the Rust migration runner.
 *
 * This file is NOT production code. It performs, against a real SQLite engine,
 * the exact sequence `rust/crates/vukko-db/src/migrate.rs` performs, using the
 * exact SQL files in `rust/crates/vukko-db/migrations/`. It exists because the
 * execution environment has no Rust toolchain (docs/RUST_VERIFICATION.md): the
 * migrations themselves are exercised here, and the Rust runner must match this
 * behaviour step for step. Any change to the runner must change this oracle and
 * its tests in the same commit, or CI's Rust tests and these will disagree.
 *
 * Steps (MIGRATION_PLAN.md §6 Step 3.3):
 *   1. detect the database (absent → fresh install path)
 *   2. copy it to `<db>.premigration-backup` before writing anything
 *   3. inspect `PRAGMA user_version` and the Room metadata table
 *   4. apply pending migrations, each in its own transaction
 *   5. validate counts and referential integrity
 *   6. mark complete (user_version = latest); the journal row is the marker
 *   7. retain the backup until the next successful launch
 *   8. on any failure: restore the backup, leave user_version untouched, throw
 */

const {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} = require('node:fs');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'rust',
  'crates',
  'vukko-db',
  'migrations',
);

const BACKUP_SUFFIX = '.premigration-backup';
const STATE_SUFFIX = '.migration-state.json';

/** Ordered migration files; the array index + 1 is the schema version. */
function migrationFiles() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const [index, file] of files.entries()) {
    const expected = `${String(index + 1).padStart(4, '0')}_`;
    if (!file.startsWith(expected)) {
      throw new Error(`migration ${file} is out of order; expected prefix ${expected}`);
    }
  }
  return files.map((file) => ({
    version: files.indexOf(file) + 1,
    file,
    path: join(MIGRATIONS_DIR, file),
  }));
}

const MIGRATIONS = migrationFiles();
const SCHEMA_VERSION = MIGRATIONS.length;

/** Legacy tables whose contents must survive adoption, in dependency order. */
const LEGACY_TABLES = ['workspaces', 'chat_threads', 'chat_messages', 'workspace_documents'];

function tableExists(db, table) {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table).n > 0
  );
}

function snapshotCounts(db) {
  const counts = {};
  for (const table of LEGACY_TABLES) {
    counts[table] = tableExists(db, table)
      ? db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n
      : 0;
  }
  return counts;
}

function fail(code, message, extra) {
  const error = new Error(message);
  error.code = code;
  if (extra) Object.assign(error, extra);
  return error;
}

/**
 * Runs one migration file's statements inside a transaction.
 * `BEGIN IMMEDIATE` takes the write lock up front so a concurrent writer fails
 * fast instead of half-applying a migration.
 */
function applyMigration(db, migration) {
  const sql = readFileSync(migration.path, 'utf8');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(sql);
    db.exec(`PRAGMA user_version = ${migration.version};`);
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // A rollback failure means SQLite already unwound the transaction; the
      // original error is the one worth reporting.
    }
    throw fail('STORAGE', `migration ${migration.file} failed: ${error.message}`);
  }
}

/**
 * Validates a migrated database: integrity, referential integrity, and that the
 * legacy row counts match what they were before adoption.
 */
function validate(db, expectedCounts) {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') {
    throw fail('STORAGE', `integrity check failed: ${integrity}`);
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw fail('STORAGE', `foreign key violations after migration: ${violations.length}`, {
      violations,
    });
  }

  const actual = snapshotCounts(db);
  for (const table of LEGACY_TABLES) {
    if (actual[table] !== expectedCounts[table]) {
      throw fail(
        'STORAGE',
        `row count changed for ${table}: ${expectedCounts[table]} -> ${actual[table]}`,
      );
    }
  }
}

/**
 * Adopts (or creates) a database.
 *
 * @param {string} path  database file; may not exist yet
 * @returns {{status: string, ownership: string, fromVersion: number,
 *            toVersion: number, migrationsApplied: number,
 *            migratedFromLegacy: boolean, backupPath: string|null,
 *            recovered: boolean, warnings: string[]}}
 */
function adoptDatabase(path) {
  const warnings = [];
  const statePath = `${path}${STATE_SUFFIX}`;
  const backupPath = `${path}${BACKUP_SUFFIX}`;
  const existed = existsSync(path);
  let recovered = false;

  // Recovery: a previous run died between the backup and the commit.
  if (existed && existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.status === 'MIGRATING') {
      const restoreFrom =
        state.backupPath && existsSync(state.backupPath) ? state.backupPath : backupPath;
      if (existsSync(restoreFrom)) {
        copyFileSync(restoreFrom, path);
        recovered = true;
        warnings.push(`restored database from ${restoreFrom} after an interrupted migration`);
      } else {
        warnings.push('interrupted migration found but its backup is missing; database untouched');
      }
    }
    rmSync(statePath, { force: true });
  }

  // Step 1/2: detect and back up before writing anything.
  let legacyBackup = null;
  if (existed) {
    legacyBackup = backupPath;
    copyFileSync(path, legacyBackup);
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  let fromVersion = db.prepare('PRAGMA user_version').get().user_version;
  const legacyTables = tableExists(db, 'workspaces');
  const roomMetadata = tableExists(db, 'room_master_table');

  // Step 3: refuse the impossible instead of guessing.
  if (fromVersion > SCHEMA_VERSION) {
    db.close();
    rmSync(backupPath, { force: true });
    throw fail(
      'UNSUPPORTED',
      `database schema version ${fromVersion} is newer than this build supports (${SCHEMA_VERSION})`,
    );
  }

  // A database with tables but version 0 (or a Room version we did not write)
  // is a legacy install; Room always reports version 1 here.
  const migratedFromLegacy = existed && legacyTables && fromVersion < SCHEMA_VERSION;
  if (legacyTables && !roomMetadata) {
    warnings.push('legacy database has no room_master_table; treated as an interrupted Room write');
  }

  // A read of a corrupted database raises here, before any write.
  let beforeCounts;
  try {
    db.prepare('PRAGMA integrity_check').get();
    beforeCounts = snapshotCounts(db);
  } catch (error) {
    db.close();
    rmSync(backupPath, { force: true });
    throw fail('STORAGE', `database cannot be read: ${error.message}`);
  }

  // Step 4/5/6
  const pending = MIGRATIONS.filter((migration) => migration.version > fromVersion);
  if (pending.length > 0 && existed) {
    writeFileSync(
      statePath,
      JSON.stringify({
        status: 'MIGRATING',
        fromVersion,
        toVersion: SCHEMA_VERSION,
        backupPath,
        startedAt: Date.now(),
      }),
    );
  }

  try {
    for (const migration of pending) {
      applyMigration(db, migration);
    }
    validate(db, beforeCounts);
  } catch (error) {
    db.close();
    // Step 8: put the pre-migration bytes back, so the next launch can retry
    // (or the Kotlin app can still open the file).
    if (existsSync(backupPath)) {
      copyFileSync(backupPath, path);
      const restored = new DatabaseSync(path);
      restored.close();
    }
    rmSync(statePath, { force: true });
    throw error;
  }

  const toVersion = db.prepare('PRAGMA user_version').get().user_version;
  const ownerTable = tableExists(db, 'provider_secrets');
  db.close();

  // Step 7: retire the backup only after a fully successful run, and only when
  // this call did not create it for the "next launch" test to observe.
  const retireBackup = recovered || (existed && !migratedFromLegacy);
  if (legacyBackup && retireBackup) {
    unlinkSync(legacyBackup);
  }

  rmSync(statePath, { force: true });

  return {
    status: 'COMPLETED',
    ownership: ownerTable ? 'RUST' : 'LEGACY_ROOM',
    fromVersion,
    toVersion,
    migrationsApplied: pending.length,
    migratedFromLegacy,
    backupPath: legacyBackup && existsSync(legacyBackup) ? legacyBackup : null,
    recovered,
    warnings,
  };
}

module.exports = {
  adoptDatabase,
  SCHEMA_VERSION,
  MIGRATIONS,
  MIGRATIONS_DIR,
  LEGACY_TABLES,
  BACKUP_SUFFIX,
  STATE_SUFFIX,
};
