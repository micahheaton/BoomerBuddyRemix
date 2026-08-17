import { randomUUID } from 'node:crypto';
import {
  stripeBillingStatusResponseSchema,
  stripeCheckoutRequestSchema,
  stripeCheckoutResponseSchema,
  stripeControlResponseSchema,
  stripeHouseholdEligibilityRequestSchema,
  stripeInitiationControlProjectionSchema,
  stripeInitiationControlQuerySchema,
  stripeInitiationControlRequestSchema,
  stripePortalResponseSchema,
  stripeReconciliationRepairProjectionSchema,
  stripeReconciliationRepairQuerySchema,
  stripeReconciliationRepairRequestSchema,
  stripeReconciliationRepairResponseSchema,
  stripeSessionRetryRepairProjectionSchema,
  stripeSessionRetryRepairQuerySchema,
  stripeSessionRetryRepairRequestSchema,
  stripeSessionRetryRepairResponseSchema,
  stripeWebhookResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import {
  normalizeStripeEvent,
  StripeAdapter,
  StripeSessionDispatchError,
  StripeWebhookError,
  verifyStripeWebhook,
  type CommerceAuthorizationPort,
  type StripeTransport,
} from '@boomerbuddy/integrations';
import { deriveStripeProviderIdempotencyKey } from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertMutationOrigin, authenticate, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

type StripeEnvironment = 'test' | 'production';

const stripeEventAllowlist = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.closed',
]);

function unavailable(requestId: string) {
  return {
    error: {
      code: 'integration_unavailable',
      message: 'Stripe is disabled or its founder gate is closed',
      requestId,
    },
  };
}

function operationId(header: string | readonly string[] | undefined): string {
  if (typeof header !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$/u.test(header)) {
    throw new DomainError('invalid_input', 'One valid Idempotency-Key header is required');
  }
  return header;
}

function trustedCustomerOrigin(request: FastifyRequest): URL {
  const origin = request.headers.origin;
  if (origin === undefined || Array.isArray(origin)) {
    throw new DomainError('not_authorized', 'A trusted customer origin is required');
  }
  return new URL(origin);
}

function safeProviderFailure(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  return new DomainError('conflict', 'Stripe could not complete the request');
}

async function queueReconciliation(
  context: ApiContext,
  input: {
    readonly inboxId: string;
    readonly externalSubscriptionId?: string;
    readonly eventType: string;
    readonly providerObjectId: string;
    readonly providerEventCreatedAt: Date;
    readonly environment: StripeEnvironment;
    readonly evidenceTier: 'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
    readonly transportKind: 'injected_fixture' | 'stripe_https';
    readonly runtimeRunId: string;
    readonly binding?: {
      readonly householdId: string;
      readonly subscriptionId: string;
      readonly planVersionId: string;
    };
  },
): Promise<void> {
  const now = context.now();
  const reconciliationRunId = await context.repositories.commerce.ensureProviderEventReconciliation(
    {
      inboxId: input.inboxId,
      provider: 'stripe',
      environment: input.environment,
      now,
    },
  );
  await context.repositories.jobs.enqueue({
    type: 'commerce.reconcile',
    version: 1,
    payload: {
      inboxId: input.inboxId,
      reconciliationRunId,
      eventType: input.eventType,
      providerObjectId: input.providerObjectId,
      providerEventCreatedAt: input.providerEventCreatedAt.toISOString(),
      environment: input.environment,
      evidenceTier: input.evidenceTier,
      transportKind: input.transportKind,
      runtimeRunId: input.runtimeRunId,
      repairGeneration: 0,
      ...(input.externalSubscriptionId === undefined
        ? {}
        : { externalSubscriptionId: input.externalSubscriptionId }),
      ...(input.binding === undefined
        ? {}
        : {
            householdId: input.binding.householdId,
            subscriptionId: input.binding.subscriptionId,
            planVersionId: input.binding.planVersionId,
          }),
    },
    idempotencyKey: `stripe-reconcile:${input.environment}:${input.inboxId}`,
    ...(input.binding === undefined ? {} : { householdId: input.binding.householdId }),
    scheduledAt: now,
    maxAttempts: 8,
    correlationId: `stripe-reconcile:${input.environment}:${input.inboxId}`,
  });
}

