/**
 * Central theme for the Jewelry Billing app.
 * Everything in the UI pulls color/spacing/typography from here —
 * no hardcoded hex values in screens or components.
 */

export const colors = {
  // Primary — deep royal blue (headers, primary buttons, active nav)
  primary: '#123B7A',
  primaryDark: '#0C2B5A',
  primaryLight: '#2E5DA6',
  primarySurface: '#EAF0FB', // pale blue tint for selected/highlighted rows

  // Accent — gold (used sparingly: key numbers, active states, icons)
  gold: '#C9A227',
  goldDark: '#A8841C',
  goldLight: '#E4C660',
  goldSurface: '#FBF4DE', // pale gold tint for badges/highlights

  // Neutrals — white-forward, not dark mode
  white: '#FFFFFF',
  background: '#F5F7FB', // app background, very light blue-white
  surface: '#FFFFFF', // cards, inputs
  border: '#E1E6F0',
  borderStrong: '#C7D0E3',

  // Text
  textPrimary: '#0F1F3D', // dark navy, not pure black
  textSecondary: '#4C5B78',
  textMuted: '#8896AD',
  textOnPrimary: '#FFFFFF',
  textOnGold: '#0F1F3D',

  // Status
  success: '#1E7A4C',
  successSurface: '#E7F5EC',
  warning: '#B8860B',
  warningSurface: '#FBF3DE',
  error: '#C0392B',
  errorSurface: '#FCEAE8',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
  displaySerif: 'PlayfairDisplay_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F1F3D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;
