import { describe, expect, it } from 'vitest';
import {
  buildDeterministicGovernedDraft,
  governedPublicationEligibility,
  normalizeGovernedContentDocument,
  type GovernedPublicFact,
} from './governed-content';

const fact: GovernedPublicFact = {
  sourceId: 'us-imposter-scam-trends:v1',
  sourceDigest: 'a'.repeat(64),
  region: 'US',
  title: 'Pause before acting on an unexpected request',
  summary: 'Unexpected urgency is a reason to slow down and verify through a trusted channel.',
  safeActions: ['Do not share a code.', 'Call using a number you already trust.'],
  sourceTitle: 'Federal Trade Commission',
  sourceUrl: 'https://www.ftc.gov/example',
  sourcePublishedAt: new Date('2026-05-01T12:00:00.000Z'),
  reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
  expiresAt: new Date('2026-11-01T12:00:00.000Z'),
};

describe('governed first-party content domain', () => {
  it('builds stable internal article and export drafts without embedding a source locator', () => {
    const first = buildDeterministicGovernedDraft(fact);
    const second = buildDeterministicGovernedDraft(fact);
    expect(first).toEqual(second);
    expect(first.slug).toBe('us-pause-before-acting-on-an-unexpected-request');
    expect(JSON.stringify(first)).not.toContain('https://');
    expect(first.platformDrafts.youtubeScript).toContain('Federal Trade Commission');
  });

  it('requires every exact-revision review and separates skeptical from final review', () => {
    expect(
      governedPublicationEligibility({
        exactDigest: true,
        unexpired: true,
        decisions: {
          skeptical: 'approve',
          accessibility: 'approve',
          privacy_rights: 'approve',
          final_human: 'approve',
        },
        skepticalActorId: 'person-reviewer',
        finalActorId: 'person-owner',
      }),
    ).toEqual({ eligible: true, blockers: [] });
    expect(
      governedPublicationEligibility({
        exactDigest: true,
        unexpired: true,
        decisions: {
          skeptical: 'approve',
          accessibility: 'approve',
          privacy_rights: 'approve',
          final_human: 'approve',
        },
        skepticalActorId: 'person-owner',
        finalActorId: 'person-owner',
      }).blockers,
    ).toContain('skeptical_and_final_reviewer_must_differ');
  });

  it('normalizes bounded copy and rejects unsafe slugs', () => {
    expect(
      normalizeGovernedContentDocument({
        slug: 'pause-and-verify',
        title: '  Pause   and verify ',
        summary: 'A short summary.',
        body: 'One\r\n\r\nTwo',
        platformDrafts: {
          youtubeScript: 'A script.',
          tiktokCaption: 'A caption.',
          linkedinPost: 'A post.',
        },
      }).title,
    ).toBe('Pause and verify');
    expect(() =>
      normalizeGovernedContentDocument({
        slug: '../unsafe',
        title: 'Title',
        summary: 'Summary',
        body: 'Body',
        platformDrafts: {
          youtubeScript: 'Script',
          tiktokCaption: 'Caption',
          linkedinPost: 'Post',
        },
      }),
    ).toThrow('lowercase words and hyphens');
  });
});
