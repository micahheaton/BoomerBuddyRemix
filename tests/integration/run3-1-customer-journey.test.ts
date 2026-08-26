import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppConfig } from '@boomerbuddy/config';
import {
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdProductionServiceConsentVersion,
} from '@boomerbuddy/domain';
import { createLogger } from '@boomerbuddy/observability';
import {
  createPGliteDatabase,
  DurableJobRepository,
  FeedbackRepository,
  FoundingHouseholdRepository,
  foundingHouseholdProtectedDocuments,
  foundingHouseholdServiceConsentForEnvironment,
  ProductionIdentityRepository,
  runMigrations,
  type Database,
} from '@boomerbuddy/persistence';
import type { IdentityTokenVerifier, VerifiedIdentityToken } from '@boomerbuddy/security';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app';
import { composeFeedbackWorker } from '../../apps/worker/src/feedback-composition';
import { feedbackRetentionJobType } from '../../apps/worker/src/feedback-retention';

const customerOrigin = 'https://customer.run3-1.test';
const hqOrigin = 'https://hq.run3-1.test';
const customerIssuer = 'https://customer.run3-1.clerk.test';
const hqIssuer = 'https://hq.run3-1.clerk.test';
const founderPersonId = 'person-run3-1-founder';
const founderSubject = 'user_run3_1_founder';
const customerOneSubject = 'user_run3_1_customer_one';
const customerTwoSubject = 'user_run3_1_customer_two';

function productionConfig(databasePath: string): AppConfig {
  return {
    environment: 'production',
    api: { host: '127.0.0.1', port: 4000, trustedProxyHops: 0 },
    database: {
      driver: 'pglite',
      path: databasePath,
      runMigrations: false,
      seedDemo: false,
    },
    identity: {
      allowDevelopmentIssuer: false,
      customerOrigins: [customerOrigin],
      hqOrigins: [hqOrigin],
      founderPersonId,
      clerk: {
        customer: {
          issuer: customerIssuer,
          audience: 'boomerbuddy-customer',
          jwtKey: 'customer-test-key',
          authorizedParties: [customerOrigin],
        },
        hq: {
          issuer: hqIssuer,
          audience: 'boomerbuddy-hq',
          jwtKey: 'hq-test-key',
          authorizedParties: [hqOrigin],
          maxSecondFactorAgeSeconds: 600,
        },
        founderSubject,
      },
    },
    secrets: {
      session: Buffer.alloc(0),
      artifactEncryptionKey: Buffer.alloc(32, 37),
      fingerprintKey: Buffer.alloc(32, 41),
      safeWordPepper: Buffer.from('run3-1-production-test-safe-word-pepper'),
      custodyClassification: 'replit_runtime_secret_beta',
    },
    commerce: { stripe: { mode: 'disabled' } },
    messaging: {
      twilio: {
        mode: 'disabled',
        runtimeNetworkPermitted: false,
        credentialLoadingPermitted: false,
      },
    },
    logLevel: 'error',
  };
}

function token(
  audience: 'customer' | 'hq',
  subject: string,
  providerSessionId: string,
  now: Date,
): VerifiedIdentityToken {
  const hq = audience === 'hq';
  return {
    issuer: hq ? hqIssuer : customerIssuer,
    subject,
    providerSessionId,
    audience,
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    authorizedParty: hq ? hqOrigin : customerOrigin,
    ...(hq ? { secondFactorAgeSeconds: 30 } : {}),
  };
}

