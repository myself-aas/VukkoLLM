/**
 * The one styling entry point (MIGRATION_PLAN.md §9 Step 6.1).
 *
 * Rule, enforced by tests/ui/theme.test.ts: components import from here and use
 * `StyleSheet.create`. No inline colour literals, no second styling library.
 */
import { colors } from './colors';
import { fontFamily, typography } from './typography';
import { radii, spacing } from './spacing';
import { shadows } from './shadows';

export { colors } from './colors';
export type { ColorName } from './colors';
export { fontFamily, typography } from './typography';
export type { TypeRole, TypeStyle } from './typography';
export { radii, spacing } from './spacing';
export type { RadiusName, SpacingName } from './spacing';
export { shadows } from './shadows';
export type { ShadowName, ShadowStyle } from './shadows';

export const theme = {
  colors,
  typography,
  fontFamily,
  spacing,
  radii,
  shadows,
} as const;

export type Theme = typeof theme;
