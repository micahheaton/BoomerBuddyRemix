import { describe, expect, it } from 'vitest';
import {
  productionMobileApiOrigin,
  resolveMobileApiOrigin,
} from '../../apps/mobile/src/api-origin';

describe('mobile production API origin', () => {
  it('accepts only the exact pinned production origin', () => {
    expect(
      resolveMobileApiOrigin({ configured: productionMobileApiOrigin, development: false }),
    ).toBe(productionMobileApiOrigin);
  });

  it.each([
    ['missing', undefined],
    ['local HTTP', 'http://127.0.0.1:4000'],
    ['alternate HTTPS host', 'https://api-preview.boomerbuddy.net'],
    ['path', 'https://api.boomerbuddy.net/v1'],
    ['query', 'https://api.boomerbuddy.net?candidate=true'],
    ['fragment', 'https://api.boomerbuddy.net#candidate'],
    ['credentials', 'https://user:password@api.boomerbuddy.net'],
  ])('rejects %s production configuration', (_name, configured) => {
    expect(() => resolveMobileApiOrigin({ configured, development: false })).toThrow();
  });

  it('retains the loopback default only for development builds', () => {
    expect(resolveMobileApiOrigin({ development: true })).toBe('http://127.0.0.1:4000');
  });
});
