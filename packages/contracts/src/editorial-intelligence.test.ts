import { describe, expect, it } from 'vitest';
import {
  assignedEditorialDraftResponseSchema,
  editorialBoardResponseSchema,
  editorialRuntimeCapabilitiesSchema,
} from './editorial-intelligence';

const capabilities = {
  externalFetch: false,
  externalModel: false,
  generation: false,
  providerProcessing: false,
  publication: false,
  outboundDelivery: false,
  transcription: false,
} as const;

describe('editorial intelligence contracts', () => {
  it('admits only the all-disabled runtime capability shape', () => {
    expect(editorialRuntimeCapabilitiesSchema.parse(capabilities)).toEqual(capabilities);
    expect(() =>
      editorialRuntimeCapabilitiesSchema.parse({ ...capabilities, publication: true }),
    ).toThrow();
  });

  it('keeps the board content-free and rejects locator, digest, and claim smuggling', () => {
    const board = {
      projection: 'owner_global_or_exact_assigned_editorial_metadata',
      contentIncluded: false,
      generatedAt: '2026-08-17T12:00:00.000Z',
      evidenceTier: 'local_simulation',
      capabilities,
      sources: [],
      stories: [],
      content: [],
      corrections: [],
      calendar: [],
      preferences: {
        grantedLocalFixtures: 0,
        withdrawnLocalFixtures: 0,
        externalDeliveryEnabled: false,
      },
    } as const;
    expect(editorialBoardResponseSchema.parse(board)).toEqual(board);
    for (const forbidden of [
      { sourceUrl: 'https://example.invalid/source' },
      { contentSha256: 'a'.repeat(64) },
      { supportedClaim: 'Unreviewed raw claim text' },
      { destination: 'test@example.invalid' },
    ]) {
      expect(() => editorialBoardResponseSchema.parse({ ...board, ...forbidden })).toThrow();
    }
  });

  it('allows draft text only through the exact assigned-draft contract', () => {
    expect(
      assignedEditorialDraftResponseSchema.parse({
        contentVersionId: 'editorial_content_fixture',
        assignedRole: 'skeptical',
        draftText: 'Pause and verify through a separately obtained official channel.',
        evidenceTier: 'local_simulation',
        providerProcessed: false,
        publicationEligible: false,
        externalActionExecuted: false,
      }),
    ).toMatchObject({ publicationEligible: false, externalActionExecuted: false });
  });
});
