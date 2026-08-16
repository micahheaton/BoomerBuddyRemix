import { describe, expect, it } from 'vitest';
import {
  assertAccessibleTarget,
  cssVariableText,
  cssVariables,
  designTokens,
  minimumTargetPx,
} from './index';

describe('cross-platform design tokens', () => {
  it('exposes numeric native tokens and valid web custom properties', () => {
    expect(designTokens.targets.minimumPx).toBe(48);
    expect(typeof designTokens.spacing.md).toBe('number');
    expect(cssVariables['--bb-color-text']).toBe('#17202A');
    expect(cssVariableText()).toContain(':root {');
  });

  it('enforces the senior-friendly minimum target', () => {
    expect(() =>
      assertAccessibleTarget({ width: minimumTargetPx, height: minimumTargetPx }),
    ).not.toThrow();
    expect(() => assertAccessibleTarget({ width: 47, height: 60 })).toThrow(RangeError);
    expect(() => assertAccessibleTarget({ width: Number.NaN, height: 60 })).toThrow(RangeError);
  });
});
