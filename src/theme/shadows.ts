/**
 * Elevation, ported from the Compose `Modifier.shadow` usages.
 *
 * React Native needs both the iOS shadow fields and Android's `elevation`, so
 * each step carries all of them; a component never composes its own.
 */
export interface ShadowStyle {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export const shadows = {
  /** Cards and the composer, barely separated from the background. */
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  /** Bottom sheets, model picker, settings. */
  sheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  /** The floating scroll-to-bottom button. */
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const satisfies Record<string, ShadowStyle>;

export type ShadowName = keyof typeof shadows;
