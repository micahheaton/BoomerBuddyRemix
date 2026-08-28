import type { AppConfig } from '@boomerbuddy/config';
import { createLogger } from '@boomerbuddy/observability';
import {
  createPGliteDatabase,
  CommerceRuntimeRepository,
  EntitlementRepository,
  ProductionIdentityRepository,
  runMigrations,
  type Database,
  type HouseholdEntitlements,
} from '@boomerbuddy/persistence';
import type { IdentityTokenVerifier, VerifiedIdentityToken } from '@boomerbuddy/security';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app';

const now = new Date('2026-08-26T12:00:00.000Z');
const customerOrigin = 'https://customer.test';
const customerIssuer = 'https://customer.clerk.test';
const hqIssuer = 'https://hq.clerk.test';
const customerHeaders = { origin: customerOrigin, cookie: '__session=customer-token' };

function config(): AppConfig {
  return {
    environment: 'production',
    api: { host: '127.0.0.1', port: 4000, trustedProxyHops: 0 },
    database: {
      driver: 'pglite',
      path: ':memory:',
      runMigrations: false,
      seedDemo: false,
    },
    identity: {
      allowDevelopmentIssuer: false,
      customerOrigins: [customerOrigin],
      hqOrigins: ['https://hq.test'],
      founderPersonId: 'person-production-founder',
      clerk: {
        customer: {
          issuer: customerIssuer,
          audience: 'boomerbuddy-customer',
          jwtKey: 'customer-key',
          authorizedParties: [customerOrigin],
        },
        hq: {
          issuer: hqIssuer,
          audience: 'boomerbuddy-hq',
          jwtKey: 'hq-key',
          authorizedParties: ['https://hq.test'],
          maxSecondFactorAgeSeconds: 600,
        },
        founderSubject: 'user_production_founder',
      },
    },
    secrets: {
      session: Buffer.alloc(0),
      artifactEncryptionKey: Buffer.alloc(32, 17),
      fingerprintKey: Buffer.alloc(32, 19),
      safeWordPepper: Buffer.from('production-entitlement-route-test-pepper'),
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

function verifiedCustomerToken(): VerifiedIdentityToken {
  return {
    issuer: customerIssuer,
    subject: 'user_production_customer',
    providerSessionId: 'session_production_customer',
    audience: 'customer',
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 60_000),
    authorizedParty: customerOrigin,
  };
}

type FixtureSource = 'local' | 'sponsor' | 'web';

function fixture(
  householdId: string,
  source: FixtureSource,
  options: { readonly includeContaminants?: boolean } = {},
): HouseholdEntitlements {
  const sponsor = source === 'sponsor';
  const paid = source === 'web';
  const subscriptionId = `subscription-${source}`;
  const grantId = `grant-${source}`;
  const plan = sponsor
    ? {
        id: 'founding_family_beta_v2',
        key: 'family',
        version: 2,
        displayName: 'Founding Family beta sponsor benefit',
        state: 'active',
        prices: [
          {
            interval: 'month',
            amountMinor: 0,
            currency: 'USD',
            kind: 'founding_experiment',
          },
        ],
      }
    : {
        id: 'family_v1',
        key: 'family',
        version: 1,
        displayName: 'Family',
        state: 'hypothesis',
        prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
      };
  const primarySource = {
    subscriptionId,
    planVersionId: plan.id,
    planKey: plan.key,
    planVersion: plan.version,
    source,
    lifecycle: 'active',
    precedence: 500,
    accessState: 'effective',
    contributingGrantIds: [grantId],
  };
  const primaryGrant = {
    id: grantId,
    subject: { kind: 'household', householdId },
    source,
    planVersionId: plan.id,
    subscriptionId,
    capabilities: ['check:text', 'history:read'],
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceVerified: true,
    precedence: 500,
  };
  const primaryRecord = {
    subscription: {
      id: subscriptionId,
      source,
      lifecycle: 'active',
      sourceVerified: true,
      precedence: 500,
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    reconciliationState: paid ? 'reconciled' : 'not_required',
    plan,
    planState: plan.state,
  };
  const localGrant = {
    ...primaryGrant,
    id: 'grant-local-contaminant',
    source: 'local',
    subscriptionId: 'subscription-local-contaminant',
    planVersionId: 'family_v1',
    precedence: 300,
  };
  const localSource = {
    ...primarySource,
    subscriptionId: 'subscription-local-contaminant',
    planVersionId: 'family_v1',
    planVersion: 1,
    source: 'local',
    precedence: 300,
    contributingGrantIds: ['grant-local-contaminant'],
  };
  const pendingGrant = {
    ...primaryGrant,
    id: 'grant-pending-contaminant',
    source: 'web',
    subscriptionId: 'subscription-pending-contaminant',
    planVersionId: 'family_v1',
    sourceVerified: false,
    precedence: 600,
  };
  const pendingSource = {
    ...primarySource,
    subscriptionId: 'subscription-pending-contaminant',
    planVersionId: 'family_v1',
    planVersion: 1,
    source: 'web',
    lifecycle: 'pending',
    precedence: 600,
    accessState: 'unverified_source',
    contributingGrantIds: [],
  };
  return {
    householdId,
    capabilities: ['check:text', 'history:read'],
    grants: options.includeContaminants ? [primaryGrant, localGrant, pendingGrant] : [primaryGrant],
    portfolio: {
      accessState: 'effective',
      primarySource,
      sources: options.includeContaminants
        ? [primarySource, localSource, pendingSource]
        : [primarySource],
      contributingGrantIds: options.includeContaminants
        ? [grantId, 'grant-local-contaminant']
        : [grantId],
      allowances: [
        {
          kind: 'protected_members',
          limit: 3,
          used: 1,
          remaining: 2,
          state: 'available',
          sourceSubscriptionId: subscriptionId,
          sourcePlanVersionId: plan.id,
        },
        ...(options.includeContaminants
          ? [
              {
                kind: 'trusted_circle_participants',
                limit: 6,
                used: 0,
                remaining: 6,
                state: 'available',
                sourceSubscriptionId: 'subscription-local-contaminant',
                sourcePlanVersionId: 'family_v1',
              },
            ]
          : []),
      ],
    },
    sources: [primaryRecord],
  } as unknown as HouseholdEntitlements;
}

async function installExactProductionPaidFamily(input: {
  readonly database: Database;
  readonly householdId: string;
  readonly personId: string;
  readonly now: Date;
}): Promise<{
  readonly subscriptionId: string;
  readonly providerSubscriptionId: string;
  readonly providerInvoiceId: string;
  readonly providerPriceId: string;
  readonly providerProductId: string;
  readonly providerItemId: string;
  readonly apiVersion: string;
  readonly periodStartsAt: Date;
  readonly periodEndsAt: Date;
  readonly preflightRecordId: string;
}> {
  const subscriptionId = 'subscription-production-paid-family';
  const providerSubscriptionId = 'sub_live_synthetic_family';
  const providerCustomerId = 'cus_live_synthetic_family';
  const providerSessionId = 'cs_live_synthetic_family';
  const checkoutIntentId = 'checkout-intent-production-paid-family';
  const checkoutEventId = 'commerce-event-production-checkout';
  const invoiceEventId = 'commerce-event-production-invoice';
  const reconciliationEventId = 'commerce-event-production-reconciliation';
  const providerInvoiceId = 'in_live_synthetic_family';
  const providerPriceId = 'price_live_synthetic_family_monthly';
  const providerProductId = 'prod_live_synthetic_family';
  const providerItemId = 'si_live_synthetic_family';
  const providerInvoicePaymentIntentId = 'pi_live_synthetic_invoice';
  const providerInvoicePaymentId = 'inpay_live_synthetic_family';
  const apiVersion = '2026-07-29.dahlia';
  const periodStartsAt = new Date(input.now.getTime() - 24 * 60 * 60_000);
  const periodEndsAt = new Date(input.now.getTime() + 29 * 24 * 60 * 60_000);
  const checkoutExpiresAt = new Date(input.now.getTime() + 22 * 60 * 60_000);
  const checkedAt = new Date(input.now.getTime() - 2 * 60 * 60_000);
  const checkoutAt = new Date(input.now.getTime() - 90 * 60_000);
  const paidAt = new Date(input.now.getTime() - 60 * 60_000);
  const reconciledAt = new Date(input.now.getTime() - 30 * 60_000);

  await input.database.query(
    `INSERT INTO commerce_subscriptions(
       household_id, id, payer_person_id, plan_version_id, source, lifecycle,
       source_verified, precedence, current_period_starts_at, current_period_ends_at,
       reconciliation_state, created_at, updated_at
     ) VALUES ($1,$2,$3,'family_v1','web','active',true,500,$4,$5,
               'reconciled',$6,$7)`,
    [
      input.householdId,
      subscriptionId,
      input.personId,
      periodStartsAt.toISOString(),
      periodEndsAt.toISOString(),
      checkedAt.toISOString(),
      reconciledAt.toISOString(),
    ],
  );
  await input.database.query(
    `INSERT INTO entitlement_grants(
       household_id, id, source, capabilities, starts_at, ends_at,
       source_verified, precedence, plan_version_id, subscription_id
     ) SELECT $1,'grant-production-paid-family','web',plan.capabilities,$2,$3,
              true,500,plan.id,$4
       FROM commerce_plan_versions plan WHERE plan.id = 'family_v1'`,
    [input.householdId, periodStartsAt.toISOString(), periodEndsAt.toISOString(), subscriptionId],
  );

  const preflight = await new CommerceRuntimeRepository(input.database).recordStripePreflight({
    evidence: {
      environment: 'production',
      accountId: 'acct_live_synthetic_family',
      accountChargesEnabled: true,
      accountPayoutsEnabled: true,
      accountCountry: 'US',
      accountBusinessType: 'company',
      livemode: true,
      apiVersion,
      offer: {
        offerId: 'founding_family_monthly_v1',
        planVersionId: 'family_v1',
        plan: 'family',
        displayName: 'Family',
        billingInterval: 'month',
        currency: 'usd',
        unitAmountMinor: 1_499,
        quantity: 1,
        providerProductId,
        providerPriceId,
        trialPeriodDays: 0,
        customerSelectable: false,
        defaultAcquisitionOffer: false,
      },
      portalConfigurationId: 'bpc_live_synthetic_cancel_only',
      productActive: true,
      priceActive: true,
      portalCancelOnly: true,
      portalMutationControlsExact: true,
      portalCancellationMode: 'at_period_end',
      portalProrationBehavior: 'none',
      portalSubscriptionUpdateDefaultsEmpty: true,
      portalPaymentMethodUpdateEnabled: true,
      portalInvoiceHistoryEnabled: true,
      retentionCouponEvidence: 'manual_founder_browser_required',
      promotionsEnabled: false,
      automaticTaxEnabled: false,
      adaptivePricingEnabled: false,
    },
    evidenceLevel: 'live_production',
    transportKind: 'stripe_https',
    runtimeRunId: 'production-paid-family-route-test',
    authenticityKind: 'provider_read',
    now: checkedAt,
  });

  await input.database.query(
    `INSERT INTO commerce_event_inbox(
       id, provider, environment, external_event_id, event_type, payload_hmac,
       fingerprint_key_version, authenticity, status, received_at, processed_at,
       provider_api_version, provider_object_id, provider_event_created_at,
       normalized_lifecycle, application_state, applied_at, error_code,
       evidence_tier, transport_kind,
       transport_livemode, runtime_run_id, signature_verified_at
     ) VALUES
       ($1,'stripe','production','evt_live_synthetic_checkout','checkout.session.completed',
        'synthetic-checkout-digest',1,'verified','processed',$2,$2,$3,$4,$2,NULL,
        'applied',$2,NULL,'live_production','stripe_https',true,$5,$2),
       ($6,'stripe','production','evt_live_synthetic_invoice','invoice.paid',
        'synthetic-invoice-digest',1,'verified','processed',$7,$7,$3,$8,$7,NULL,
        'ignored',NULL,'provider.reconciled_from_snapshot','live_production',
        'stripe_https',true,$5,$7),
       ($9,'stripe','production','reconciliation:synthetic-paid-family:1',
        'subscription.reconciliation','synthetic-reconciliation-digest',1,'verified',
        'processed',$10,$10,$3,$11,$10,'active','applied',$10,NULL,'live_production',
        'stripe_https',true,$5,NULL)`,
    [
      checkoutEventId,
      checkoutAt.toISOString(),
      apiVersion,
      providerSessionId,
      'production-paid-family-route-test',
      invoiceEventId,
      paidAt.toISOString(),
      providerInvoiceId,
      reconciliationEventId,
      reconciledAt.toISOString(),
      providerSubscriptionId,
    ],
  );
  await input.database.query(
    `INSERT INTO commerce_checkout_intents(
       household_id, id, subscription_id, requested_by_person_id,
       billing_authority_person_id, plan_version_id, offer_id, billing_interval,
       provider_price_id, provider, environment, idempotency_key, state,
       provider_session_id, created_at, updated_at, expires_at,
       server_operation_id, provider_idempotency_key, provider_requested_expires_at,
       provider_returned_expires_at, dispatch_state
     ) VALUES ($1,$2,$3,$4,$4,'family_v1','founding_family_monthly_v1','month',
               $5,'stripe','production','production-paid-family-checkout-operation',
               'session_created',$6,$7,$8,$9,
               'production-paid-family-checkout-operation',
               'bb:production:checkout:synthetic-paid-family',$9,$9,'session_recorded')`,
    [
      input.householdId,
      checkoutIntentId,
      subscriptionId,
      input.personId,
      providerPriceId,
      providerSessionId,
      checkedAt.toISOString(),
      checkoutAt.toISOString(),
      checkoutExpiresAt.toISOString(),
    ],
  );
  await input.database.query(
    `INSERT INTO commerce_stripe_session_operations(
       id, household_id, checkout_intent_id, action, environment,
       server_operation_id, provider_idempotency_key, state, attempt_count,
       provider_session_id, requested_expires_at, returned_expires_at,
       created_at, updated_at, actor_person_id, canonical_subscription_id,
       provider_price_id, success_url, cancel_url, terminal_at,
       preflight_record_id
     ) VALUES ('stripe-operation-production-paid-family',$1,$2,'checkout','production',
               'production-paid-family-checkout-operation',
               'bb:production:checkout:synthetic-paid-family','succeeded',1,$3,$4,$4,
               $5,$6,$7,$8,$9,'https://customer.test/member/billing/success',
               'https://customer.test/member/billing',$6,$10)`,
    [
      input.householdId,
      checkoutIntentId,
      providerSessionId,
      checkoutExpiresAt.toISOString(),
      checkedAt.toISOString(),
      checkoutAt.toISOString(),
      input.personId,
      subscriptionId,
      providerPriceId,
      preflight.id,
    ],
  );
  await input.database.query(
    `INSERT INTO commerce_stripe_checkout_completions(
       provider_session_id, environment, household_id, checkout_intent_id,
       subscription_id, provider_subscription_id, provider_customer_id,
       provider_payment_intent_id, source_inbox_id, provider_event_id,
       payment_status, session_status, amount_total, currency, completed_at,
       provider_expires_at
     ) VALUES ($1,'production',$2,$3,$4,$5,$6,$7,$8,
               'evt_live_synthetic_checkout','paid','complete',1499,'usd',$9,$10)`,
    [
      providerSessionId,
      input.householdId,
      checkoutIntentId,
      subscriptionId,
      providerSubscriptionId,
      providerCustomerId,
      null,
      checkoutEventId,
      checkoutAt.toISOString(),
      checkoutExpiresAt.toISOString(),
    ],
  );
  await input.database.query(
    `INSERT INTO commerce_provider_customers(
       provider, environment, provider_customer_id, household_id, verified_at
     ) VALUES ('stripe','production',$1,$2,$3)`,
    [providerCustomerId, input.householdId, checkoutAt.toISOString()],
  );
  await input.database.query(
    `INSERT INTO commerce_stripe_paid_invoice_evidence(
       provider_invoice_id, environment, household_id, subscription_id,
       checkout_intent_id, provider_subscription_id, provider_subscription_item_id,
       provider_payment_intent_id, provider_invoice_payment_id, source_inbox_id,
       billing_reason, amount_paid, amount_remaining, currency, quantity,
       discount_amount, tax_amount, period_starts_at, period_ends_at,
       provider_paid_at, recorded_at, evidence_digest
     ) VALUES ($1,'production',$2,$3,$4,$5,$6,$7,$8,$9,'subscription_create',
               1499,0,'usd',1,0,0,$10,$11,$12,$12,'synthetic-invoice-digest')`,
    [
      providerInvoiceId,
      input.householdId,
      subscriptionId,
      checkoutIntentId,
      providerSubscriptionId,
      providerItemId,
      providerInvoicePaymentIntentId,
      providerInvoicePaymentId,
      invoiceEventId,
      periodStartsAt.toISOString(),
      periodEndsAt.toISOString(),
      paidAt.toISOString(),
    ],
  );
  await input.database.query(
    `INSERT INTO commerce_stripe_invoice_authority_facts(
       provider_invoice_id, provider_invoice_line_id, provider_subscription_item_id,
       provider_product_id, provider_price_id, invoice_discounts_empty,
       invoice_taxes_empty, invoice_credits_empty, subscription_page_complete, recorded_at
     ) VALUES ($1,'il_live_synthetic_family',$2,$3,$4,true,true,true,true,$5)`,
    [providerInvoiceId, providerItemId, providerProductId, providerPriceId, paidAt.toISOString()],
  );
  await input.database.query(
    `INSERT INTO commerce_provider_subscription_records(
       id, household_id, subscription_id, provider, environment,
       external_subscription_id, raw_state, provider_version, observed_at, verified_at,
       last_external_event_id, last_provider_event_created_at, last_provider_api_version,
       provider_customer_id
     ) VALUES ('provider-record-production-paid-family',$1,$2,'stripe','production',$3,
               'active',$4,$5,$5,'reconciliation:synthetic-paid-family:1',$5,$4,$6)`,
    [
      input.householdId,
      subscriptionId,
      providerSubscriptionId,
      apiVersion,
      reconciledAt.toISOString(),
      providerCustomerId,
    ],
  );

  return {
    subscriptionId,
    providerSubscriptionId,
    providerInvoiceId,
    providerPriceId,
    providerProductId,
    providerItemId,
    apiVersion,
    periodStartsAt,
    periodEndsAt,
    preflightRecordId: preflight.id,
  };
}

describe('production entitlement route projection', () => {
  let database: Database;
  let app: FastifyInstance;
  let householdId: string;
  let personId: string;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    await new ProductionIdentityRepository(database).bootstrapFounder({
      issuer: hqIssuer,
      subject: 'user_production_founder',
      founderPersonId: 'person-production-founder',
      correlationId: 'correlation-production-founder',
      now,
    });
    const identityTokenVerifier: IdentityTokenVerifier = {
      verify: async () => verifiedCustomerToken(),
    };
    app = await buildApp({
      config: config(),
      database,
      closeDatabase: false,
      initialize: false,
      now: () => now,
      identityTokenVerifier,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => now }),
    });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: customerHeaders });
    expect(me.statusCode).toBe(200);
    householdId = String(me.json().principal.households[0].id);
    personId = String(me.json().principal.personId);
    await database.query(
      `INSERT INTO household_billing_authorities(
         household_id, person_id, status, granted_by_person_id, granted_at, grant_source
       ) VALUES ($1,$2,'active',$2,$3,'household_member')`,
      [householdId, personId, now.toISOString()],
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await database.close();
  });

  async function entitlements(value: HouseholdEntitlements) {
    vi.spyOn(EntitlementRepository.prototype, 'forHousehold').mockResolvedValue(value);
    return app.inject({ method: 'GET', url: '/v1/entitlements', headers: customerHeaders });
  }

  it('returns empty production diagnostics for a local-only portfolio', async () => {
    const response = await entitlements(fixture(householdId, 'local'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: { kind: 'household', id: householdId },
      capabilities: [],
      grants: [],
      commerce: {
        accessState: 'no_effective_context',
        primary: null,
        sources: [],
        allowances: [],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
  });

  it('returns only an exact effective sponsor projection', async () => {
    const response = await entitlements(
      fixture(householdId, 'sponsor', { includeContaminants: true }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: { kind: 'household', id: householdId },
      capabilities: ['check:text', 'history:read'],
      grants: [],
      commerce: {
        accessState: 'effective',
        primary: {
          subscriptionId: 'subscription-sponsor',
          source: 'sponsor',
          lifecycle: 'active',
          precedence: 500,
          sourceVerified: true,
          reconciliationState: 'not_required',
          startsAt: '2026-08-01T00:00:00.000Z',
          plan: {
            id: 'founding_family_beta_v2',
            key: 'family',
            version: 2,
            displayName: 'Sponsored Family access',
            state: 'active',
            prices: [],
          },
        },
        sources: [],
        allowances: [
          {
            kind: 'protected_members',
            limit: 3,
            used: 1,
            remaining: 2,
            state: 'available',
            sourceSubscriptionId: 'subscription-sponsor',
            sourcePlanVersionId: 'founding_family_beta_v2',
          },
        ],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
    expect(response.body).not.toMatch(
      /grant-sponsor|local-contaminant|pending-contaminant|founding_experiment/,
    );
  });

  it('resolves an exact production paid-family chain at monthly USD 14.99', async () => {
    const installed = await installExactProductionPaidFamily({
      database,
      householdId,
      personId,
      now,
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/entitlements',
      headers: customerHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      subject: { kind: 'household', id: householdId },
      capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
      grants: [],
      commerce: {
        accessState: 'effective',
        primary: {
          subscriptionId: installed.subscriptionId,
          source: 'web',
          lifecycle: 'active',
          precedence: 500,
          sourceVerified: true,
          reconciliationState: 'reconciled',
          plan: {
            id: 'family_v1',
            key: 'family',
            version: 1,
            displayName: 'Family',
            state: 'active',
            prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
          },
        },
        sources: [],
        allowances: [
          {
            kind: 'protected_members',
            limit: 3,
            used: 0,
            remaining: 3,
            state: 'available',
            sourceSubscriptionId: installed.subscriptionId,
            sourcePlanVersionId: 'family_v1',
          },
          {
            kind: 'trusted_circle_participants',
            limit: 6,
            used: 0,
            remaining: 6,
            state: 'available',
            sourceSubscriptionId: installed.subscriptionId,
            sourcePlanVersionId: 'family_v1',
          },
        ],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
    const boundary = await new EntitlementRepository(database).forHousehold(
      householdId,
      installed.periodEndsAt,
    );
    expect(boundary.portfolio.primarySource).toBeNull();
    await expect(
      database.query(
        `UPDATE commerce_stripe_session_operations
         SET preflight_record_id = NULL
         WHERE id = 'stripe-operation-production-paid-family'`,
      ),
    ).rejects.toThrow(/commerce_stripe_production_operation_preflight_check/u);
    await database.query(
      `UPDATE commerce_provider_subscription_records
       SET financial_restriction = 'disputed',
           financial_restriction_event_id = 'evt_live_synthetic_dispute',
           financial_restricted_at = $1
       WHERE id = 'provider-record-production-paid-family'`,
      [now.toISOString()],
    );
    const restricted = await new EntitlementRepository(database).forHousehold(householdId, now);
    expect(restricted.portfolio.primarySource).toBeNull();
    expect(response.body).not.toMatch(/14900|grant-web|"hypothesis":true|local_mock|development/);
  });

  it('fails closed on lifecycle, API, digest, and competing-provider drift', async () => {
    const installed = await installExactProductionPaidFamily({
      database,
      householdId,
      personId,
      now,
    });
    const repository = new EntitlementRepository(database);
    await expect(repository.forHousehold(householdId, now)).resolves.toMatchObject({
      portfolio: { primarySource: { subscriptionId: installed.subscriptionId } },
    });

    await database.query(
      `UPDATE commerce_event_inbox
       SET event_type = 'customer.subscription.deleted', signature_verified_at = $2
       WHERE id = $1`,
      ['commerce-event-production-reconciliation', now.toISOString()],
    );
    expect((await repository.forHousehold(householdId, now)).portfolio.primarySource).toBeNull();
    await database.query(
      `UPDATE commerce_event_inbox
       SET event_type = 'subscription.reconciliation', signature_verified_at = NULL
       WHERE id = $1`,
      ['commerce-event-production-reconciliation'],
    );

    await database.query(
      `UPDATE commerce_event_inbox SET normalized_lifecycle = 'canceled' WHERE id = $1`,
      ['commerce-event-production-reconciliation'],
    );
    expect((await repository.forHousehold(householdId, now)).portfolio.primarySource).toBeNull();
    await database.query(
      `UPDATE commerce_event_inbox SET normalized_lifecycle = 'active' WHERE id = $1`,
      ['commerce-event-production-reconciliation'],
    );

    await database.query(
      `UPDATE commerce_event_inbox SET provider_api_version = '2026-02-25.clover' WHERE id = $1`,
      ['commerce-event-production-checkout'],
    );
    expect((await repository.forHousehold(householdId, now)).portfolio.primarySource).toBeNull();
    await database.query(
      `UPDATE commerce_event_inbox SET provider_api_version = $2 WHERE id = $1`,
      ['commerce-event-production-checkout', installed.apiVersion],
    );

    await database.query(
      `UPDATE commerce_event_inbox SET payload_hmac = 'mismatched-invoice-digest' WHERE id = $1`,
      ['commerce-event-production-invoice'],
    );
    expect((await repository.forHousehold(householdId, now)).portfolio.primarySource).toBeNull();
    await database.query(
      `UPDATE commerce_event_inbox SET payload_hmac = 'synthetic-invoice-digest' WHERE id = $1`,
      ['commerce-event-production-invoice'],
    );

    await database.query(
      `UPDATE commerce_subscriptions SET lifecycle = 'cancel_at_period_end' WHERE id = $1`,
      [installed.subscriptionId],
    );
    await database.query(
      `UPDATE commerce_provider_subscription_records SET raw_state = 'cancel_at_period_end'
       WHERE id = 'provider-record-production-paid-family'`,
    );
    await database.query(
      `UPDATE commerce_event_inbox SET normalized_lifecycle = 'cancel_at_period_end' WHERE id = $1`,
      ['commerce-event-production-reconciliation'],
    );
    await expect(repository.forHousehold(householdId, now)).resolves.toMatchObject({
      portfolio: { primarySource: { lifecycle: 'cancel_at_period_end' } },
    });

    await database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, observed_at, verified_at
       ) VALUES (
         'provider-record-production-competing', $1, $2, 'stripe', 'production',
         'sub_live_synthetic_competing', 'cancel_at_period_end', $3, $3
       )`,
      [householdId, installed.subscriptionId, now.toISOString()],
    );
    expect((await repository.forHousehold(householdId, now)).portfolio.primarySource).toBeNull();
  });

  it('extends grace only from exact live failed-invoice lineage and an open window', async () => {
    const installed = await installExactProductionPaidFamily({
      database,
      householdId,
      personId,
      now,
    });
    const failureAt = new Date(installed.periodEndsAt.getTime() + 30 * 60_000);
    const reconciliationAt = new Date(failureAt.getTime() + 60_000);
    const graceAt = new Date(failureAt.getTime() + 30 * 60_000);
    const graceEndsAt = new Date(installed.periodEndsAt.getTime() + 3 * 24 * 60 * 60_000);
    const failedEventId = 'commerce-event-production-failure';
    const failedInvoiceId = 'in_live_synthetic_family_failure';
    const failedDigest = 'synthetic-failure-digest';

    await database.query(
      `INSERT INTO commerce_event_inbox(
         id, provider, environment, external_event_id, event_type, payload_hmac,
         fingerprint_key_version, authenticity, status, received_at, processed_at,
         provider_api_version, provider_object_id, provider_event_created_at,
         normalized_lifecycle, application_state, error_code, evidence_tier,
         transport_kind, transport_livemode, runtime_run_id, signature_verified_at
       ) VALUES (
         $1, 'stripe', 'production', 'evt_live_synthetic_family_failure',
         'invoice.payment_failed', $2, 1, 'verified', 'processed', $3, $3,
         $4, $5, $3, 'delinquent', 'ignored', 'provider.reconciled_from_snapshot',
         'live_production', 'stripe_https', true, 'production-paid-family-route-test', $3
       )`,
      [failedEventId, failedDigest, failureAt.toISOString(), installed.apiVersion, failedInvoiceId],
    );
    await database.query(
      `INSERT INTO commerce_event_inbox(
         id, provider, environment, external_event_id, event_type, payload_hmac,
         fingerprint_key_version, authenticity, status, received_at, processed_at,
         provider_api_version, provider_object_id, provider_event_created_at,
         normalized_lifecycle, application_state, applied_at, evidence_tier,
         transport_kind, transport_livemode, runtime_run_id
       ) VALUES (
         'commerce-event-production-grace-reconciliation', 'stripe', 'production',
         'reconciliation:synthetic-paid-family-grace:1', 'subscription.reconciliation',
         'synthetic-grace-reconciliation-digest', 1, 'verified', 'processed', $1, $1,
         $2, $3, $1, 'delinquent', 'applied', $1, 'live_production', 'stripe_https', true,
         'production-paid-family-route-test'
       )`,
      [reconciliationAt.toISOString(), installed.apiVersion, installed.providerSubscriptionId],
    );
    await database.query(
      `UPDATE commerce_provider_subscription_records
       SET raw_state = 'delinquent', provider_version = $2, observed_at = $3, verified_at = $3,
           last_external_event_id = 'reconciliation:synthetic-paid-family-grace:1',
           last_provider_event_created_at = $3, last_provider_api_version = $2
       WHERE id = 'provider-record-production-paid-family' AND subscription_id = $1`,
      [installed.subscriptionId, installed.apiVersion, reconciliationAt.toISOString()],
    );
    await database.query(
      `UPDATE commerce_subscriptions
       SET lifecycle = 'grace', current_period_ends_at = $2, updated_at = $3
       WHERE id = $1`,
      [installed.subscriptionId, graceEndsAt.toISOString(), reconciliationAt.toISOString()],
    );
    await database.query(`UPDATE entitlement_grants SET ends_at = $2 WHERE subscription_id = $1`, [
      installed.subscriptionId,
      graceEndsAt.toISOString(),
    ]);
    await database.query(
      `INSERT INTO commerce_stripe_dunning_events(
         id, environment, household_id, subscription_id, provider_invoice_id,
         dunning_window_key, event_kind, paid_through_at, grace_starts_at,
         grace_ends_at, source_inbox_id, evidence_digest, occurred_at
       ) VALUES (
         'dunning-production-family-open', 'production', $1, $2, $3, $3, 'opened',
         $4, $4, $5, $6, $7, $8
       )`,
      [
        householdId,
        installed.subscriptionId,
        failedInvoiceId,
        installed.periodEndsAt.toISOString(),
        graceEndsAt.toISOString(),
        failedEventId,
        failedDigest,
        failureAt.toISOString(),
      ],
    );

    const repository = new EntitlementRepository(database);
    expect(
      (await repository.forHousehold(householdId, graceAt)).portfolio.primarySource,
    ).toBeNull();

    await database.query(
      `INSERT INTO commerce_stripe_failed_invoice_evidence(
         provider_invoice_id, environment, household_id, subscription_id,
         provider_subscription_id, provider_subscription_item_id, source_inbox_id,
         provider_payment_intent_id, provider_invoice_payment_id, billing_reason,
         amount_due, currency, quantity, attempt_count, failure_status, occurred_at,
         evidence_digest, provider_invoice_line_id, provider_product_id,
         provider_price_id, line_proration, period_starts_at, period_ends_at
       ) VALUES (
         $1, 'production', $2, $3, $4, $5, $6, NULL,
         'inpay_live_synthetic_family_failure', 'subscription_cycle', 1499, 'usd', 1, 1,
         'failed', $7, $8, 'il_live_synthetic_family_failure', $9, $10, false, $11, $12
       )`,
      [
        failedInvoiceId,
        householdId,
        installed.subscriptionId,
        installed.providerSubscriptionId,
        installed.providerItemId,
        failedEventId,
        failureAt.toISOString(),
        failedDigest,
        installed.providerProductId,
        installed.providerPriceId,
        installed.periodStartsAt.toISOString(),
        installed.periodEndsAt.toISOString(),
      ],
    );
    await expect(repository.forHousehold(householdId, graceAt)).resolves.toMatchObject({
      portfolio: { primarySource: { lifecycle: 'grace' } },
    });
    expect(
      (await repository.forHousehold(householdId, graceEndsAt)).portfolio.primarySource,
    ).toBeNull();

    await database.query(
      `UPDATE commerce_event_inbox SET payload_hmac = 'mismatched-failure-digest' WHERE id = $1`,
      [failedEventId],
    );
    expect(
      (await repository.forHousehold(householdId, graceAt)).portfolio.primarySource,
    ).toBeNull();
    await database.query(`UPDATE commerce_event_inbox SET payload_hmac = $2 WHERE id = $1`, [
      failedEventId,
      failedDigest,
    ]);

    await database.query(
      `INSERT INTO commerce_stripe_dunning_events(
         id, environment, household_id, subscription_id, provider_invoice_id,
         dunning_window_key, event_kind, paid_through_at, grace_starts_at,
         grace_ends_at, source_inbox_id, evidence_digest, occurred_at
       ) VALUES (
         'dunning-production-family-recovered', 'production', $1, $2, $3, $3, 'recovered',
         $4, $4, $5, 'commerce-event-production-invoice',
         'synthetic-invoice-digest', $6
       )`,
      [
        householdId,
        installed.subscriptionId,
        failedInvoiceId,
        installed.periodEndsAt.toISOString(),
        graceEndsAt.toISOString(),
        reconciliationAt.toISOString(),
      ],
    );
    expect(
      (await repository.forHousehold(householdId, graceAt)).portfolio.primarySource,
    ).toBeNull();
  });
});
