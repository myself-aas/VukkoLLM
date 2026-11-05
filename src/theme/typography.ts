/**
 * Type ramp, ported from app/src/main/java/com/vukko/theme/Type.kt.
 *
 * Sizes and line heights are the Compose values; weights are the React Native
 * strings for the same Kotlin `FontWeight`. Generous line height is deliberate:
 * assistant answers are dense Markdown and cramped leading makes them unreadable.
 */
export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  /** Tracking, in points; Compose `letterSpacing` is in sp. */
  letterSpacing: number;
}

export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.5 },
  headline: { fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: -0.2 },
  title: { fontSize: 18, lineHeight: 26, fontWeight: '600', letterSpacing: 0 },
  bodyLarge: { fontSize: 16, lineHeight: 26, fontWeight: '400', letterSpacing: 0 },
  bodyMedium: { fontSize: 15, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  bodySmall: { fontSize: 13, lineHeight: 20, fontWeight: '400', letterSpacing: 0.1 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.4 },
} as const satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof typography;

/**
 * Bundled fonts. The Compose app ships one family for body text and a monospace
 * face for code blocks; both are referenced by the platform name so a missing
 * font falls back instead of rendering nothing.
 */
export const fontFamily = {
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodyBold: 'Inter-SemiBold',
  mono: 'JetBrainsMono-Regular',
} as const;
