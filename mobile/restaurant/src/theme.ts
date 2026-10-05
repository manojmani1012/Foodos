import { Platform, type TextStyle, type ViewStyle } from 'react-native'

// One place for colour, type and spacing, so every screen is built from the
// same parts rather than one-off numbers.

export const colors = {
  brand: '#1a5c35',
  brandPressed: '#14492a',
  brandSoft: '#e8f3eb',
  brandInk: '#12452a',

  ink: '#15191c',
  body: '#4a5157',
  muted: '#8a9299',
  faint: '#b6bcc1',

  line: '#e8ebe9',
  lineStrong: '#d4d9d6',

  surface: '#ffffff',
  ground: '#f4f6f5',
  raised: '#fafbfa',

  veg: '#1a7f37',
  nonVeg: '#c0392b',

  danger: '#b3261e',
  dangerSoft: '#fdeceb',
  warning: '#8a5a00',
  warningSoft: '#fdf3df',

  star: '#1a7f37',
  overlay: 'rgba(0,0,0,0.45)',
}

// A 4pt grid. Sticking to these keeps rhythm consistent across screens.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
}

// A proper type scale rather than arbitrary sizes per screen.
export const type = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: '800' } as TextStyle,
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' } as TextStyle,
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '700' } as TextStyle,
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' } as TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' } as TextStyle,
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' } as TextStyle,
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' } as TextStyle,
  caption: { fontSize: 11.5, lineHeight: 15, fontWeight: '500' } as TextStyle,
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  } as TextStyle,
}

// Elevation has to be written twice: iOS takes a shadow, Android takes a number.
function elevation(level: 1 | 2 | 3): ViewStyle {
  const ios = {
    1: { shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
    2: { shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    3: { shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -2 } },
  }[level]

  if (Platform.OS === 'android') {
    return { elevation: level === 1 ? 1 : level === 2 ? 3 : 10 }
  }

  if (Platform.OS === 'ios') {
    return { shadowColor: '#0b1f14', ...ios }
  }

  return {}
}

export const shadow = {
  card: elevation(1),
  raised: elevation(2),
  bar: elevation(3),
}

// Kept so older imports still resolve while screens migrate to the tokens above.
export const theme = {
  brand: colors.brand,
  brandDark: colors.brandInk,
  brandSoft: colors.brandSoft,
  ink: colors.ink,
  body: colors.body,
  muted: colors.muted,
  line: colors.line,
  surface: colors.surface,
  ground: colors.ground,
  danger: colors.danger,
  dangerSoft: colors.dangerSoft,
  radius: radius.md,
}
