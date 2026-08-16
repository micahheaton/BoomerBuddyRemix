import {
  stripeCheckoutRequestSchema,
  stripeCheckoutResponseSchema,
  stripePortalResponseSchema,
  stripeWebhookResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import {
  normalizeStripeEvent,
  StripeTestAdapter,
  StripeWebhookError,
  verifyStripeWebhook,
  type CommerceAuthorizationPort,
  type StripeTransport,
} from '@boomerbuddy/integrations';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertMutationOrigin, authenticate, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

function unavailable(requestId: string) {
  return {
    error: {
      code: 'integration_unavailable',
      message: 'Stripe test mode is not configured',
      requestId,
    },
  };
}

function idempotencyKey(header: string | readonly string[] | undefined): string {
  if (typeof header !== 'string') {
    throw new DomainError('invalid_input', 'One Idempotency-Key header is required');
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
  if (error instanceof StripeWebhookError) {
    return new DomainError('conflict', 'Stripe test mode could not complete the request');
  }
  throw error;
}

async function queueReconciliation(
  context: ApiContext,
  input: {
    readonly inboxId: string;
    readonly externalSubscriptionId?: string;
    readonly eventType: string;
    readonly providerObjectId: string;
    readonly providerEventCreatedAt: Date;
    readonly provider: 'stripe';
    readonly environment: 'test';
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
      provider: input.provider,
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
    idempotencyKey: `stripe-reconcile:${input.inboxId}`,
    ...(input.binding === undefined ? {} : { householdId: input.binding.householdId }),
    scheduledAt: now,
    maxAttempts: 8,
    correlationId: `stripe-reconcile:${input.inboxId}`,
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
    recommendedAction: 'Review the verified provider event and reconcile it with Stripe test data.',
    sourceId: input.inboxId,
    sourceType: 'commerce_event',
    whyFounderRequired: input.reason,
  });
}

export function registerCommerceRoutes(
  app: FastifyInstance,
  context: ApiContext,
  transport?: StripeTransport,
): void {
  const stripe = context.config.commerce.stripe;
  const authorization: CommerceAuthorizationPort = {
    authorize: async ({ actor, planVersionId }) =>
      context.repositories.commerceRuntime.authorizeActor({
        actor,
        ...(planVersionId === undefined ? {} : { planVersionId }),
        now: context.now(),
      }),
  };
  const adapter =
    stripe.mode === 'test' && transport !== undefined
      ? new StripeTestAdapter(
          transport,
          authorization,
          new Set(context.config.identity.customerOrigins),
          stripe.apiVersion,
        )
      : undefined;

  app.post('/v1/commerce/stripe/checkout', async (request, reply) => {
    if (stripe.mode !== 'test' || adapter === undefined) {
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
    const body = stripeCheckoutRequestSchema.parse(request.body);
    const requestKey = idempotencyKey(request.headers['idempotency-key']);
    const actor = await context.repositories.commerceRuntime.resolveActor({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now,
    });
    const customerReference = await context.repositories.commerceRuntime.resolveStripeCustomer({
      actor,
    });
    const priceKey = `${body.planVersionId}:${body.billingInterval}` as keyof typeof stripe.prices;
    const prepared = await context.repositories.commerceRuntime.prepareStripeCheckout({
      actor,
      planVersionId: body.planVersionId,
      billingInterval: body.billingInterval,
      providerPriceId: stripe.prices[priceKey],
      idempotencyKey: requestKey,
      now,
    });
    const origin = trustedCustomerOrigin(request);
    try {
      const session = await adapter.createCheckout({
        actor,
        canonicalSubscriptionId: prepared.subscriptionId,
        planVersionId: prepared.planVersionId,
        providerPriceId: stripe.prices[priceKey],
        ...(customerReference === null ? {} : { customerReference }),
        successUrl: new URL('/member/billing/success', origin).toString(),
        cancelUrl: new URL('/member/billing', origin).toString(),
        idempotencyKey: requestKey,
        expiresAt: prepared.expiresAt,
      });
      await context.repositories.commerceRuntime.recordStripeCheckoutSession({
        householdId: household.householdId,
        intentId: prepared.intentId,
        providerSessionId: session.id,
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
            ...(session.expiresAt === undefined
              ? {}
              : { expiresAt: session.expiresAt.toISOString() }),
          },
          limitation: 'Stripe test mode only; no real charge occurred.',
        }),
      );
    } catch (error) {
      throw safeProviderFailure(error);
    }
  });

  app.post('/v1/commerce/stripe/portal', async (request, reply) => {
    if (stripe.mode !== 'test' || adapter === undefined) {
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
    const actor = await context.repositories.commerceRuntime.resolveActor({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now,
    });
    const customerId = await context.repositories.commerceRuntime.resolveStripeCustomer({ actor });
    if (customerId === null) {
      throw new DomainError('not_found', 'No Stripe test customer is available for this household');
    }
    const origin = trustedCustomerOrigin(request);
    try {
      const session = await adapter.createPortal({
        actor,
        providerCustomerId: customerId,
        providerConfigurationId: stripe.cancelOnlyPortalConfigurationId,
        returnUrl: new URL('/member/billing', origin).toString(),
        idempotencyKey: idempotencyKey(request.headers['idempotency-key']),
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
        limitation: 'Stripe test mode only; no production billing is enabled.',
      });
    } catch (error) {
      throw safeProviderFailure(error);
    }
  });

  void app.register(async (webhookScope) => {
    if (stripe.mode !== 'test') {
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
      try {
        normalized = normalizeStripeEvent(
          verifyStripeWebhook({
            rawBody: request.body,
            signatureHeader: signature,
            endpointSecret: stripe.webhookSecret,
            environment: 'test',
            now: context.now(),
            supportedApiVersions: new Set([stripe.apiVersion]),
          }),
        );
      } catch (error) {
        if (error instanceof StripeWebhookError) {
          throw new DomainError('invalid_input', 'Stripe webhook verification failed');
        }
        throw error;
      }
      const captured = await context.repositories.commerce.captureVerifiedProviderEvent({
        provider: normalized.provider,
        environment: normalized.environment,
        externalEventId: normalized.externalEventId,
        eventType: normalized.eventType,
        rawPayload: request.body,
        providerApiVersion: normalized.providerApiVersion,
        providerObjectId: normalized.providerObjectId,
        providerEventCreatedAt: normalized.eventCreatedAt,
        ...(normalized.lifecycle === undefined
          ? {}
          : { normalizedLifecycle: normalized.lifecycle }),
        now: context.now(),
      });
      if (normalized.eventType === 'checkout.session.expired') {
        const expired = await context.repositories.commerceRuntime.expireStripeCheckoutSession({
          providerSessionId: normalized.providerObjectId,
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
        return {
          received: true,
          duplicate: captured.duplicate,
          application: 'applied',
        };
      }
      if (normalized.externalSubscriptionId === undefined) {
        await queueReconciliation(context, {
          inboxId: captured.id,
          eventType: normalized.eventType,
          providerObjectId: normalized.providerObjectId,
          providerEventCreatedAt: normalized.eventCreatedAt,
          provider: 'stripe',
          environment: 'test',
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
          reason: 'The signed event could not be bound to a server-created checkout intent.',
        });
        return reply.code(202).send(
          stripeWebhookResponseSchema.parse({
            received: true,
            duplicate: captured.duplicate,
            application: 'quarantined',
          }),
        );
      }
      const evidenceMatches =
        normalized.lifecycle !== undefined &&
        normalized.providerPriceId === binding.providerPriceId &&
        normalized.billingInterval === binding.billingInterval &&
        normalized.currentPeriodStartsAt !== undefined &&
        normalized.currentPeriodEndsAt !== undefined &&
        normalized.currentPeriodEndsAt > normalized.currentPeriodStartsAt;
      if (normalized.requiresReconciliation || !evidenceMatches) {
        await queueReconciliation(context, {
          inboxId: captured.id,
          externalSubscriptionId: normalized.externalSubscriptionId,
          eventType: normalized.eventType,
          providerObjectId: normalized.providerObjectId,
          providerEventCreatedAt: normalized.eventCreatedAt,
          provider: 'stripe',
          environment: 'test',
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
        environment: normalized.environment,
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
        accessEvidence: {
          kind:
            binding.bindingState === 'active_checkout' ? 'initial_server_binding' : 'non_payment',
        },
        now: context.now(),
      });
      if (applied.outcome === 'quarantined') {
        await queueReconciliation(context, {
          inboxId: captured.id,
          externalSubscriptionId: normalized.externalSubscriptionId,
          eventType: normalized.eventType,
          providerObjectId: normalized.providerObjectId,
          providerEventCreatedAt: normalized.eventCreatedAt,
          provider: 'stripe',
          environment: 'test',
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
