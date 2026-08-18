import {
  foundingHouseholdCohortKey,
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdProductionServiceConsentVersion,
} from '@boomerbuddy/domain';
import type { Database } from './database';
import {
  FoundingHouseholdRepository,
  foundingHouseholdProductionServiceDocuments,
  foundingHouseholdProtectedDocuments,
} from './founding-households';
import { ProductionIdentityRepository } from './production-identity';
import { SessionRepository } from './sessions';

const fixtureFounderPersonId = 'person-hq-heidi';

function foundingOperation(
  kind: 'policy' | 'invite' | 'accept' | 'offboard',
  sequence: number,
): string {
  return `founding-${kind}:10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

export interface ProductionFeedbackEnrollee {
  readonly householdId: string;
  readonly actorPersonId: string;
  readonly enrollmentId: string;
  readonly access: {
    readonly actorPersonId: string;
    readonly actorIssuer: string;
    readonly actorIdentityId: string;
    readonly actorIdentitySubject: string;
    readonly sessionId: string;
    readonly audience: 'customer';
    readonly correlationId: string;
  };
}

export class ProductionFeedbackFoundingFixture {
  private operationSequence = 0;
  private idSequence = 0;
  private readonly founding: FoundingHouseholdRepository;

  private constructor(
    private readonly database: Database,
    private readonly now: Date,
  ) {
    this.founding = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 83),
      1,
      fixtureFounderPersonId,
      'production',
      { next: (prefix) => `${prefix}-feedback-production-${++this.idSequence}` },
      async (_transaction, observedAt) => new Date(observedAt),
    );
  }

  static async create(
    database: Database,
    now: Date,
    maxHouseholds = 5,
  ): Promise<ProductionFeedbackFoundingFixture> {
    const fixture = new ProductionFeedbackFoundingFixture(database, now);
    await fixture.provisionProgram(maxHouseholds);
    return fixture;
  }

  private nextOperation(kind: 'policy' | 'invite' | 'accept' | 'offboard'): string {
    this.operationSequence += 1;
    return foundingOperation(kind, this.operationSequence);
  }

  private async provisionProgram(maxHouseholds: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
         VALUES ('identity-feedback-production-founder',$1,
                 'https://founder.feedback.test','founder_feedback_subject','active',$2)`,
        [fixtureFounderPersonId, this.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO organizations(id, name, kind, verification_state, created_at)
         VALUES
           ('organization-feedback-production-hq','BoomerBuddy HQ','internal','verified',$1),
           ('organization-feedback-production-sponsor','Feedback Founding sponsor',
            'sponsor','verified',$1)`,
        [this.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO employee_assignments(
           id, person_id, organization_id, role, status, created_at
         ) VALUES ('employee-feedback-production-founder',$1,
                   'organization-feedback-production-hq','hq_owner','active',$2)`,
        [fixtureFounderPersonId, this.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO production_founder_bootstraps(
           bootstrap_key, identity_id, issuer, subject, person_id,
           organization_id, organization_kind, organization_verification_state,
           employee_assignment_id, employee_role, correlation_id, created_at
         ) VALUES (
           'production-founder-v1','identity-feedback-production-founder',
           'https://founder.feedback.test','founder_feedback_subject',$1,
           'organization-feedback-production-hq','internal','verified',
           'employee-feedback-production-founder','hq_owner',
           'correlation:feedback-production-founder',$2
         )`,
        [fixtureFounderPersonId, this.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO commerce_sponsorships(
           id, organization_id, plan_version_id, state, privacy_policy_version,
           starts_at, ends_at, created_at
         ) VALUES (
           'feedback-founding-sponsorship-production-v1',
           'organization-feedback-production-sponsor','founding_family_beta_v2','active',
           'feedback-founding-production-v1',$1,$2,$1
         )`,
        [this.now.toISOString(), '2027-01-01T00:00:00.000Z'],
      );
      await transaction.query(
        `INSERT INTO founding_household_sponsor_backings(
           cohort_key, environment, benefit_key, organization_id, sponsorship_id,
           plan_version_id, evidence_tier, approved_by_person_id, approved_at
         ) VALUES (
           $1,'production','family_beta_v1','organization-feedback-production-sponsor',
           'feedback-founding-sponsorship-production-v1','founding_family_beta_v2',
           'live_production',$2,$3
         )`,
        [foundingHouseholdCohortKey, fixtureFounderPersonId, this.now.toISOString()],
      );
    });
    await this.founding.configurePolicy({
      access: {
        actorPersonId: fixtureFounderPersonId,
        correlationId: 'correlation:feedback-production-policy',
      },
      operationKey: this.nextOperation('policy'),
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      now: this.now,
    });
  }

  async enroll(suffix: string): Promise<ProductionFeedbackEnrollee> {
    let identitySequence = 0;
    const identities = new ProductionIdentityRepository(this.database, {
      next: (prefix) => `${prefix}-feedback-production-${suffix}-${++identitySequence}`,
    });
    const bootstrap = await identities.ensureCustomerBootstrap({
      issuer: 'https://customer.feedback.test',
      subject: `customer_feedback_${suffix}`,
      now: this.now,
    });
    if (bootstrap === null) throw new Error('Expected a production feedback customer bootstrap');
    const sessions = new SessionRepository(
      this.database,
      { next: () => `session-feedback-production-${suffix}` },
      'production',
    );
    const session = await sessions.resolveProviderSession({
      identityId: bootstrap.identityId,
      personId: bootstrap.personId,
      issuer: bootstrap.issuer,
      subject: bootstrap.subject,
      providerSessionId: `provider-session-feedback-production-${suffix}`,
      audience: 'customer',
      issuedAt: new Date(this.now.getTime() - 1_000),
      expiresAt: new Date(this.now.getTime() + 30 * 86_400_000),
      now: this.now,
    });
    if (session === null) throw new Error('Expected a production feedback customer session');
    const access = {
      actorPersonId: bootstrap.personId,
      actorIssuer: session.issuer,
      actorIdentityId: session.identityId,
      actorIdentitySubject: session.identitySubject,
      sessionId: session.principal.sessionId,
      audience: 'customer' as const,
      correlationId: `correlation:feedback-production-${suffix}`,
    };
    const invitation = await this.founding.createInvitation({
      access: {
        actorPersonId: fixtureFounderPersonId,
        correlationId: `correlation:feedback-production-invite-${suffix}`,
      },
      intendedIdentity: bootstrap,
      operationKey: this.nextOperation('invite'),
      now: this.now,
    });
    if (invitation.invitationCredential === undefined) {
      throw new Error('Expected a one-time production Founding credential');
    }
    const accepted = await this.founding.acceptInvitation({
      access,
      householdId: bootstrap.householdId,
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.invitationCredential,
      operationKey: this.nextOperation('accept'),
      serviceConsentVersion: foundingHouseholdProductionServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdProductionServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdProductionServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now: this.now,
    });
    return {
      householdId: bootstrap.householdId,
      actorPersonId: bootstrap.personId,
      enrollmentId: accepted.enrollment.id,
      access,
    };
  }

  async offboard(enrollee: ProductionFeedbackEnrollee, now: Date): Promise<void> {
    await this.founding.offboard({
      access: enrollee.access,
      authority: 'household',
      householdId: enrollee.householdId,
      operationKey: this.nextOperation('offboard'),
      now,
    });
  }
}
