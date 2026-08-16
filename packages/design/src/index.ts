export const minimumTargetPx = 48;
export const contentMaxWidthPx = 720;

export const designTokens = {
  colors: {
    canvas: '#F7F5EF',
    surface: '#FFFFFF',
    surfaceMuted: '#ECE9E0',
    text: '#17202A',
    textMuted: '#45515E',
    primary: '#174D6B',
    primaryHover: '#10394F',
    onPrimary: '#FFFFFF',
    focus: '#8A3FFC',
    border: '#697683',
    lowerConcern: '#236B45',
    caution: '#8A5600',
    highConcern: '#9C2B23',
    unknown: '#4B5563',
    dangerSurface: '#FFF0EE',
    warningSurface: '#FFF6DF',
    successSurface: '#EAF6EF',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bodyPx: 18,
    bodyLineHeight: 1.55,
    smallPx: 16,
    headingPx: 32,
    headingLineHeight: 1.2,
    weightRegular: 400,
    weightStrong: 700,
  },
  targets: { minimumPx: minimumTargetPx, comfortablePx: 56 },
  radii: { small: 6, medium: 12, pill: 999 },
  shadows: { raised: '0 2px 8px rgba(23, 32, 42, 0.14)' },
  zIndex: { base: 0, header: 10, dialog: 100, toast: 200 },
  layout: { contentMaxWidthPx },
} as const;

export const focusRing = `3px solid ${designTokens.colors.focus}`;

export const cssVariables: Readonly<Record<string, string>> = {
  '--bb-color-canvas': designTokens.colors.canvas,
  '--bb-color-surface': designTokens.colors.surface,
  '--bb-color-surface-muted': designTokens.colors.surfaceMuted,
  '--bb-color-text': designTokens.colors.text,
  '--bb-color-text-muted': designTokens.colors.textMuted,
  '--bb-color-primary': designTokens.colors.primary,
  '--bb-color-primary-hover': designTokens.colors.primaryHover,
  '--bb-color-on-primary': designTokens.colors.onPrimary,
  '--bb-color-focus': designTokens.colors.focus,
  '--bb-color-border': designTokens.colors.border,
  '--bb-color-lower-concern': designTokens.colors.lowerConcern,
  '--bb-color-caution': designTokens.colors.caution,
  '--bb-color-high-concern': designTokens.colors.highConcern,
  '--bb-color-unknown': designTokens.colors.unknown,
  '--bb-space-xs': `${designTokens.spacing.xs}px`,
  '--bb-space-sm': `${designTokens.spacing.sm}px`,
  '--bb-space-md': `${designTokens.spacing.md}px`,
  '--bb-space-lg': `${designTokens.spacing.lg}px`,
  '--bb-space-xl': `${designTokens.spacing.xl}px`,
  '--bb-target-minimum': `${minimumTargetPx}px`,
  '--bb-content-max-width': `${contentMaxWidthPx}px`,
  '--bb-font-family': designTokens.typography.family,
  '--bb-body-size': `${designTokens.typography.bodyPx}px`,
  '--bb-focus-ring': focusRing,
};

export function cssVariableText(selector = ':root'): string {
  const declarations = Object.entries(cssVariables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${declarations}\n}`;
}

export function assertAccessibleTarget(target: {
  readonly width: number;
  readonly height: number;
}): void {
  if (
    !Number.isFinite(target.width) ||
    !Number.isFinite(target.height) ||
    target.width < minimumTargetPx ||
    target.height < minimumTargetPx
  ) {
    throw new RangeError(
      `Interactive targets must be at least ${minimumTargetPx}px in both dimensions`,
    );
  }
}
