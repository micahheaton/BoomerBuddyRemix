import type { AuthContext } from '../../apps/api/src/auth';
import type { ApiContext } from '../../apps/api/src/context';
import { assertRecentHqMfa } from '../../apps/api/src/routes/commerce';
import { describe, expect, it } from 'vitest';
import { testConfig } from '../integration/support';

function auth(input: {
  readonly audience: 'customer' | 'hq';
  readonly assurance:
    | { readonly kind: 'development' }
    | {
        readonly kind: 'clerk';
        readonly firstFactorAgeSeconds?: number;
        readonly secondFactorAgeSeconds?: number;
      };
}): AuthContext {
  return input as unknown as AuthContext;
}

function context(environment: 'test' | 'production'): ApiContext {
  return {
    config: { ...testConfig(), environment },
  } as unknown as ApiContext;
}

describe('HQ Stripe control MFA', () => {
  it('accepts only an HQ Clerk session with both factors inside the recent window', () => {
    expect(() =>
      assertRecentHqMfa(
        auth({
          audience: 'hq',
          assurance: {
            kind: 'clerk',
            firstFactorAgeSeconds: 599,
            secondFactorAgeSeconds: 599,
          },
        }),
        context('production'),
      ),
    ).not.toThrow();
    for (const rejected of [
      auth({
        audience: 'customer',
        assurance: { kind: 'clerk', firstFactorAgeSeconds: 1, secondFactorAgeSeconds: 1 },
      }),
      auth({ audience: 'hq', assurance: { kind: 'development' } }),
      auth({
        audience: 'hq',
        assurance: { kind: 'clerk', firstFactorAgeSeconds: 1 },
      }),
      auth({
        audience: 'hq',
        assurance: {
          kind: 'clerk',
          firstFactorAgeSeconds: 1,
          secondFactorAgeSeconds: 600,
        },
      }),
    ]) {
      expect(() => assertRecentHqMfa(rejected, context('production'))).toThrow(
        expect.objectContaining({ code: 'not_authorized' }),
      );
    }
  });

  it('permits the explicit development assurance only outside production', () => {
    expect(() =>
      assertRecentHqMfa(
        auth({ audience: 'hq', assurance: { kind: 'development' } }),
        context('test'),
      ),
    ).not.toThrow();
  });
});
