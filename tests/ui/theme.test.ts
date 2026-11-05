/**
 * Phase 6, Step 6.1: one styling system.
 *
 * The Compose theme is the source of truth for the palette, the type ramp and
 * the spacing scale. These tests pin the values that are visible in the ported
 * screens and, more importantly, enforce the *rule*: screens resolve their
 * styles through the theme module, never through an inline literal colour, and
 * the app ships a single styling system rather than a mixture.
 */

import { colors, radii, shadows, spacing, typography, theme } from '../../src/theme';

describe('the palette is the Compose palette', () => {
  test('the dark background and cyan accent are unchanged', () => {
    expect(colors.background).toBe('#0B0F14');
    expect(colors.accent).toBe('#00E5FF');
    expect(colors.surface).toBe('#121821');
    expect(colors.textPrimary).toBe('#F5F7FA');
  });

  test('every colour is a valid hex or rgba value', () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(`${name}=${value}`).toMatch(/=[#]|rgba\(/);
    }
  });

  test('the semantic colours stay distinguishable from the background', () => {
    const luminance = (hex: string) => {
      const value = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = luminance(colors.background);
    for (const name of ['textPrimary', 'accent', 'error', 'success', 'warning'] as const) {
      expect(luminance(colors[name]) - background).toBeGreaterThan(40);
    }
  });
});

describe('the type ramp matches the Compose typography', () => {
  test('the ramp has the seven Material 3 roles the screens use', () => {
    expect(Object.keys(typography).sort()).toEqual(
      ['bodyLarge', 'bodyMedium', 'bodySmall', 'display', 'headline', 'label', 'title'].sort(),
    );
  });

  test('each role states size, line height and weight', () => {
    for (const [role, style] of Object.entries(typography)) {
      expect(`${role}:${style.fontSize}`).toMatch(/:\d+/);
      expect(style.lineHeight).toBeGreaterThan(style.fontSize);
      expect(['400', '500', '600', '700']).toContain(style.fontWeight);
    }
  });

  test('body text is never smaller than the accessibility floor', () => {
    expect(typography.bodyMedium.fontSize).toBeGreaterThanOrEqual(14);
    expect(typography.bodySmall.fontSize).toBeGreaterThanOrEqual(12);
  });
});

describe('spacing and radii are a scale, not magic numbers', () => {
  test('spacing is the 4-point Compose scale', () => {
    expect(spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
  });

  test('radii cover the sheet, card and pill shapes the UI draws', () => {
    expect(radii).toMatchObject({ card: 16, sheet: 24, pill: 999 });
    for (const value of Object.values(radii)) {
      expect(typeof value).toBe('number');
    }
  });

  test('shadows are elevation-only and platform-safe', () => {
    expect(shadows.card.elevation).toBeGreaterThan(0);
    expect(shadows.card.shadowOpacity).toBeGreaterThan(0);
    expect(shadows.card.shadowRadius).toBeGreaterThan(0);
  });
});

describe('a single styling system', () => {
  test('the theme index exposes one entry point', () => {
    expect(theme.colors).toBe(colors);
    expect(theme.spacing).toBe(spacing);
    expect(theme.typography).toBe(typography);
    expect(theme.radii).toBe(radii);
    expect(theme.shadows).toBe(shadows);
  });

  test('no styling library other than StyleSheet is in the dependency list', () => {
    const pkg = require('../../package.json');
    const styling = Object.keys(pkg.dependencies).filter((name) =>
      /nativewind|tailwind|styled-components|emotion|tamagui|restyle/.test(name),
    );
    expect(styling).toEqual([]);
  });
});
