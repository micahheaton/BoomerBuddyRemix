import { describe, expect, it } from 'vitest';
import {
  assertFeedbackSourceCompatible,
  assertFeedbackTransition,
  canonicalFeedbackNetworkAddress,
  feedbackAdapterRegistry,
  feedbackEvidenceTierForEnvironment,
  isFeedbackContentReadableStatus,
  initialFeedbackQueue,
} from './feedback';

describe('feedback domain boundary', () => {
  it('derives the evidence tier from the runtime without a caller-selectable override', () => {
    expect(feedbackEvidenceTierForEnvironment('development')).toBe('local_simulation');
    expect(feedbackEvidenceTierForEnvironment('test')).toBe('local_simulation');
    expect(feedbackEvidenceTierForEnvironment('production')).toBe('live_production');
  });

  it('enables only authenticated text in production', () => {
    expect(feedbackAdapterRegistry.find((adapter) => adapter.key === 'authenticated_text')).toEqual(
      expect.objectContaining({ state: 'production_enabled', externalEffect: false }),
    );
    for (const key of ['anonymous_text', 'support_conversion'] as const) {
      expect(feedbackAdapterRegistry.find((adapter) => adapter.key === key)).toEqual(
        expect.objectContaining({ state: 'local_only_enabled', externalEffect: false }),
      );
    }
  });

  it('keeps every media and provider adapter structurally disabled', () => {
    expect(
      feedbackAdapterRegistry
        .filter((adapter) => adapter.key !== 'authenticated_text')
        .filter((adapter) => adapter.key !== 'anonymous_text')
        .filter((adapter) => adapter.key !== 'support_conversion'),
    ).toSatisfy((adapters: typeof feedbackAdapterRegistry) =>
      adapters.every(
        (adapter) => adapter.state === 'structurally_disabled' && !adapter.externalEffect,
      ),
    );
  });

  it('does not let anonymous intake become covert contextual attribution', () => {
    expect(() =>
      assertFeedbackSourceCompatible({
        identityMode: 'anonymous',
        sourceSurface: 'post_check',
        linkedObjectType: 'check',
      }),
    ).toThrow(/Anonymous feedback/u);
    expect(() =>
      assertFeedbackSourceCompatible({
        identityMode: 'anonymous',
        sourceSurface: 'web_feedback_form',
        linkedObjectType: 'check',
      }),
    ).toThrow(/Anonymous feedback/u);
    expect(() =>
      assertFeedbackSourceCompatible({
        identityMode: 'anonymous',
        sourceSurface: 'web_feedback_form',
      }),
    ).not.toThrow();
  });

  it('requires exact contextual object classes and matching support conversion provenance', () => {
    expect(() =>
      assertFeedbackSourceCompatible({
        identityMode: 'authenticated',
        sourceSurface: 'post_check',
        linkedObjectType: 'subscription',
      }),
    ).toThrow(/exact check link/u);
    expect(() =>
      assertFeedbackSourceCompatible({
        identityMode: 'authenticated',
        sourceSurface: 'support_conversion',
      }),
    ).toThrow(/must match/u);
  });

  it('uses bounded append-only state transitions', () => {
    expect(() => assertFeedbackTransition('received', 'minimized')).not.toThrow();
    expect(() => assertFeedbackTransition('minimized', 'classified')).not.toThrow();
    expect(() => assertFeedbackTransition('closed', 'assigned')).toThrow(/not permitted/u);
    expect(() => assertFeedbackTransition('assigned', 'assigned')).toThrow(/no-ops/u);
  });

  it('owns the exact readable-state allowlist', () => {
    expect(isFeedbackContentReadableStatus('minimized')).toBe(true);
    expect(isFeedbackContentReadableStatus('classified')).toBe(true);
    expect(isFeedbackContentReadableStatus('assigned')).toBe(true);
    for (const denied of [
      'restricted',
      'withdrawn',
      'retention_expired',
      'unsafe_unprocessable',
    ] as const) {
      expect(isFeedbackContentReadableStatus(denied)).toBe(false);
    }
  });

  it('canonicalizes equivalent IPv4 and IPv6 addresses and rejects ambiguous network input', () => {
    expect(canonicalFeedbackNetworkAddress('192.0.2.7')).toBe('192.0.2.7');
    expect(canonicalFeedbackNetworkAddress(' 2001:0DB8:0:0:0:0:0:1 ')).toBe('2001:db8::1');
    expect(canonicalFeedbackNetworkAddress('2001:db8::1')).toBe('2001:db8::1');
    expect(canonicalFeedbackNetworkAddress('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(canonicalFeedbackNetworkAddress('0:0:0:0:0:ffff:c000:0201')).toBe('192.0.2.1');
    expect(canonicalFeedbackNetworkAddress('::FFFF:C000:201')).toBe('192.0.2.1');
    for (const invalid of [
      '192.0.2.001',
      '2001::db8::1',
      'fe80::1%eth0',
      'not-an-address',
      '２００１:db8::1',
    ]) {
      expect(() => canonicalFeedbackNetworkAddress(invalid)).toThrow(/IPv4|IPv6|canonical/u);
    }
  });

  it('routes safety, accessibility, and unsafe content without popularity ranking', () => {
    expect(initialFeedbackQueue({ feedbackType: 'safety_concern', unsafe: false })).toBe(
      'safety_fraud',
    );
    expect(initialFeedbackQueue({ feedbackType: 'accessibility_issue', unsafe: false })).toBe(
      'accessibility',
    );
    expect(initialFeedbackQueue({ feedbackType: 'product_feedback', unsafe: true })).toBe(
      'privacy_security',
    );
  });
});
