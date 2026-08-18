import { describe, expect, it } from 'vitest';

import {
  founderProvisioningOperationKeySchema,
  founderProvisioningTransitionRequestSchema,
} from './founder-provisioning';

const validRequest = {
  toStatus: 'ready_for_test',
  evidence: {
    tier: 'repository_review',
    kind: 'configuration_ready',
    result: 'passed',
    manifestDigest: 'A'.repeat(43),
    observedAt: '2026-08-16T20:00:00.000Z',
  },
} as const;

describe('founder provisioning mutation contract', () => {
  it('accepts only bounded enum, timestamp, and digest evidence', () => {
    expect(founderProvisioningTransitionRequestSchema.parse(validRequest)).toEqual(validRequest);
    expect(
      founderProvisioningOperationKeySchema.parse(
        'provisioning:stripe:00000000-0000-4000-8000-000000000001',
      ),
    ).toBe('provisioning:stripe:00000000-0000-4000-8000-000000000001');
  });

  it.each([
    ['free text', { ...validRequest, evidenceNote: 'founder says it works' }],
    ['provider URL', { ...validRequest, providerUrl: 'https://provider.invalid/evidence' }],
    ['identifier value', { ...validRequest, accountId: 'acct_real_value' }],
    ['secret value', { ...validRequest, secretValue: 'sk_test_do_not_store' }],
    [
      'nested free text',
      { ...validRequest, evidence: { ...validRequest.evidence, note: 'unbounded evidence' } },
    ],
  ])('rejects %s fields', (_label, input) => {
    expect(() => founderProvisioningTransitionRequestSchema.parse(input)).toThrow();
  });

  it('rejects malformed digests and unbounded operation keys', () => {
    expect(() =>
      founderProvisioningTransitionRequestSchema.parse({
        ...validRequest,
        evidence: { ...validRequest.evidence, manifestDigest: 'not-a-digest' },
      }),
    ).toThrow();
    expect(() => founderProvisioningOperationKeySchema.parse('short')).toThrow();
    expect(() => founderProvisioningOperationKeySchema.parse('bad key with spaces')).toThrow();
    expect(() =>
      founderProvisioningOperationKeySchema.parse('sk_test_do_not_store_as_an_operation_key'),
    ).toThrow();
  });
});