async function recordCommerceAttention(
  context: ApiContext,
  input: { readonly inboxId: string; readonly reason: string },
): Promise<void> {
  await context.repositories.businessOs.upsertOwnerAttention({
    attentionKind: 'billing_reconciliation',
    consequenceOfInaction: 'Canonical access remains unchanged until billing evidence is resolved.',
    dedupeKey: `billing_reconciliation_${input.inboxId}`,
    now: context.now(),
    recommendedAction: 'Review the verified provider event and reconcile provider truth.',
    sourceId: input.inboxId,
    sourceType: 'commerce_event',
    whyFounderRequired: input.reason,
  });
}

export function registerCommerceRoutes(
  app: FastifyInstance,
  context: ApiContext,
  transport?: StripeTransport,
  evidenceLevel:
    'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production' = 'stripe_test',
): void {
  const stripe = context.config.commerce.stripe;
  // Live configuration is an offline manifest only until managed identity/KMS custody exists.
  // Even an injected transport cannot make live routes or reads reachable in this candidate.
  const runtimeStripe = stripe.mode === 'test' ? stripe : undefined;
  const runtimeRunId = `api-${randomUUID()}`;
  const transportKind = evidenceLevel === 'local_fixture' ? 'injected_fixture' : 'stripe_https';
  const authenticityKind =
    evidenceLevel === 'local_fixture' ? 'fixture_assertion' : 'provider_read';
  const authorization: CommerceAuthorizationPort = {
    authorize: async ({ actor, planVersionId }) =>
      context.repositories.commerceRuntime.authorizeActor({
        actor,
        ...(planVersionId === undefined ? {} : { planVersionId }),
        now: context.now(),
      }),
  };
  const adapter =
    runtimeStripe !== undefined && transport !== undefined
      ? new StripeAdapter(
          transport,
          authorization,
          new Set(context.config.identity.customerOrigins),
          {
            environment: runtimeStripe.environment,
            accountId: runtimeStripe.accountId,
            apiVersion: runtimeStripe.apiVersion,
            portalConfigurationId: runtimeStripe.cancelOnlyPortalConfigurationId,
            offer: runtimeStripe.offer,
          },
        )
      : undefined;

  app.post('/v1/hq/commerce/stripe/initiation-control', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    assertMutationOrigin(request, context.config, auth);
    const body = stripeInitiationControlRequestSchema.parse(request.body);
    const changed = await context.repositories.commerceRuntime.changeStripeInitiationControl({
      ...body,
      actorPersonId: auth.principal.personId,
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
      now: context.now(),
    });
    return stripeControlResponseSchema.parse({
      environment: body.environment,
      state: changed.state,
      revision: changed.revision,
      recordedAt: context.now().toISOString(),
    });
  });

  app.get('/v1/hq/commerce/stripe/initiation-control', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    const query = stripeInitiationControlQuerySchema.parse(request.query);
    const projection = await context.repositories.commerceRuntime.stripeInitiationControlProjection(
      {
        environment: query.environment,
        actorPersonId: auth.principal.personId,
        ...(context.config.identity.founderPersonId === undefined
          ? {}
          : { configuredFounderPersonId: context.config.identity.founderPersonId }),
      },
    );
    return stripeInitiationControlProjectionSchema.parse({
      ...projection,
      ...(projection.changedAt === undefined
        ? {}
        : { changedAt: projection.changedAt.toISOString() }),
    });
  });

  app.post('/v1/hq/commerce/stripe/eligible-household', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    assertMutationOrigin(request, context.config, auth);
    const body = stripeHouseholdEligibilityRequestSchema.parse(request.body);
    const state = await context.repositories.commerceRuntime.changeStripeHouseholdEligibility({
      ...body,
      actorPersonId: auth.principal.personId,
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
      now: context.now(),
    });
    return stripeControlResponseSchema.parse({
      householdId: body.householdId,
      state,
      recordedAt: context.now().toISOString(),
    });
  });

  app.get('/v1/hq/commerce/stripe/reconciliation-repair', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    const query = stripeReconciliationRepairQuerySchema.parse(request.query);
    const projection = await context.repositories.commerce.stripeReconciliationRepairProjection({
      reconciliationRunId: query.reconciliationRunId,
      actorPersonId: auth.principal.personId,
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
    });
    return stripeReconciliationRepairProjectionSchema.parse(projection);
  });

  app.post('/v1/hq/commerce/stripe/reconciliation-repair', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    assertMutationOrigin(request, context.config, auth);
    const body = stripeReconciliationRepairRequestSchema.parse(request.body);
    const repaired = await context.repositories.commerce.requestStripeReconciliationRepair({
      ...body,
      actorPersonId: auth.principal.personId,
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
      now: context.now(),
    });
    return stripeReconciliationRepairResponseSchema.parse({
      ...repaired,
      recordedAt: context.now().toISOString(),
    });
  });

  app.get('/v1/hq/commerce/stripe/session-retry-repair', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    const query = stripeSessionRetryRepairQuerySchema.parse(request.query);
    const projection =
      await context.repositories.commerceRuntime.stripeSessionRetryRepairProjection({
        ...query,
        actorPersonId: auth.principal.personId,
        ...(context.config.identity.founderPersonId === undefined
          ? {}
          : { configuredFounderPersonId: context.config.identity.founderPersonId }),
        now: context.now(),
      });
    return stripeSessionRetryRepairProjectionSchema.parse({
      ...projection,
      providerDeadline: projection.providerDeadline.toISOString(),
    });
  });

  app.post('/v1/hq/commerce/stripe/session-retry-repair', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    assertMutationOrigin(request, context.config, auth);
    const body = stripeSessionRetryRepairRequestSchema.parse(request.body);
    const repaired = await context.repositories.commerceRuntime.requestStripeSessionRetryRepair({
      ...body,
      actorPersonId: auth.principal.personId,
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
      runtimeInitiationPermitted: runtimeStripe?.runtimeInitiationPermitted === true,
      now: context.now(),
    });
    return stripeSessionRetryRepairResponseSchema.parse({
      ...repaired,
      recordedAt: context.now().toISOString(),
    });
  });

  app.get('/v1/commerce/stripe/billing', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer'],
      now,
    );
    const household = selectedHousehold(auth, request);
    const actor = await context.repositories.commerceRuntime.resolveActor({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now,
    });
    const environment = stripe.mode === 'disabled' ? 'test' : stripe.environment;
    const billing = await context.repositories.commerceRuntime.stripeBillingStatus({
      actor,
      environment,
      runtimeInitiationPermitted: runtimeStripe?.runtimeInitiationPermitted === true,
      now,
    });
    return stripeBillingStatusResponseSchema.parse({
      billing: {
        householdId: household.householdId,
        offerId: 'founding_family_monthly_v1',
        ...billing,
        ...(billing.pendingOperation === undefined
          ? {}
          : {
              pendingOperation: {
                serverOperationId: billing.pendingOperation.serverOperationId,
                state: billing.pendingOperation.state,
                attemptCount: billing.pendingOperation.attemptCount,
                ...(billing.pendingOperation.nextRetryAt === undefined
                  ? {}
                  : { nextRetryAt: billing.pendingOperation.nextRetryAt.toISOString() }),
                ...(billing.pendingOperation.expiresAt === undefined
                  ? {}
                  : { expiresAt: billing.pendingOperation.expiresAt.toISOString() }),
              },
            }),
      },
      evidenceNotice:
        'Success redirects and provider status snapshots do not grant BoomerBuddy access.',
    });
  });

  app.post('/v1/commerce/stripe/checkout', async (request, reply) => {
    if (runtimeStripe === undefined || adapter === undefined) {
      return reply.code(503).send(unavailable(request.id));
    }
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const household = selectedHousehold(auth, request);
    stripeCheckoutRequestSchema.parse(request.body);
    const serverOperationId = operationId(request.headers['idempotency-key']);
    await context.repositories.commerceRuntime.assertStripeInitiationAllowed({
      householdId: household.householdId,
      environment: runtimeStripe.environment,
      runtimeInitiationPermitted: runtimeStripe.runtimeInitiationPermitted,
    });
    const actor = await context.repositories.commerceRuntime.resolveActor({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now,
    });
    const preflight = await adapter.verifyConfiguredResources();
    await context.repositories.commerceRuntime.recordStripePreflight({
      evidence: preflight,
      evidenceLevel,
      transportKind,
      runtimeRunId,
      authenticityKind,
      now: context.now(),
    });
    const providerIdempotencyKey = deriveStripeProviderIdempotencyKey({
      environment: runtimeStripe.environment,
      action: 'checkout',
      householdId: household.householdId,
      serverOperationId,
      key: context.config.secrets.fingerprintKey,
    });
    const customerReference = await context.repositories.commerceRuntime.resolveStripeCustomer({
      actor,
      environment: runtimeStripe.environment,
    });
    const prepared = await context.repositories.commerceRuntime.prepareStripeCheckout({
      actor,
      offerId: runtimeStripe.offer.offerId,
      planVersionId: runtimeStripe.offer.planVersionId,
      billingInterval: runtimeStripe.offer.billingInterval,
      providerPriceId: runtimeStripe.offer.providerPriceId,
      idempotencyKey: serverOperationId,
      serverOperationId,
      providerIdempotencyKey,
      environment: runtimeStripe.environment,
      now,
    });
    const origin = trustedCustomerOrigin(request);
    const successUrl = new URL('/member/billing/success', origin).toString();
    const cancelUrl = new URL('/member/billing', origin).toString();
    const dispatch = await context.repositories.commerceRuntime.beginStripeSessionOperation({
      householdId: household.householdId,
      checkoutIntentId: prepared.intentId,
      action: 'checkout',
      environment: runtimeStripe.environment,
      serverOperationId,
      providerIdempotencyKey,
      actorPersonId: actor.personId,
      requestedExpiresAt: prepared.providerExpiresAt,
      canonicalSubscriptionId: prepared.subscriptionId,
      providerPriceId: runtimeStripe.offer.providerPriceId,
      ...(customerReference === null ? {} : { providerCustomerId: customerReference }),
      successUrl,
      cancelUrl,
      now: context.now(),
    });
    if (!dispatch.shouldDispatch) {
      if (
        dispatch.state === 'succeeded' &&
        dispatch.providerSessionId !== undefined &&
        dispatch.providerSessionUrl !== undefined &&
        dispatch.returnedExpiresAt !== undefined
      ) {
        return reply.code(200).send(
          stripeCheckoutResponseSchema.parse({
            checkout: {
              provider: 'stripe',
              environment: runtimeStripe.environment,
              sessionId: dispatch.providerSessionId,
              url: dispatch.providerSessionUrl,
              canonicalSubscriptionId: prepared.subscriptionId,
              expiresAt: dispatch.returnedExpiresAt.toISOString(),
            },
            limitation:
              'A Checkout redirect is not access. Access remains pending exact completed-session and paid-invoice evidence.',
          }),
        );
      }
      throw new DomainError(
        'conflict',
        'This Checkout operation is pending same-key provider reconciliation',
      );
    }
    try {
      const session = await adapter.createCheckout({
        actor,
        canonicalSubscriptionId: prepared.subscriptionId,
        planVersionId: prepared.planVersionId,
        providerPriceId: runtimeStripe.offer.providerPriceId,
        ...(customerReference === null ? {} : { customerReference }),
        successUrl,
        cancelUrl,
        idempotencyKey: providerIdempotencyKey,
        providerExpiresAt: prepared.providerExpiresAt,
      });
      if (session.expiresAt === undefined) {
        throw new StripeWebhookError('stripe.checkout_expiry_missing');
      }
      await context.repositories.commerceRuntime.recordStripeCheckoutSession({
        householdId: household.householdId,
        intentId: prepared.intentId,
        providerSessionId: session.id,
        providerSessionUrl: session.url,
        environment: runtimeStripe.environment,
        serverOperationId,
        providerIdempotencyKey,
        requestedExpiresAt: prepared.providerExpiresAt,
        returnedExpiresAt: session.expiresAt,
        now: context.now(),
      });
      return reply.code(201).send(
        stripeCheckoutResponseSchema.parse({
          checkout: {
            provider: session.provider,
            environment: session.environment,
            sessionId: session.id,
            url: session.url,
            canonicalSubscriptionId: prepared.subscriptionId,
            expiresAt: session.expiresAt.toISOString(),
          },
          limitation:
            'A Checkout redirect is not access. Access remains pending exact completed-session and paid-invoice evidence.',
        }),
      );
    } catch (error) {
      const errorCode =
        error instanceof StripeWebhookError ? error.code : 'stripe.unknown_transport';
      if (error instanceof StripeSessionDispatchError && !error.dispatchAttempted) {
        await context.repositories.commerceRuntime.markStripeSessionFailedNoEffect({
          householdId: household.householdId,
          checkoutIntentId: prepared.intentId,
          action: 'checkout',
          environment: runtimeStripe.environment,
          serverOperationId,
          errorCode,
          now: context.now(),
        });
      } else {
        await context.repositories.commerceRuntime.markStripeSessionOutcomeUnknown({
          householdId: household.householdId,
          checkoutIntentId: prepared.intentId,
          action: 'checkout',
          environment: runtimeStripe.environment,
          serverOperationId,
          errorCode,
          now: context.now(),
        });
      }
      throw safeProviderFailure(error);
    }
  });

  app.post('/v1/commerce/stripe/portal', async (request, reply) => {
    if (runtimeStripe === undefined || adapter === undefined) {
      return reply.code(503).send(unavailable(request.id));
    }
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const household = selectedHousehold(auth, request);
    const serverOperationId = operationId(request.headers['idempotency-key']);
    const actor = await context.repositories.commerceRuntime.resolveActor({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now,
    });
    const customerId = await context.repositories.commerceRuntime.resolveStripeCustomer({
      actor,
      environment: runtimeStripe.environment,
    });
    if (customerId === null) {
      throw new DomainError('not_found', 'No verified Stripe customer is available');
    }
    const preflight = await adapter.verifyConfiguredResources();
    await context.repositories.commerceRuntime.recordStripePreflight({
      evidence: preflight,
      evidenceLevel,
      transportKind,
      runtimeRunId,
      authenticityKind,
      now: context.now(),
    });
    const providerIdempotencyKey = deriveStripeProviderIdempotencyKey({
      environment: runtimeStripe.environment,
      action: 'portal',
      householdId: household.householdId,
      serverOperationId,
      key: context.config.secrets.fingerprintKey,
    });
    const origin = trustedCustomerOrigin(request);
    const returnUrl = new URL('/member/billing', origin).toString();
    const dispatch = await context.repositories.commerceRuntime.beginStripeSessionOperation({
      householdId: household.householdId,
      action: 'portal',
      environment: runtimeStripe.environment,
      serverOperationId,
      providerIdempotencyKey,
      actorPersonId: actor.personId,
      providerCustomerId: customerId,
      providerConfigurationId: runtimeStripe.cancelOnlyPortalConfigurationId,
      returnUrl,
      now: context.now(),
    });
    if (!dispatch.shouldDispatch) {
      if (
        dispatch.state === 'succeeded' &&
        dispatch.providerSessionId !== undefined &&
        dispatch.providerSessionUrl !== undefined
      ) {
        return stripePortalResponseSchema.parse({
          portal: {
            provider: 'stripe',
            environment: runtimeStripe.environment,
            sessionId: dispatch.providerSessionId,
            url: dispatch.providerSessionUrl,
            ...(dispatch.returnedExpiresAt === undefined
              ? {}
              : { expiresAt: dispatch.returnedExpiresAt.toISOString() }),
          },
          limitation:
            'The portal changes provider state only; canonical access reconciles separately.',
        });
      }
      throw new DomainError(
        'conflict',
        'This Portal operation is pending same-key provider reconciliation',
      );
    }
    try {
      const session = await adapter.createPortal({
        actor,
        providerCustomerId: customerId,
        providerConfigurationId: runtimeStripe.cancelOnlyPortalConfigurationId,
        returnUrl,
        idempotencyKey: providerIdempotencyKey,
      });
      await context.repositories.commerceRuntime.recordStripePortalSession({
        householdId: household.householdId,
        environment: runtimeStripe.environment,
        serverOperationId,
        providerIdempotencyKey,
        providerSessionId: session.id,
        providerSessionUrl: session.url,
        now: context.now(),
      });
      return stripePortalResponseSchema.parse({
        portal: {
          provider: session.provider,
          environment: session.environment,
          sessionId: session.id,
          url: session.url,
          ...(session.expiresAt === undefined
            ? {}
            : { expiresAt: session.expiresAt.toISOString() }),
        },
        limitation:
          'The portal changes provider state only; canonical access reconciles separately.',
      });
    } catch (error) {
      const errorCode =
        error instanceof StripeWebhookError ? error.code : 'stripe.unknown_transport';
      if (error instanceof StripeSessionDispatchError && !error.dispatchAttempted) {
        await context.repositories.commerceRuntime.markStripeSessionFailedNoEffect({
          householdId: household.householdId,
          action: 'portal',
          environment: runtimeStripe.environment,
          serverOperationId,
          errorCode,
          now: context.now(),
        });
      } else {
        await context.repositories.commerceRuntime.markStripeSessionOutcomeUnknown({
          householdId: household.householdId,
          action: 'portal',
          environment: runtimeStripe.environment,
          serverOperationId,
          errorCode,
          now: context.now(),
        });
      }
      throw safeProviderFailure(error);
    }
  });

  void app.register(async (webhookScope) => {
    if (runtimeStripe === undefined) {
      webhookScope.post('/v1/webhooks/stripe', (request, reply) =>
        reply.code(503).send(unavailable(request.id)),
      );
      return;
    }
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );
    webhookScope.post('/v1/webhooks/stripe', { bodyLimit: 256 * 1_024 }, async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) {
        throw new DomainError('invalid_input', 'Stripe webhook verification failed');
      }
      let normalized;
      let signatureVerifiedAt: Date;
      try {
        const verified = verifyStripeWebhook({
          rawBody: request.body,
          signatureHeader: signature,
          endpointSecret: runtimeStripe.webhookSecret,
          environment: runtimeStripe.environment,
          expectedAccountId: runtimeStripe.accountId,
          now: context.now(),
          supportedApiVersions: new Set([runtimeStripe.apiVersion]),
        });
        signatureVerifiedAt = verified.signedAt;
        normalized = normalizeStripeEvent(verified);
      } catch (error) {
        if (error instanceof StripeWebhookError) {
          throw new DomainError('invalid_input', 'Stripe webhook verification failed');
        }
        throw error;
      }
      const captured = await context.repositories.commerce.captureVerifiedProviderEvent({
        provider: normalized.provider,
        environment: runtimeStripe.environment,
        externalEventId: normalized.externalEventId,
        eventType: normalized.eventType,
        rawPayload: request.body,
        providerApiVersion: normalized.providerApiVersion,
        providerObjectId: normalized.providerObjectId,
        providerEventCreatedAt: normalized.eventCreatedAt,
        ...(normalized.lifecycle === undefined
          ? {}
          : { normalizedLifecycle: normalized.lifecycle }),
        evidenceTier: evidenceLevel,
        transportKind,
        transportLivemode: false,
        runtimeRunId,
        signatureVerifiedAt,
        now: context.now(),
      });
      if (!stripeEventAllowlist.has(normalized.eventType)) {
        await context.repositories.commerce.quarantineProviderEvent({
          inboxId: captured.id,
          errorCode: 'stripe.event_not_allowlisted',
          now: context.now(),
        });
        return reply.code(202).send({
          received: true,
          duplicate: captured.duplicate,
          application: 'quarantined',
        });
      }
      if (normalized.eventType === 'checkout.session.completed') {
        if (
          normalized.checkoutCompletion === undefined ||
          normalized.externalSubscriptionId === undefined ||
          normalized.providerCustomerId === undefined ||
          normalized.canonicalBinding === undefined
        ) {
          await context.repositories.commerce.quarantineProviderEvent({
            inboxId: captured.id,
            errorCode: 'stripe.checkout_completion_evidence_invalid',
            now: context.now(),
          });
          return reply.code(202).send({
            received: true,
            duplicate: captured.duplicate,
            application: 'quarantined',
          });
        }
        await context.repositories.commerceRuntime.recordStripeCheckoutCompletion({
          inboxId: captured.id,
          externalEventId: normalized.externalEventId,
          environment: runtimeStripe.environment,
          providerSessionId: normalized.providerObjectId,
          providerSubscriptionId: normalized.externalSubscriptionId,
          providerCustomerId: normalized.providerCustomerId,
          ...(normalized.providerPaymentIntentId === undefined
            ? {}
            : { providerPaymentIntentId: normalized.providerPaymentIntentId }),
          canonicalBinding: normalized.canonicalBinding,
          amountTotal: normalized.checkoutCompletion.amountTotal,
          currency: normalized.checkoutCompletion.currency,
          providerExpiresAt: normalized.checkoutCompletion.providerExpiresAt,
          providerEventCreatedAt: normalized.eventCreatedAt,
          now: context.now(),
        });
        await context.repositories.commerce.completeProviderOperationalEvent({
          inboxId: captured.id,
          now: context.now(),
        });
        return stripeWebhookResponseSchema.parse({
          received: true,
          duplicate: captured.duplicate,
          application: 'applied',
        });
      }
      if (normalized.eventType === 'checkout.session.expired') {
        if (
          normalized.checkoutExpiration === undefined ||
          normalized.canonicalBinding === undefined
        ) {
          await context.repositories.commerce.quarantineProviderEvent({
            inboxId: captured.id,
            errorCode: 'stripe.checkout_expiration_evidence_invalid',
            now: context.now(),
          });
          return reply.code(202).send({
            received: true,
            duplicate: captured.duplicate,
            application: 'quarantined',
          });
        }
        const expired = await context.repositories.commerceRuntime.expireStripeCheckoutSession({
          providerSessionId: normalized.providerObjectId,
          environment: runtimeStripe.environment,
          canonicalBinding: normalized.canonicalBinding,
          providerExpiresAt: normalized.checkoutExpiration.providerExpiresAt,
          providerEventCreatedAt: normalized.eventCreatedAt,
          now: context.now(),
        });
        if (!expired) {
          await context.repositories.commerce.quarantineProviderEvent({
            inboxId: captured.id,
            errorCode: 'stripe.checkout_session_binding_missing',
            now: context.now(),
          });
          return reply.code(202).send({
            received: true,
            duplicate: captured.duplicate,
            application: 'quarantined',
          });
        }
        await context.repositories.commerce.completeProviderOperationalEvent({
          inboxId: captured.id,
          now: context.now(),
        });
        return stripeWebhookResponseSchema.parse({
          received: true,
          duplicate: captured.duplicate,
          application: 'applied',
        });
      }
      if (
        normalized.externalSubscriptionId === undefined ||
        normalized.requiresReconciliation ||
        normalized.eventType.startsWith('invoice.') ||
        normalized.eventType.startsWith('refund.') ||
        normalized.eventType.startsWith('charge.')
      ) {
        if (
          captured.evidenceTier === undefined ||
          captured.transportKind === undefined ||
          captured.runtimeRunId === undefined
        ) {
          throw new DomainError('conflict', 'Persisted Stripe event provenance is incomplete');
        }
        await queueReconciliation(context, {
          inboxId: captured.id,
          ...(normalized.externalSubscriptionId === undefined
            ? {}
            : { externalSubscriptionId: normalized.externalSubscriptionId }),
          eventType: normalized.eventType,
          providerObjectId: normalized.providerObjectId,
          providerEventCreatedAt: normalized.eventCreatedAt,
          environment: runtimeStripe.environment,
          evidenceTier: captured.evidenceTier,
          transportKind: captured.transportKind,
          runtimeRunId: captured.runtimeRunId,
        });
        return reply.code(202).send(
          stripeWebhookResponseSchema.parse({
            received: true,
            duplicate: captured.duplicate,
            application: 'reconciliation_queued',
          }),
        );
      }
      const binding = await context.repositories.commerceRuntime.resolveStripeEventBinding({
        environment: runtimeStripe.environment,
        externalSubscriptionId: normalized.externalSubscriptionId,
        providerEventCreatedAt: normalized.eventCreatedAt,
        ...(normalized.canonicalBinding === undefined
          ? {}
          : { canonicalBinding: normalized.canonicalBinding }),
      });
      if (binding === null) {
        await context.repositories.commerce.quarantineProviderEvent({
          inboxId: captured.id,
          errorCode: 'stripe.canonical_binding_missing',
          now: context.now(),
        });
        await recordCommerceAttention(context, {
          inboxId: captured.id,
          reason: 'The signed event was not bound to a completed server-created Checkout Session.',
        });
        return reply.code(202).send(
          stripeWebhookResponseSchema.parse({
            received: true,
            duplicate: captured.duplicate,
            application: 'quarantined',
          }),
        );
      }
      if (
        captured.evidenceTier === undefined ||
        captured.transportKind === undefined ||
        captured.runtimeRunId === undefined
      ) {
        throw new DomainError('conflict', 'Persisted Stripe event provenance is incomplete');
      }
      const evidenceMatches =
        normalized.lifecycle !== undefined &&
        normalized.providerPriceId === binding.providerPriceId &&
        normalized.providerProductId === runtimeStripe.offer.providerProductId &&
        normalized.subscriptionOfferExact === true &&
        normalized.billingInterval === binding.billingInterval &&
        normalized.currentPeriodStartsAt !== undefined &&
        normalized.currentPeriodEndsAt !== undefined &&
        normalized.currentPeriodEndsAt > normalized.currentPeriodStartsAt;
      if (!evidenceMatches) {
        await queueReconciliation(context, {
          inboxId: captured.id,
          externalSubscriptionId: normalized.externalSubscriptionId,
          eventType: normalized.eventType,
          providerObjectId: normalized.providerObjectId,
          providerEventCreatedAt: normalized.eventCreatedAt,
          environment: runtimeStripe.environment,
          evidenceTier: captured.evidenceTier,
          transportKind: captured.transportKind,
          runtimeRunId: captured.runtimeRunId,
          binding,
        });
        return reply.code(202).send(
          stripeWebhookResponseSchema.parse({
            received: true,
            duplicate: captured.duplicate,
            application: 'reconciliation_queued',
          }),
        );
      }
      const applied = await context.repositories.commerce.applyProviderLifecycle({
        inboxId: captured.id,
        provider: normalized.provider,
        environment: runtimeStripe.environment,
        externalEventId: normalized.externalEventId,
        providerApiVersion: normalized.providerApiVersion,
        providerObjectId: normalized.providerObjectId,
        providerEventCreatedAt: normalized.eventCreatedAt,
        householdId: binding.householdId,
        subscriptionId: binding.subscriptionId,
        externalSubscriptionId: normalized.externalSubscriptionId,
        ...(normalized.providerCustomerId === undefined
          ? {}
          : { providerCustomerId: normalized.providerCustomerId }),
        lifecycle: normalized.lifecycle as NonNullable<typeof normalized.lifecycle>,
        currentPeriodStartsAt: normalized.currentPeriodStartsAt as Date,
        currentPeriodEndsAt: normalized.currentPeriodEndsAt as Date,
        accessEvidence: { kind: 'non_payment' },
        now: context.now(),
      });
      if (applied.outcome === 'quarantined') {
        await queueReconciliation(context, {
          inboxId: captured.id,
          externalSubscriptionId: normalized.externalSubscriptionId,
          eventType: normalized.eventType,
          providerObjectId: normalized.providerObjectId,
          providerEventCreatedAt: normalized.eventCreatedAt,
          environment: runtimeStripe.environment,
          evidenceTier: captured.evidenceTier,
          transportKind: captured.transportKind,
          runtimeRunId: captured.runtimeRunId,
          binding,
        });
        return reply.code(202).send({
          received: true,
          duplicate: captured.duplicate,
          application: 'reconciliation_queued',
        });
      }
      return stripeWebhookResponseSchema.parse({
        received: true,
        duplicate: captured.duplicate,
        application: applied.outcome,
      });
    });
  });
}
