import { describe, expect, it } from 'vitest';
import {
  canTransitionEditorialContent,
  countIndependentCorroboration,
  editorialReviewRoles,
  editorialRuntimeCapabilities,
  evaluateEditorialApproval,
} from './editorial-intelligence';

const now = new Date('2026-08-17T12:00:00.000Z');

describe('editorial intelligence domain boundary', () => {
  it('keeps every external capability structurally disabled', () => {
    expect(editorialRuntimeCapabilities).toEqual({
      externalFetch: false,
      externalModel: false,
      generation: false,
      providerProcessing: false,
      publication: false,
      outboundDelivery: false,
      transcription: false,
    });
  });

  it('permits only code-owned internal lifecycle transitions', () => {
    expect(canTransitionEditorialContent('draft', 'under_review')).toBe(true);
    expect(canTransitionEditorialContent('under_review', 'approved_internal')).toBe(true);
    expect(canTransitionEditorialContent('approved_internal', 'draft')).toBe(false);
    expect(canTransitionEditorialContent('retracted', 'approved_internal')).toBe(false);
  });

  it('requires current evidence, every review role, and skeptical/final independence', () => {
    const approvals = Object.fromEntries(
      editorialReviewRoles.map((role) => [role, `person-${role}`]),
    );
    expect(
      evaluateEditorialApproval({
        now,
        expiresAt: new Date('2026-08-19T12:00:00.000Z'),
        sourceReviewDueAt: new Date('2026-08-18T12:00:00.000Z'),
        sourceApproved: true,
        claimExpired: false,
        unresolvedContradiction: false,
        hasUnsupportedStatistics: false,
        hasUnverifiedUrgency: false,
        approvals,
      }),
    ).toEqual({
      internallyApprovable: true,
      publicationEligible: false,
      externalActionExecuted: false,
      reasons: [],
    });

    const unsafe = evaluateEditorialApproval({
      now,
      expiresAt: new Date('2026-08-17T12:00:00.000Z'),
      sourceReviewDueAt: new Date('2026-08-17T11:59:59.000Z'),
      sourceApproved: false,
      claimExpired: true,
      unresolvedContradiction: true,
      hasUnsupportedStatistics: true,
      hasUnverifiedUrgency: true,
      approvals: { skeptical: 'person-same', final_human: 'person-same' },
    });
    expect(unsafe.internallyApprovable).toBe(false);
    expect(unsafe.reasons).toEqual(
      expect.arrayContaining([
        'The exact source version is not approved.',
        'The exact source version is stale.',
        'A contradiction remains unresolved.',
        'Unsupported statistics remain.',
        'Unverified urgency remains.',
        'Skeptical and final review must be independent.',
      ]),
    );
  });

  it('does not inflate corroboration with duplicates, syndication, or the same source', () => {
    expect(
      countIndependentCorroboration([
        {
          relationship: 'corroborates',
          confirmed: true,
          leftSourceKey: 'source-a',
          rightSourceKey: 'source-b',
        },
        {
          relationship: 'corroborates',
          confirmed: true,
          leftSourceKey: 'source-b',
          rightSourceKey: 'source-a',
        },
        {
          relationship: 'corroborates',
          confirmed: true,
          leftSourceKey: 'source-a',
          rightSourceKey: 'source-a',
        },
        {
          relationship: 'syndication',
          confirmed: true,
          leftSourceKey: 'source-a',
          rightSourceKey: 'source-c',
        },
        {
          relationship: 'corroborates',
          confirmed: true,
          leftSourceKey: 'source-a',
          rightSourceKey: 'source-c',
        },
      ]),
    ).toBe(1);
  });
});
