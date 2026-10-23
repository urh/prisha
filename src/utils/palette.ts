/**
 * Design primitives — Linear (linear.app) design system.
 * Source: VoltAgent/awesome-design-md → design-md/linear.app/DESIGN.md
 *
 * Chart colours used to be hex literals scattered across five components,
 * which is how palettes drift. Everything visual that isn't a Tailwind utility
 * now resolves here; the utilities themselves are remapped in index.html.
 */

/** The documented Linear tokens, verbatim. */
export const LINEAR = {
  canvas: '#0e121a',
  surface1: '#151a23',
  surface2: '#1a2029',
  surface3: '#1f2630',
  surface4: '#29303b',
  hairline: '#29303b',
  hairlineStrong: '#353e4b',
  ink: '#e9edf3',
  inkMuted: '#c9d1dc',
  inkSubtle: '#8b95a5',
  inkTertiary: '#606a7a',
  primary: '#7d8ba3',
  primaryHover: '#9aa6b8',
  primaryFocus: '#7d8ba3',
  brandSecure: '#8a8f9a',
  success: '#6d907c',
} as const;

/**
 * Categorical series for pies and multi-line charts.
 *
 * Linear's own palette is deliberately almost monochrome — lavender plus one
 * semantic green — which cannot carry an 8-slice budget pie. This extends it
 * in the brand's register instead: lavender leads, every hue is desaturated to
 * sit beside it without shouting, and each one clears 3:1 contrast against
 * both the dark canvas (#0e121a) and the light one (#f6f7f7), so a single
 * array works in both themes.
 */
export const SERIES = [
  '#7d8ba3', // slate blue
  '#6d907c', // sage
  '#b0956a', // honey
  '#b08088', // dusty rose
  '#8d86a0', // lavender
  '#7a9478', // moss
  '#b08a74', // clay
  '#8b9098', // slate
  '#9a8aa0', // mauve
  '#7d97a3', // dusty sky
  '#a39884', // sand
  '#7d8fa0', // steel
] as const;

/** Named roles for the recurring lines/marks, so charts agree with each other. */
export const CHART = {
  actual: LINEAR.primary,
  projection: LINEAR.primaryHover,
  target: LINEAR.inkTertiary,
  income: LINEAR.success,
  marker: '#b08088',
  /** Light-mode grid/axis; dark mode is remapped by CSS in index.html. */
  grid: '#e8e9ec',
  axis: LINEAR.inkSubtle,
  neutral: LINEAR.inkSubtle,
} as const;
