#!/usr/bin/env node
/**
 * Regenerates the legacy Room fixture databases used by the migration tests.
 *
 * The databases are generated rather than committed (they are binary, and the
 * generator is the contract), so this script is the documented way to inspect
 * one by hand:  node scripts/build-fixtures.cjs [outDir]
 */
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { buildFixture, FIXTURE_NAMES } = require('../tests/migration/fixtures/buildLegacyDb.cjs');

const outDir = process.argv[2] || join(__dirname, '..', 'tests', 'migration', 'fixtures', 'out');
mkdirSync(outDir, { recursive: true });
for (const name of FIXTURE_NAMES) {
  buildFixture(name, join(outDir, `${name}.db`));
  console.log(`built ${name}.db`);
}
console.log(`fixtures written to ${outDir}`);