function operation(
  kind: 'policy' | 'invite' | 'accept' | 'invite-revoke' | 'offboard',
  sequence: number,
): string {
  return `founding-${kind}:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

describe('Run 3.1 production-like Customer #1 journey', () => {
  let directory: string | undefined;
  let database: Database | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    await database?.close();
    app = undefined;
    database = undefined;
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('preserves one historical sponsored household while production refuses new enrollment', async () => {
    const now = new Date();
    directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-run3-1-journey-'));
    database = await createPGliteDatabase(directory);
    const appliedMigrations = await runMigrations(database);
    expect(appliedMigrations).toHaveLength(35);
    expect(appliedMigrations.at(-1)).toBe('0035_run3_1_paid_family_catalog.sql');

    const identities = new ProductionIdentityRepository(database);
    await identities.bootstrapFounder({
      issuer: hqIssuer,
      subject: founderSubject,
      founderPersonId,
      correlationId: 'correlation:run3-1-founder-bootstrap',
      now,
    });
    const founding = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 41),
      1,
      founderPersonId,
      'production',
    );
    const programEndsAt = new Date(now.getTime() + 45 * 86_400_000);
    const sponsorEndsAt = new Date(now.getTime() + 60 * 86_400_000);
    const productionProgram = await founding.bootstrapProductionProgram({
      access: {
        actorPersonId: founderPersonId,
        correlationId: 'correlation:run3-1-program-bootstrap',
      },
      operationKey: operation('policy', 1),
      benefitKey: 'family_beta_v1',
      maxHouseholds: 2,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt,
      sponsorshipPrivacyPolicyVersion: 'founding-household-production-v1',
      sponsorshipStartsAt: new Date(now.getTime() - 60_000),
      sponsorshipEndsAt: sponsorEndsAt,
      now,
    });
    expect(productionProgram).toMatchObject({
      reused: false,
      backingEvidenceTier: 'live_production',
      policy: { environment: 'production', state: 'active', maxHouseholds: 2 },
    });

    const verifiedTokens = new Map<string, VerifiedIdentityToken>([
      ['hq-token', token('hq', founderSubject, 'provider-session-founder', now)],
      [
        'customer-one-token-1',
        token('customer', customerOneSubject, 'provider-session-customer-one-1', now),
      ],
      [
        'customer-one-token-2',
        token('customer', customerOneSubject, 'provider-session-customer-one-2', now),
      ],
      [
        'customer-two-token',
        token('customer', customerTwoSubject, 'provider-session-customer-two', now),
      ],
    ]);
    const verifier: IdentityTokenVerifier = {
      verify: async ({ token: rawToken }) => {
        const verified = verifiedTokens.get(rawToken);
        if (verified === undefined) throw new Error('invalid production test token');
        return verified;
      },
    };

    const openApp = async (): Promise<FastifyInstance> => {
      if (database === undefined || directory === undefined)
        throw new Error('Database unavailable');
      return buildApp({
        config: productionConfig(directory),
        database,
        closeDatabase: false,
        initialize: false,
        now: () => new Date(),
        identityTokenVerifier: verifier,
        logger: createLogger({ level: 'error', sink: () => undefined, clock: () => now }),
      });
    };
    app = await openApp();

    const hqHeaders = { origin: hqOrigin, cookie: '__session=hq-token' };
    const customerOneHeaders = {
      origin: customerOrigin,
      cookie: '__session=customer-one-token-1',
    };
    const customerTwoHeaders = {
      origin: customerOrigin,
      cookie: '__session=customer-two-token',
    };
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: hqHeaders })).statusCode,
    ).toBe(200);
    const customerOneMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: customerOneHeaders,
    });
    const customerTwoMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: customerTwoHeaders,
    });
    expect(customerOneMe.statusCode).toBe(200);
    expect(customerTwoMe.statusCode).toBe(200);
    const householdId = String(customerOneMe.json().principal.households[0].id);
    const customerOnePersonId = String(customerOneMe.json().principal.personId);
    const customerTwoPersonId = String(customerTwoMe.json().principal.personId);
    const customerHeaders = { ...customerOneHeaders, 'x-bb-household-id': householdId };

    const customerOneIdentity = await identities.findCustomerBootstrapBySubject({
      issuer: customerIssuer,
      subject: customerOneSubject,
    });
    const customerTwoIdentity = await identities.findCustomerBootstrapBySubject({
      issuer: customerIssuer,
      subject: customerTwoSubject,
    });
    if (customerOneIdentity === null || customerTwoIdentity === null) {
      throw new Error('Production customer bootstrap is unavailable');
    }
    const customerSession = await database.query<{ id: string }>(
      `SELECT id FROM sessions
       WHERE issuer = $1 AND provider_session_id = $2 AND revoked_at IS NULL`,
      [customerIssuer, 'provider-session-customer-one-1'],
    );
    const customerSessionId = customerSession.rows[0]?.id;
    if (customerSessionId === undefined) throw new Error('Production customer session is missing');

    const historicalInvitation = await founding.createInvitation({
      access: {
        actorPersonId: founderPersonId,
        correlationId: 'correlation:run3-1-historical-invitation',
      },
      intendedIdentity: customerOneIdentity,
      operationKey: operation('invite', 2),
      now,
    });
    const invitationCredential = historicalInvitation.invitationCredential;
    if (invitationCredential === undefined) {
      throw new Error('Historical invitation credential was not created');
    }
    const revocableInvitation = await founding.createInvitation({
      access: {
        actorPersonId: founderPersonId,
        correlationId: 'correlation:run3-1-revocable-invitation',
      },
      intendedIdentity: customerTwoIdentity,
      operationKey: operation('invite', 5),
      now,
    });
    const revocableInvitationCredential = revocableInvitation.invitationCredential;
    if (revocableInvitationCredential === undefined) {
      throw new Error('Revocable invitation credential was not created');
    }
    const historicalMemberAccess = {
      actorPersonId: customerOneIdentity.personId,
      actorIssuer: customerOneIdentity.issuer,
      actorIdentityId: customerOneIdentity.identityId,
      actorIdentitySubject: customerOneIdentity.subject,
      sessionId: customerSessionId,
      audience: 'customer' as const,
      correlationId: 'correlation:run3-1-historical-acceptance',
    };
    const invitationId = historicalInvitation.invitation.id;
    await expect(
      founding.previewInvitation({
        access: historicalMemberAccess,
        householdId,
        invitationId,
        invitationCredential,
        now,
      }),
    ).resolves.toMatchObject({ householdId, invitation: { id: invitationId } });
    const serviceConsent = foundingHouseholdServiceConsentForEnvironment('production');
    const historicalAcceptance = await founding.acceptInvitation({
      access: historicalMemberAccess,
      householdId,
      invitationId,
      invitationCredential,
      operationKey: operation('accept', 3),
      serviceConsentVersion: foundingHouseholdProductionServiceConsentVersion,
      serviceDisclosureDigest: serviceConsent.documents.disclosureDigest,
      servicePolicyDigest: serviceConsent.documents.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now,
    });
    expect(historicalAcceptance).toMatchObject({
      paymentCollected: false,
      externalActionExecuted: false,
      enrollment: {
        householdId,
        state: 'active',
        evidenceTier: 'live_production',
        paymentState: 'not_paid_sponsored_beta',
      },
    });

    const activePolicyBlocked = await app.inject({
      method: 'POST',
      url: '/v1/hq/founding-households/policy',
      headers: { ...hqHeaders, 'idempotency-key': operation('policy', 6) },
      payload: {
        state: 'active',
        expectedRevision: productionProgram.policy.revision,
        benefitKey: 'family_beta_v1',
        maxHouseholds: 2,
        invitationTtlDays: 7,
        accessDurationDays: 30,
        programEndsAt: programEndsAt.toISOString(),
      },
    });
    const newInvitationBlocked = await app.inject({
      method: 'POST',
      url: '/v1/hq/founding-households/invitations',
      headers: { ...hqHeaders, 'idempotency-key': operation('invite', 6) },
      payload: { intendedCustomerSubject: customerOneSubject },
    });
    const previewBlocked = await app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${revocableInvitation.invitation.id}/preview`,
      headers: {
        ...customerTwoHeaders,
        'x-bb-household-id': customerTwoIdentity.householdId,
      },
      payload: { invitationCredential: revocableInvitationCredential },
    });
    const acceptanceBlocked = await app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${revocableInvitation.invitation.id}/accept`,
      headers: {
        ...customerTwoHeaders,
        'x-bb-household-id': customerTwoIdentity.householdId,
        'idempotency-key': operation('accept', 6),
      },
      payload: {
        invitationCredential: revocableInvitationCredential,
        serviceConsentVersion: foundingHouseholdProductionServiceConsentVersion,
        serviceDisclosureDigest: serviceConsent.documents.disclosureDigest,
        servicePolicyDigest: serviceConsent.documents.policyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
        protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    for (const response of [
      activePolicyBlocked,
      newInvitationBlocked,
      previewBlocked,
      acceptanceBlocked,
    ]) {
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
    }

    const revokedInvitation = await app.inject({
      method: 'POST',
      url: `/v1/hq/founding-households/invitations/${revocableInvitation.invitation.id}/revoke`,
      headers: { ...hqHeaders, 'idempotency-key': operation('invite-revoke', 7) },
    });
    expect(revokedInvitation.statusCode, revokedInvitation.body).toBe(200);
    expect(revokedInvitation.json()).toMatchObject({ invitation: { state: 'revoked' } });

    const historicalStatus = await app.inject({
      method: 'GET',
      url: '/v1/founding-households',
      headers: customerHeaders,
    });
    expect(historicalStatus.statusCode, historicalStatus.body).toBe(200);
    expect(historicalStatus.json()).toMatchObject({ enrollment: { state: 'active' } });

    const enrolledMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: customerHeaders,
    });
    expect(enrolledMe.statusCode, enrolledMe.body).toBe(200);
    const enrolledHousehold = (
      enrolledMe.json().principal.households as Array<{
        id: string;
        capabilities: string[];
        isProtectedMember: boolean;
      }>
    ).find((household) => household.id === householdId);
    expect(enrolledHousehold).toMatchObject({
      capabilities: expect.arrayContaining(['check:text', 'check:url', 'history:read']),
      isProtectedMember: true,
    });

    const rawCheck = 'A bank caller asked for a code; I will verify in the official application.';
    const createdCheck = await app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: customerHeaders,
      payload: { kind: 'text', content: rawCheck },
    });
    expect(createdCheck.statusCode, createdCheck.body).toBe(201);
    expect(createdCheck.body).not.toContain(rawCheck);
    expect(createdCheck.json().check).toMatchObject({ calibration: 'not_calibrated' });
    const checkId = String(createdCheck.json().check.id);

    const guessedHousehold = await app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: { ...customerTwoHeaders, 'x-bb-household-id': householdId },
    });
    expect([403, 404]).toContain(guessedHousehold.statusCode);
    const guessedFeedback = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { ...customerTwoHeaders, 'x-bb-household-id': householdId },
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000001',
        text: 'This must never cross into the first household.',
        feedbackType: 'product_feedback',
        source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(guessedFeedback.statusCode).toBe(403);

    const loggedOut = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/current',
      headers: customerHeaders,
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/checks/${checkId}`,
          headers: customerHeaders,
        })
      ).statusCode,
    ).toBe(401);
    const customerOneHeadersAfterSignIn = {
      origin: customerOrigin,
      cookie: '__session=customer-one-token-2',
      'x-bb-household-id': householdId,
    };
    const persistedAfterSignIn = await app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: customerOneHeadersAfterSignIn,
    });
    expect(persistedAfterSignIn.statusCode).toBe(200);

    await app.close();
    await database.close();
    app = undefined;
    database = await createPGliteDatabase(directory);
    await expect(runMigrations(database)).resolves.toEqual([]);
    app = await openApp();
    const persistedAfterApiRestart = await app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: customerOneHeadersAfterSignIn,
    });
    expect(persistedAfterApiRestart.statusCode).toBe(200);

    const submittedFeedback = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: customerOneHeadersAfterSignIn,
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000002',
        text: 'The result was useful, but the next step should be easier to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'post_check', deviceClass: 'desktop' },
        link: {
          permitted: true,
          objectType: 'check',
          objectId: checkId,
          consentVersion: 'feedback-linkage-v1',
        },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(submittedFeedback.statusCode, submittedFeedback.body).toBe(201);
    expect(submittedFeedback.json()).toMatchObject({
      feedback: { evidenceTier: 'live_production', reused: false },
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    });
    const feedbackId = String(submittedFeedback.json().feedback.id);
    const queue = await app.inject({ method: 'GET', url: '/v1/hq/feedback', headers: hqHeaders });
    expect(queue.statusCode, queue.body).toBe(200);
    expect(queue.json().feedback.map((item: { id: string }) => item.id)).toContain(feedbackId);
    const claimed = await app.inject({
      method: 'POST',
      url: `/v1/hq/feedback/${feedbackId}/claim`,
      headers: hqHeaders,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const feedbackContent = await app.inject({
      method: 'GET',
      url: `/v1/hq/feedback/${feedbackId}/content`,
      headers: hqHeaders,
    });
    expect(feedbackContent.statusCode, feedbackContent.body).toBe(200);
    expect(feedbackContent.json()).toMatchObject({
      feedbackId,
      evidenceTier: 'live_production',
      contentBoundary: 'assigned_minimized_text',
    });

    const familyInvitation = await app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: customerOneHeadersAfterSignIn,
      payload: {
        inviteeDisplayName: 'Server ignores this production label',
        permissions: ['view_shared_checks'],
        intendedCustomerSubject: customerTwoSubject,
      },
    });
    expect(familyInvitation.statusCode, familyInvitation.body).toBe(201);
    expect(familyInvitation.json()).toMatchObject({ delivery: 'recipient_manual_only' });
    const familyInvitationId = String(familyInvitation.json().invitation.id);
    const familyCredential = String(familyInvitation.json().localInviteCode);
    const familyPreview = await app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${familyInvitationId}/preview`,
      headers: customerTwoHeaders,
      payload: { localInviteCode: familyCredential },
    });
    expect(familyPreview.statusCode, familyPreview.body).toBe(200);
    const familyAccepted = await app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${familyInvitationId}/accept`,
      headers: customerTwoHeaders,
      payload: {
        localInviteCode: familyCredential,
        previewVersion: familyPreview.json().invitation.previewVersion,
      },
    });
    expect(familyAccepted.statusCode, familyAccepted.body).toBe(201);
    expect(familyAccepted.json()).toMatchObject({ householdId });
    const relationshipId = String(familyAccepted.json().relationship.id);
    const shared = await app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/shares`,
      headers: customerOneHeadersAfterSignIn,
      payload: { sharedWithPersonId: customerTwoPersonId },
    });
    expect(shared.statusCode, shared.body).toBe(201);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/checks/${checkId}`,
          headers: { ...customerTwoHeaders, 'x-bb-household-id': householdId },
        })
      ).statusCode,
    ).toBe(200);
    const relationshipRevoked = await app.inject({
      method: 'DELETE',
      url: `/v1/family/relationships/${relationshipId}`,
      headers: customerOneHeadersAfterSignIn,
    });
    expect(relationshipRevoked.statusCode, relationshipRevoked.body).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/checks/${checkId}`,
          headers: { ...customerTwoHeaders, 'x-bb-household-id': householdId },
        })
      ).statusCode,
    ).toBe(404);

    const feedbackRepository = new FeedbackRepository(database, {
      encryptionKey: Buffer.alloc(32, 37),
      encryptionKeyVersion: 1,
      fingerprintKey: Buffer.alloc(32, 41),
      fingerprintKeyVersion: 1,
    });
    await composeFeedbackWorker({
      environment: 'production',
      feedback: feedbackRepository,
      jobs: new DurableJobRepository(database),
      now,
    });
    await composeFeedbackWorker({
      environment: 'production',
      feedback: new FeedbackRepository(database, {
        encryptionKey: Buffer.alloc(32, 37),
        encryptionKeyVersion: 1,
        fingerprintKey: Buffer.alloc(32, 41),
        fingerprintKeyVersion: 1,
      }),
      jobs: new DurableJobRepository(database),
      now,
    });
    const retentionJobs = await database.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM durable_jobs WHERE job_type = $1',
      [feedbackRetentionJobType],
    );
    expect(retentionJobs.rows).toEqual([{ count: 1 }]);

    const offboarded = await app.inject({
      method: 'POST',
      url: '/v1/founding-households/offboard',
      headers: {
        ...customerOneHeadersAfterSignIn,
        'idempotency-key': operation('offboard', 4),
      },
    });
    expect(offboarded.statusCode, offboarded.body).toBe(200);
    expect(offboarded.json()).toMatchObject({
      reason: 'household_withdrew',
      enrollment: { state: 'revoked', evidenceTier: 'live_production' },
    });
    const deniedAfterRevocation = await app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: customerOneHeadersAfterSignIn,
      payload: { kind: 'text', content: 'A new check after revocation must be denied.' },
    });
    expect(deniedAfterRevocation.statusCode).toBe(403);

    const disabledPolicy = await app.inject({
      method: 'POST',
      url: '/v1/hq/founding-households/policy',
      headers: { ...hqHeaders, 'idempotency-key': operation('policy', 8) },
      payload: {
        state: 'disabled',
        expectedRevision: productionProgram.policy.revision,
      },
    });
    expect(disabledPolicy.statusCode, disabledPolicy.body).toBe(200);
    expect(disabledPolicy.json()).toMatchObject({ policy: { state: 'disabled' } });

    const truth = await database.query<
      {
        checks: number;
        feedback: number;
        active_enrollments: number;
        revoked_enrollments: number;
        customer_one_people: number;
        customer_two_people: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM analyses WHERE household_id = $1
            AND requested_by = $2) AS checks,
         (SELECT count(*)::integer FROM feedback_records WHERE household_id = $1
            AND actor_person_id = $2 AND evidence_tier = 'live_production') AS feedback,
         (SELECT count(*)::integer FROM founding_household_enrollments
            WHERE household_id = $1 AND state = 'active') AS active_enrollments,
         (SELECT count(*)::integer FROM founding_household_enrollments
            WHERE household_id = $1 AND state = 'revoked') AS revoked_enrollments,
         (SELECT count(*)::integer FROM persons WHERE id = $2) AS customer_one_people,
         (SELECT count(*)::integer FROM persons WHERE id = $3) AS customer_two_people`,
      [householdId, customerOnePersonId, customerTwoPersonId],
    );
    expect(truth.rows).toEqual([
      {
        checks: 1,
        feedback: 1,
        active_enrollments: 0,
        revoked_enrollments: 1,
        customer_one_people: 1,
        customer_two_people: 1,
      },
    ]);
  }, 120_000);
});
