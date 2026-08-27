import { describe, expect, it } from 'vitest';
import {
  MobileCustomerError,
  requiresRecentAuthentication,
} from '../../apps/mobile/src/customer-error';

describe('mobile recent-authentication guidance', () => {
  it('recognizes only the explicit server action and reason', () => {
    expect(
      requiresRecentAuthentication(
        new MobileCustomerError(
          'Sign in again before changing household access',
          403,
          'not_authorized',
          {
            action: 'sign_in_again',
            reason: 'recent_authentication_required',
          },
        ),
      ),
    ).toBe(true);
    expect(
      requiresRecentAuthentication(
        new MobileCustomerError('Not authorized', 403, 'not_authorized', {
          action: 'contact_support',
          reason: 'permission_denied',
        }),
      ),
    ).toBe(false);
  });
});
