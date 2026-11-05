/**
 * Spacing scale, ported from the Compose theme.
 *
 * A scale rather than free numbers: every gap in the ported screens is one of
 * these steps, which is what keeps the layout from drifting screen to screen.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export type SpacingName = keyof typeof spacing;

/** Corner radii for the shapes the UI actually draws. */
export const radii = {
  /** Inline code, chips, small buttons. */
  sm: 8,
  /** Cards, message bubbles, list rows. */
  card: 16,
  /** Bottom sheets and dialogs. */
  sheet: 24,
  /** Fully rounded: avatars, the send button, pills. */
  pill: 999,
} as const;

export type RadiusName = keyof typeof radii;
