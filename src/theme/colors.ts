/**
 * Palette ported from app/src/main/java/com/vukko/theme/Color.kt.
 * Values must match the Compose theme exactly; a changed hex here is a visual
 * regression, not a taste preference.
 */
export const colors = {
  background: '#0B0F14',
  surface: '#121821',
  surfaceElevated: '#1A2330',
  accent: '#00E5FF',
  accentMuted: '#0B6E7A',
  textPrimary: '#F5F7FA',
  textSecondary: '#9AA7B8',
  textDisabled: '#5C6875',
  success: '#3DDC97',
  warning: '#FFC857',
  error: '#FF5C7A',
  border: '#22303F',
  overlay: 'rgba(3, 6, 10, 0.7)',
} as const;

export type ColorName = keyof typeof colors;
