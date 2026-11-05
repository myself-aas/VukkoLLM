/**
 * Phase 7, Step 7.2 — the guard behind the secure-storage rule.
 *
 * "API keys must not be stored in plain SQLite" is easy to state and easy to
 * break: one convenience column, one AsyncStorage write, and the promise is
 * gone. This test reads the source and the migrations so the rule is enforced
 * by the build rather than remembered by reviewers.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const MIGRATIONS = join(ROOT, 'rust', 'crates', 'vukko-db', 'migrations');
const RUST_REPOSITORY = join(ROOT, 'rust', 'crates', 'vukko-core', 'src', 'repository');

function files(directory: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...files(path, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

const SECRET_COLUMN = /\b(api_?key|token|secret|password)\b/i;

describe('no secret is stored in plain text', () => {
  test('no migration creates a column that would hold a credential', () => {
    const offenders: string[] = [];
    for (const path of files(MIGRATIONS, ['.sql'])) {
      const sql = readFileSync(path, 'utf8')
        // Comments explain why the rule exists; they are not schema.
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      for (const line of sql.split('\n')) {
        if (/CREATE TABLE|ALTER TABLE|ADD COLUMN/i.test(line) && SECRET_COLUMN.test(line)) {
          offenders.push(`${relative(ROOT, path)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the repository layer has no credential-bearing query', () => {
    const offenders: string[] = [];
    for (const path of files(RUST_REPOSITORY, ['.rs'])) {
      const source = readFileSync(path, 'utf8');
      for (const line of source.split('\n')) {
        if (SECRET_COLUMN.test(line) && /select|insert|update/i.test(line)) {
          offenders.push(`${relative(ROOT, path)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the JS layer never persists a secret itself', () => {
    const offenders: string[] = [];
    for (const path of files(SRC, ['.ts', '.tsx'])) {
      const source = readFileSync(path, 'utf8');
      // AsyncStorage is the tempting shortcut; it is not encrypted.
      if (/AsyncStorage/.test(source)) {
        offenders.push(relative(SRC, path));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('secrets are only reachable through the secure-storage module', () => {
    const secretReaders = files(SRC, ['.ts', '.tsx']).filter((path) => {
      const source = readFileSync(path, 'utf8');
      // The contract in types/native.ts declares the module; implementations
      // that *call* it live in exactly one place.
      return /\.getSecret\(/.test(source) || /module\.setSecret\(/.test(source);
    });

    expect(secretReaders.map((path) => relative(SRC, path))).toEqual(['native/integrations.ts']);
  });
});
