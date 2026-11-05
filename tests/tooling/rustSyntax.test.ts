/**
 * A syntax gate for the Rust tree.
 *
 * The migration is written on a machine without a Rust toolchain, so `cargo
 * check` cannot be the first line of defence — a stray brace would otherwise
 * surface only in CI, after a long review of code that cannot compile. This
 * test parses every `.rs` file with tree-sitter and fails on any ERROR or
 * MISSING node, which catches exactly the mistakes a compiler would report
 * first: unbalanced delimiters, broken attributes, truncated items.
 *
 * It is a syntax check, not a type check. `cargo test` in CI remains the
 * authority on whether the crate compiles.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const Parser = require('tree-sitter');
const Rust = require('tree-sitter-rust');

const RUST_ROOT = join(__dirname, '..', '..', 'rust');

function rustFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'target' || entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...rustFiles(path));
    } else if (entry.endsWith('.rs')) {
      found.push(path);
    }
  }
  return found.sort();
}

/** Every offending node, with the line it starts on. */
function problems(source: string): string[] {
  const parser = new Parser();
  parser.setLanguage(Rust);
  const tree = parser.parse(source);
  const found: string[] = [];

  const visit = (node: any) => {
    if (node.type === 'ERROR' || node.isMissing) {
      const line = node.startPosition.row + 1;
      const text = source.split('\n')[node.startPosition.row] ?? '';
      found.push(
        `line ${line}: ${node.isMissing ? 'missing' : 'unexpected'} ${node.type} in \`${text.trim()}\``,
      );
      return;
    }
    for (const child of node.children) visit(child);
  };

  visit(tree.rootNode);
  return found;
}

describe('the Rust tree parses cleanly', () => {
  const files = rustFiles(RUST_ROOT);

  test('there is a Rust tree to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test.each(files.map((path) => [relative(RUST_ROOT, path), path]))(
    '%s has no syntax errors',
    (_name, path) => {
      const source = readFileSync(path as string, 'utf8');
      expect(problems(source)).toEqual([]);
    },
  );

  test('the gate catches a genuinely broken file', () => {
    expect(problems('pub fn broken() { let x = 1;')).not.toEqual([]);
    expect(problems('pub fn ok() -> u8 { 1 }')).toEqual([]);
  });
});
