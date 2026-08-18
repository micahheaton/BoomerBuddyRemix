import { describe, expect, it } from 'vitest';
import {
  buildUserInitiatedInvitationShareDraft,
  localInboundMessagingFixtureSchema,
  localMessagingConsentRequestSchema,
  localMessagingDestinationRequestSchema,
  localMessagingDestinationResponseSchema,
  localMessagingStatusSchema,
  selfMessagingConsentRequestSchema,
} from './messaging';

describe('provider-free messaging contracts', () => {
  it('accepts only explicitly local destination and consent commands', () => {
    expect(
      localMessagingDestinationRequestSchema.parse({
        localFixtureDestination: '+12025550123',
        timeZone: 'America/Los_Angeles',
        locale: 'en-US',
        jurisdiction: 'US',
      }),
    ).toBeTruthy();
    expect(
      selfMessagingConsentRequestSchema.parse({
        purpose: 'account_service',
        disclosureVersion: 'sms-purpose-local-v1',
        policyVersion: 'messaging-local-consent-v1',
      }),
    ).toBeTruthy();
    expect(() =>
      selfMessagingConsentRequestSchema.parse({
        purpose: 'account_service',
        disclosureVersion: 'sms-purpose-local-v1',
        policyVersion: 'messaging-local-consent-v1',
        actorPersonId: 'person-other',
        sourceSurface: 'local_fixture',
      }),
    ).toThrow();
    expect(
      localMessagingConsentRequestSchema.parse({
        destinationId: 'destination_fixture_1',
        purpose: 'account_service',
        disclosureVersion: 'sms-purpose-local-v1',
        policyVersion: 'messaging-local-consent-v1',
        sourceSurface: 'member_web',
      }),
    ).toBeTruthy();
    expect(() =>
      localMessagingDestinationRequestSchema.parse({
        localFixtureDestination: '+12025550123',
        timeZone: 'America/Los_Angeles',
        locale: 'en-US',
        jurisdiction: 'US',
        provider: 'twilio',
      }),
    ).toThrow();
    expect(() =>
      localMessagingDestinationRequestSchema.parse({
        localFixtureDestination: '+12025550999',
        timeZone: 'America/Los_Angeles',
        locale: 'en-US',
        jurisdiction: 'US',
      }),
    ).toThrow();
  });

  it('keeps composed responses local-only and destination-free', () => {
    const response = localMessagingDestinationResponseSchema.parse({
      destination: {
        id: 'destination_fixture_1',
        locale: 'en-US',
        jurisdiction: 'US',
        timeZoneKnown: true,
        evidenceTier: 'local_simulation',
        createdAt: '2026-08-17T12:00:00.000Z',
      },
      status: {
        destinationId: 'destination_fixture_1',
        channel: 'sms',
        evidenceTier: 'local_simulation',
        timeZoneKnown: true,
        consents: [],
      },
      providerNetworkPermitted: false,
    });
    expect(JSON.stringify(response)).not.toContain('+120255501');
    expect(() =>
      localMessagingDestinationResponseSchema.parse({
        ...response,
        providerNetworkPermitted: true,
      }),
    ).toThrow();
  });

  it('keeps control fixtures content-free and support content bounded', () => {
    expect(
      localInboundMessagingFixtureSchema.parse({
        eventKey: 'local-stop-event-001',
        destinationId: 'destination_fixture_1',
        classification: 'stop',
        evidenceTier: 'local_simulation',
      }),
    ).toBeTruthy();
    expect(() =>
      localInboundMessagingFixtureSchema.parse({
        eventKey: 'local-stop-event-002',
        destinationId: 'destination_fixture_1',
        classification: 'stop',
        messageText: 'hidden content',
        evidenceTier: 'local_simulation',
      }),
    ).toThrow();
    expect(() =>
      localInboundMessagingFixtureSchema.parse({
        eventKey: 'local-support-event-001',
        destinationId: 'destination_fixture_1',
        classification: 'support',
        supportCaseId: 'case_fixture_1',
        evidenceTier: 'provider_test',
      }),
    ).toThrow();
    expect(
      localMessagingStatusSchema.parse({
        destinationId: 'destination_fixture_1',
        channel: 'sms',
        evidenceTier: 'local_simulation',
        timeZoneKnown: true,
        consents: [{ purpose: 'account_service', state: 'active', suppressed: false }],
      }),
    ).toMatchObject({ channel: 'sms', evidenceTier: 'local_simulation' });
  });

  it('builds a user-initiated draft without household, person, permission, destination, or URL data', () => {
    const draft = buildUserInitiatedInvitationShareDraft({
      invitationId: 'invitation_fixture_1',
      localInviteCode: 'abcdefghijklmnopqrstuvwxyz123456',
      expiresAt: '2026-08-18T12:00:00.000Z',
      surface: 'sms_composer',
    });
    expect(draft).toMatchObject({
      surface: 'sms_composer',
      deliveryAuthority: 'user_device_only',
      requiresUserGesture: true,
      automaticSendPermitted: false,
      contactUploadPermitted: false,
    });
    expect(draft.draftText).toContain('Invitation ID: invitation_fixture_1');
    expect(draft.draftText).toContain('One-time code: abcdefghijklmnopqrstuvwxyz123456');
    expect(draft.draftText).toContain('grants no access or messaging consent');
    expect(JSON.stringify(draft)).not.toMatch(/https?:|household|permission|phone|recipient/iu);
    expect(() =>
      buildUserInitiatedInvitationShareDraft({
        invitationId: 'invitation_fixture_1',
        localInviteCode: 'abcdefghijklmnopqrstuvwxyz123456',
        expiresAt: '2026-08-18T12:00:00.000Z',
        surface: 'automatic_send' as 'sms_composer',
      }),
    ).toThrow();
  });
});
