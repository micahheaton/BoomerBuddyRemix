import { DomainError } from '@boomerbuddy/domain';
import {
  assertRecentCustomerAuthentication,
  customerSensitiveChangeMaximumAgeSeconds,
  type AuthContext,
} from '../../apps/api/src/auth';
import { describe, expect, it } from 'vitest';

function auth(
  assurance: AuthContext['assurance'],
  audience: AuthContext['audience'] = 'customer',
): AuthContext {
  return { audience, assurance } as AuthContext;
}

describe('recent customer authentication boundary', () => {
  it('allows development authentication and a Clerk first factor younger than ten minutes', () => {
    expect(() => assertRecentCustomerAuthentication(auth({ kind: 'development' }))).not.toThrow();
    expect(() =>
      assertRecentCustomerAuthentication(
        auth({
          kind: 'clerk',
          firstFactorAgeSeconds: customerSensitiveChangeMaximumAgeSeconds - 1,
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['at the boundary', customerSensitiveChangeMaximumAgeSeconds],
    ['negative', -1],
    ['non-integer', 1.5],
  ] as const)('denies %s Clerk first-factor age with a sign-in-again hint', (_label, age) => {
    let caught: unknown;
    try {
      assertRecentCustomerAuthentication(
        auth({
          kind: 'clerk',
          ...(age === undefined ? {} : { firstFactorAgeSeconds: age }),
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(caught).toMatchObject({
      code: 'not_authorized',
      message: 'Sign in again before changing household access',
      safeDetails: {
        action: 'sign_in_again',
        reason: 'recent_authentication_required',
      },
    });
  });

  it('allows the same freshness boundary for mobile and rejects non-customer audiences', () => {
    expect(() =>
      assertRecentCustomerAuthentication(
        auth({ kind: 'clerk', firstFactorAgeSeconds: 599 }, 'mobile'),
      ),
    ).not.toThrow();
    expect(() =>
      assertRecentCustomerAuthentication(auth({ kind: 'development' }, 'hq')),
    ).toThrowError('A customer identity confirmation is required');
  });
});
