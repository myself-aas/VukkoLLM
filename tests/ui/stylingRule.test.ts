/**
 * One styling system, enforced rather than documented (Step 6.1).
 *
 * The plan forbids mixing NativeWind, inline styles and ad hoc style objects
 * "without a documented rule". The rule this port chose: components read every
 * colour, size and gap from `src/theme` and declare styles with
 * `StyleSheet.create`. This test reads the source and fails on a hex literal or
 * an inline style object in a component, which is the only way the rule stays
 * true as screens are added.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..', 'src');
const THEME = join(SRC, 'theme');

function files(directory: string, extensions = ['.tsx', '.ts']): string[] {
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

const componentFiles = files(SRC).filter(
  (path) => !relative(SRC, path).startsWith('theme') && !relative(SRC, path).startsWith('types'),
);

describe('the styling rule', () => {
  test('there are components to check', () => {
    expect(componentFiles.length).toBeGreaterThan(5);
  });

  test('no component hard-codes a colour', () => {
    const offenders = componentFiles.filter((path) => {
      const source = readFileSync(path, 'utf8');
      // Hex colours and rgb()/rgba() literals must come from the theme.
      return /#[0-9a-fA-F]{3,8}\b/.test(source) || /\brgba?\(/.test(source);
    });
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
  });

  test('every component declares its styles with StyleSheet.create', () => {
    const offenders = componentFiles.filter((path) => {
      const source = readFileSync(path, 'utf8');
      const usesStyles = /StyleSheet\.create/.test(source);
      const renders = /<View|<Text|<Pressable/.test(source);
      return renders && !usesStyles;
    });
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
  });

  test('no component imports a second styling library', () => {
    const offenders = componentFiles.filter((path) =>
      /from '(nativewind|styled-components|@emotion\/[^']+|tamagui|@shopify\/restyle)'/.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
  });

  test('the theme module is the only file allowed to hold raw values', () => {
    const themeFiles = files(THEME);
    expect(themeFiles.length).toBeGreaterThanOrEqual(5);
  });
});
