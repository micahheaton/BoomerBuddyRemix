import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CommerceActor,
  CommerceAuthorizationPort,
  CommerceCheckoutPort,
  CommercePortalPort,
  CommerceSession,
  NormalizedCommerceLifecycle,
  NormalizedProviderCommerceEvent,
  ProviderPaidPeriodEvidence,
  ProviderReconciliationPort,
} from './commerce';

export interface StripeTransport {
  readonly postForm: (input: {
    readonly path: string;
    readonly form: Readonly<Record<string, string>>;
    readonly idempotencyKey: string;
  }) => Promise<Readonly<Record<string, unknown>>>;
  readonly get: (input: { readonly path: string }) => Promise<Readonly<Record<string, unknown>>>;
}

interface StripeEventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly livemode: boolean;
  readonly api_version: string;
  readonly data: { readonly object: Readonly<Record<string, unknown>> };
}

export interface VerifiedStripeEvent {
  readonly envelope: StripeEventEnvelope;
  readonly rawBody: Uint8Array;
  readonly signedAt: Date;
}

export class StripeWebhookError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StripeWebhookError';
  }
}

function safeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseStripeEnvelope(rawBody: Uint8Array): StripeEventEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
  } catch {
    throw new StripeWebhookError('stripe.invalid_json');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StripeWebhookError('stripe.invalid_envelope');
  }
  const event = value as Readonly<Record<string, unknown>>;
  const data = event.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new StripeWebhookError('stripe.invalid_envelope');
  }
  const object = (data as Readonly<Record<string, unknown>>).object;
  if (object === null || typeof object !== 'object' || Array.isArray(object)) {
    throw new StripeWebhookError('stripe.invalid_envelope');
  }
  if (
    safeText(event.id) === undefined ||
    safeText(event.type) === undefined ||
    safeText(event.api_version) === undefined ||
    typeof event.created !== 'number' ||
    !Number.isSafeInteger(event.created) ||
    typeof event.livemode !== 'boolean'
  ) {
    throw new StripeWebhookError('stripe.invalid_envelope');
  }
  return {
    id: event.id as string,
    type: event.type as string,
    created: event.created,
    livemode: event.livemode,
    api_version: event.api_version as string,
    data: { object: object as Readonly<Record<string, unknown>> },
  };
}

function signatures(header: string): { readonly timestamp: number; readonly values: string[] } {
  let timestamp: number | undefined;
  const values: string[] = [];
  for (const component of header.split(',')) {
    const separator = component.indexOf('=');
    if (separator < 1) continue;
    const key = component.slice(0, separator).trim();
    const value = component.slice(separator + 1).trim();
    if (key === 't' && /^\d+$/u.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[a-f0-9]{64}$/u.test(value)) values.push(value);
  }
  if (timestamp === undefined || !Number.isSafeInteger(timestamp) || values.length === 0) {
    throw new StripeWebhookError('stripe.invalid_signature_header');
  }
  return { timestamp, values };
}

export function verifyStripeWebhook(input: {
  readonly rawBody: string | Uint8Array;
  readonly signatureHeader: string;
  readonly endpointSecret: string;
  readonly environment: 'test';
  readonly now: Date;
  readonly toleranceSeconds?: number;
  readonly supportedApiVersions: ReadonlySet<string>;
}): VerifiedStripeEvent {
  const body =
    typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody;
  if (body.byteLength === 0 || body.byteLength > 256 * 1_024 || input.endpointSecret.length < 16) {
    throw new StripeWebhookError('stripe.invalid_verification_input');
  }
  const parsed = signatures(input.signatureHeader);
  const tolerance = input.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  if (
    !Number.isSafeInteger(tolerance) ||
    tolerance < 1 ||
    tolerance > 900 ||
    Math.abs(nowSeconds - parsed.timestamp) > tolerance
  ) {
    throw new StripeWebhookError('stripe.signature_outside_tolerance');
  }
  const expected = createHmac('sha256', input.endpointSecret)
    .update(String(parsed.timestamp))
    .update('.')
    .update(body)
    .digest();
  const valid = parsed.values.some((candidate) => {
    const received = Buffer.from(candidate, 'hex');
    return received.byteLength === expected.byteLength && timingSafeEqual(received, expected);
  });
  if (!valid) throw new StripeWebhookError('stripe.signature_mismatch');
  const envelope = parseStripeEnvelope(body);
  if (input.environment === 'test' && envelope.livemode) {
    throw new StripeWebhookError('stripe.environment_mismatch');
  }
  if (!input.supportedApiVersions.has(envelope.api_version)) {
    throw new StripeWebhookError('stripe.unsupported_api_version');
  }
  return { envelope, rawBody: body, signedAt: new Date(parsed.timestamp * 1_000) };
}

function subscriptionLifecycle(
  object: Readonly<Record<string, unknown>>,
): NormalizedCommerceLifecycle {
  const status = safeText(object.status);
  const cancelAtPeriodEnd = object.cancel_at_period_end === true;
  if (cancelAtPeriodEnd && ['active', 'trialing'].includes(status ?? '')) {
    return 'cancel_at_period_end';
  }
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'grace';
    case 'unpaid':
      return 'delinquent';
    case 'paused':
      return 'paused';
    case 'canceled':
      return 'canceled';
    case 'incomplete_expired':
      return 'expired';
    case 'incomplete':
      return 'pending';
    default:
      throw new StripeWebhookError('stripe.unsupported_subscription_status');
  }
}

function providerObjectId(object: Readonly<Record<string, unknown>>): string {
  const id = safeText(object.id);
  if (id === undefined) throw new StripeWebhookError('stripe.missing_object_id');
  return id;
}

function subscriptionReference(object: Readonly<Record<string, unknown>>): string | undefined {
  const subscription = object.subscription;
  if (typeof subscription === 'string') return subscription;
  if (subscription !== null && typeof subscription === 'object' && !Array.isArray(subscription)) {
    return safeText((subscription as Readonly<Record<string, unknown>>).id);
  }
  const parent = objectRecord(object.parent);
  const parentSubscription = objectRecord(parent?.subscription_details)?.subscription;
  if (typeof parentSubscription === 'string') return parentSubscription;
  if (
    parentSubscription !== null &&
    typeof parentSubscription === 'object' &&
    !Array.isArray(parentSubscription)
  ) {
    return safeText((parentSubscription as Readonly<Record<string, unknown>>).id);
  }
  const detailsSubscription = objectRecord(object.subscription_details)?.subscription;
  if (typeof detailsSubscription === 'string') return detailsSubscription;
  return object.object === 'subscription' ? safeText(object.id) : undefined;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function integerDate(value: unknown): Date | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? new Date(value * 1_000)
    : undefined;
}

function subscriptionCommerceEvidence(object: Readonly<Record<string, unknown>>): {
  readonly providerPriceId?: string;
  readonly billingInterval?: 'month' | 'year';
  readonly currentPeriodStartsAt?: Date;
  readonly currentPeriodEndsAt?: Date;
} {
  const items = objectRecord(object.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const recurring = data
    .map((item) => objectRecord(item))
    .filter((item): item is Readonly<Record<string, unknown>> => item !== undefined)
    .map((item) => ({ item, price: objectRecord(item.price) }))
    .filter(({ price }) => objectRecord(price?.recurring) !== undefined);
  if (recurring.length !== 1) return {};
  const line = recurring[0];
  if (line === undefined || line.price === undefined) return {};
  const interval = safeText(objectRecord(line.price.recurring)?.interval);
  const startsAt = integerDate(line.item.current_period_start ?? object.current_period_start);
  const endsAt = integerDate(line.item.current_period_end ?? object.current_period_end);
  const providerPriceId = safeText(line.price.id);
  return {
    ...(providerPriceId === undefined ? {} : { providerPriceId }),
    ...(interval === 'month' || interval === 'year' ? { billingInterval: interval } : {}),
    ...(startsAt === undefined ? {} : { currentPeriodStartsAt: startsAt }),
    ...(endsAt === undefined ? {} : { currentPeriodEndsAt: endsAt }),
  };
}

function invoiceLinePriceId(line: Readonly<Record<string, unknown>>): string | undefined {
  const legacyPrice = line.price;
  const pricingDetails = objectRecord(objectRecord(line.pricing)?.price_details);
  const modernPrice = pricingDetails?.price;
  const candidates = [
    safeText(legacyPrice),
    safeText(objectRecord(legacyPrice)?.id),
    safeText(modernPrice),
    safeText(objectRecord(modernPrice)?.id),
  ].filter((value): value is string => value !== undefined);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

function subscriptionCycleLineage(
  line: Readonly<Record<string, unknown>>,
  externalSubscriptionId: string,
): 'legacy' | 'modern' | undefined {
  const parent = objectRecord(line.parent);
  const details = objectRecord(parent?.subscription_item_details);
  const legacyType = safeText(line.type);
  const legacySubscription = safeText(line.subscription);
  const legacySubscriptionItem = safeText(line.subscription_item);
  const modernType = safeText(parent?.type);
  const modernSubscription = safeText(details?.subscription);
  const modernSubscriptionItem = safeText(details?.subscription_item);
  const hasLegacyLineage =
    legacyType !== undefined ||
    legacySubscription !== undefined ||
    legacySubscriptionItem !== undefined;
  const hasModernLineage = modernType !== undefined || details !== undefined;
  if (hasLegacyLineage === hasModernLineage) return undefined;
  if (
    hasLegacyLineage &&
    legacyType === 'subscription' &&
    legacySubscription === externalSubscriptionId &&
    legacySubscriptionItem !== undefined
  ) {
    return 'legacy';
  }
  if (
    hasModernLineage &&
    modernType === 'subscription_item_details' &&
    modernSubscription === externalSubscriptionId &&
    modernSubscriptionItem !== undefined
  ) {
    return 'modern';
  }
  return undefined;
}

function paidInvoicePeriodEvidence(
  invoice: Readonly<Record<string, unknown>>,
  externalSubscriptionId: string,
): ProviderPaidPeriodEvidence | undefined {
  if (
    invoice.paid !== true ||
    invoice.status !== 'paid' ||
    subscriptionReference(invoice) !== externalSubscriptionId
  ) {
    return undefined;
  }
  const lines = objectRecord(invoice.lines);
  if (lines?.has_more !== false) return undefined;
  const candidates: Array<{
    readonly line: Readonly<Record<string, unknown>>;
    readonly lineage: 'legacy' | 'modern';
  }> = [];
  for (const value of Array.isArray(lines.data) ? lines.data : []) {
    const line = objectRecord(value);
    if (line === undefined) continue;
    const lineage = subscriptionCycleLineage(line, externalSubscriptionId);
    if (lineage !== undefined) candidates.push({ line, lineage });
  }
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (candidate === undefined) return undefined;
  const { line, lineage } = candidate;
  const parent = objectRecord(line.parent);
  const details = objectRecord(parent?.subscription_item_details);
  if (
    (lineage === 'legacy' && line.proration !== false) ||
    (lineage === 'modern' && details?.proration !== false)
  ) {
    return undefined;
  }
  const providerPriceId = invoiceLinePriceId(line);
  const period = objectRecord(line.period);
  const currentPeriodStartsAt = integerDate(period?.start);
  const currentPeriodEndsAt = integerDate(period?.end);
  if (
    providerPriceId === undefined ||
    currentPeriodStartsAt === undefined ||
    currentPeriodEndsAt === undefined ||
    currentPeriodEndsAt <= currentPeriodStartsAt
  ) {
    return undefined;
  }
  return {
    externalSubscriptionId,
    providerPriceId,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
  };
}

const stripeGraceMilliseconds = 3 * 24 * 60 * 60_000;

const resolvableInvoiceEventTypes = new Set(['invoice.paid', 'invoice.payment_failed']);

function withBoundedGrace(
  lifecycle: NormalizedCommerceLifecycle,
  evidence: ReturnType<typeof subscriptionCommerceEvidence>,
  observedAt: Date,
): ReturnType<typeof subscriptionCommerceEvidence> {
  if (lifecycle !== 'grace' || evidence.currentPeriodEndsAt === undefined) return evidence;
  return {
    ...evidence,
    currentPeriodEndsAt: new Date(
      Math.min(
        evidence.currentPeriodEndsAt.getTime(),
        observedAt.getTime() + stripeGraceMilliseconds,
      ),
    ),
  };
}

function canonicalBinding(
  object: Readonly<Record<string, unknown>>,
): NormalizedProviderCommerceEvent['canonicalBinding'] {
  const subscriptionDetails = objectRecord(object.subscription_details);
  const expandedSubscription = objectRecord(object.subscription);
  const candidates = [
    objectRecord(object.metadata),
    objectRecord(subscriptionDetails?.metadata),
    objectRecord(expandedSubscription?.metadata),
  ];
  for (const metadata of candidates) {
    if (metadata === undefined) continue;
    const householdId = safeText(metadata.household_id);
    const subscriptionId = safeText(metadata.canonical_subscription_id);
    const planVersionId = safeText(metadata.plan_version_id);
    if (householdId !== undefined && subscriptionId !== undefined && planVersionId !== undefined) {
      return { householdId, subscriptionId, planVersionId };
    }
  }
  return undefined;
}

export function normalizeStripeEvent(
  verified: VerifiedStripeEvent,
): NormalizedProviderCommerceEvent {
  const { envelope } = verified;
  const object = envelope.data.object;
  const base = {
    provider: 'stripe' as const,
    environment: 'test' as const,
    externalEventId: envelope.id,
    eventType: envelope.type,
    providerApiVersion: envelope.api_version,
    providerObjectId: providerObjectId(object),
    eventCreatedAt: new Date(envelope.created * 1_000),
    acknowledgementRequired: false,
  };
  const customer = safeText(object.customer);
  const subscription = subscriptionReference(object);
  const binding = canonicalBinding(object);
  const lifecycle = envelope.type.startsWith('customer.subscription.')
    ? envelope.type === 'customer.subscription.deleted'
      ? 'canceled'
      : subscriptionLifecycle(object)
    : undefined;
  const commerceEvidence = withBoundedGrace(
    lifecycle ?? 'pending',
    subscriptionCommerceEvidence(object),
    new Date(envelope.created * 1_000),
  );
  if (envelope.type.startsWith('customer.subscription.')) {
    return {
      ...base,
      ...(customer === undefined ? {} : { providerCustomerId: customer }),
      ...(subscription === undefined ? {} : { externalSubscriptionId: subscription }),
      ...(binding === undefined ? {} : { canonicalBinding: binding }),
      ...commerceEvidence,
      lifecycle: lifecycle as NormalizedCommerceLifecycle,
      requiresReconciliation:
        commerceEvidence.providerPriceId === undefined ||
        commerceEvidence.billingInterval === undefined ||
        commerceEvidence.currentPeriodStartsAt === undefined ||
        commerceEvidence.currentPeriodEndsAt === undefined,
    };
  }
  const lifecycleByEvent: Readonly<Record<string, NormalizedCommerceLifecycle>> = {
    'invoice.paid': 'active',
    'invoice.payment_failed': 'delinquent',
  };
  const eventLifecycle = lifecycleByEvent[envelope.type];
  return {
    ...base,
    ...(customer === undefined ? {} : { providerCustomerId: customer }),
    ...(subscription === undefined ? {} : { externalSubscriptionId: subscription }),
    ...(binding === undefined ? {} : { canonicalBinding: binding }),
    ...(eventLifecycle === undefined ? {} : { lifecycle: eventLifecycle }),
    requiresReconciliation: true,
  };
}

function responseSession(value: Readonly<Record<string, unknown>>): CommerceSession {
  const id = safeText(value.id);
  const url = safeText(value.url);
  if (id === undefined || url === undefined) throw new StripeWebhookError('stripe.invalid_session');
  const expiresAt =
    typeof value.expires_at === 'number' ? new Date(value.expires_at * 1_000) : undefined;
  return {
    provider: 'stripe',
    environment: 'test',
    id,
    url,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function assertAllowedUrl(value: string, allowedOrigins: ReadonlySet<string>): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || !allowedOrigins.has(parsed.origin)) {
    throw new StripeWebhookError('stripe.return_url_not_allowed');
  }
}

function assertActor(actor: CommerceActor): void {
  if (
    actor.personId.trim() === '' ||
    actor.householdId.trim() === '' ||
    actor.billingAuthorityId.trim() === '' ||
    !Number.isFinite(actor.resolvedAt.getTime())
  ) {
    throw new StripeWebhookError('stripe.invalid_server_actor');
  }
}

export class StripeTestAdapter
  implements CommerceCheckoutPort, CommercePortalPort, ProviderReconciliationPort
{
  constructor(
    private readonly transport: StripeTransport,
    private readonly authorization: CommerceAuthorizationPort,
    private readonly allowedOrigins: ReadonlySet<string>,
    private readonly supportedApiVersion: string,
  ) {}

  async createCheckout(
    input: Parameters<CommerceCheckoutPort['createCheckout']>[0],
  ): Promise<CommerceSession> {
    assertActor(input.actor);
    if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= input.actor.resolvedAt) {
      throw new StripeWebhookError('stripe.invalid_checkout_expiry');
    }
    assertAllowedUrl(input.successUrl, this.allowedOrigins);
    assertAllowedUrl(input.cancelUrl, this.allowedOrigins);
    const decision = await this.authorization.authorize({
      actor: input.actor,
      action: 'checkout:create',
      planVersionId: input.planVersionId,
    });
    if (!decision.allowed) throw new StripeWebhookError('stripe.billing_authority_denied');
    const response = await this.transport.postForm({
      path: '/v1/checkout/sessions',
      idempotencyKey: input.idempotencyKey,
      form: {
        mode: 'subscription',
        'automatic_tax[enabled]': 'true',
        allow_promotion_codes: 'true',
        'line_items[0][price]': input.providerPriceId,
        'line_items[0][quantity]': '1',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.actor.householdId,
        'metadata[household_id]': input.actor.householdId,
        'metadata[canonical_subscription_id]': input.canonicalSubscriptionId,
        'metadata[plan_version_id]': input.planVersionId,
        'subscription_data[metadata][household_id]': input.actor.householdId,
        'subscription_data[metadata][canonical_subscription_id]': input.canonicalSubscriptionId,
        'subscription_data[metadata][plan_version_id]': input.planVersionId,
        expires_at: String(Math.floor(input.expiresAt.getTime() / 1_000)),
        ...(input.customerReference === undefined ? {} : { customer: input.customerReference }),
      },
    });
    return responseSession(response);
  }

  async createPortal(
    input: Parameters<CommercePortalPort['createPortal']>[0],
  ): Promise<CommerceSession> {
    assertActor(input.actor);
    assertAllowedUrl(input.returnUrl, this.allowedOrigins);
    const decision = await this.authorization.authorize({
      actor: input.actor,
      action: 'portal:create',
    });
    if (!decision.allowed) throw new StripeWebhookError('stripe.billing_authority_denied');
    return responseSession(
      await this.transport.postForm({
        path: '/v1/billing_portal/sessions',
        idempotencyKey: input.idempotencyKey,
        form: {
          customer: input.providerCustomerId,
          return_url: input.returnUrl,
          configuration: input.providerConfigurationId,
        },
      }),
    );
  }

  async retrieveSubscription(input: {
    readonly environment: 'test' | 'sandbox';
    readonly externalSubscriptionId: string;
    readonly observedAt: Date;
  }): Promise<NormalizedProviderCommerceEvent> {
    if (input.environment !== 'test') throw new StripeWebhookError('stripe.environment_mismatch');
    const object = await this.transport.get({
      path: `/v1/subscriptions/${encodeURIComponent(input.externalSubscriptionId)}`,
    });
    const created = typeof object.created === 'number' ? object.created : 0;
    const lifecycle = subscriptionLifecycle(object);
    const commerceEvidence = withBoundedGrace(
      lifecycle,
      subscriptionCommerceEvidence(object),
      input.observedAt,
    );
    return {
      provider: 'stripe',
      environment: 'test',
      externalEventId: `reconciliation:${input.externalSubscriptionId}:${created}`,
      eventType: 'subscription.reconciliation',
      providerApiVersion: this.supportedApiVersion,
      providerObjectId: providerObjectId(object),
      externalSubscriptionId: input.externalSubscriptionId,
      ...(safeText(object.customer) === undefined
        ? {}
        : { providerCustomerId: safeText(object.customer) as string }),
      ...commerceEvidence,
      eventCreatedAt: new Date(created * 1_000),
      lifecycle,
      requiresReconciliation:
        commerceEvidence.providerPriceId === undefined ||
        commerceEvidence.billingInterval === undefined ||
        commerceEvidence.currentPeriodStartsAt === undefined ||
        commerceEvidence.currentPeriodEndsAt === undefined,
      acknowledgementRequired: false,
    };
  }

  async resolveEventSubscription(input: {
    readonly environment: 'test' | 'sandbox';
    readonly eventType: string;
    readonly providerObjectId: string;
  }): Promise<{
    readonly externalSubscriptionId: string;
    readonly paidPeriodEvidence?: ProviderPaidPeriodEvidence;
    readonly lifecycleOverride?: 'refunded' | 'disputed';
    readonly requiresAttention: boolean;
  } | null> {
    if (input.environment !== 'test') throw new StripeWebhookError('stripe.environment_mismatch');

    const invoiceEvidence = async (
      invoiceId: string,
    ): Promise<{
      readonly invoice: Readonly<Record<string, unknown>>;
      readonly subscription: string | null;
    }> => {
      const invoice = await this.transport.get({
        path: `/v1/invoices/${encodeURIComponent(invoiceId)}`,
      });
      return { invoice, subscription: subscriptionReference(invoice) ?? null };
    };
    const invoiceSubscription = async (invoiceId: string): Promise<string | null> => {
      return (await invoiceEvidence(invoiceId)).subscription;
    };
    const chargeEvidence = async (
      chargeId: string,
    ): Promise<{
      readonly charge: Readonly<Record<string, unknown>>;
      readonly subscription: string | null;
    }> => {
      const charge = await this.transport.get({
        path: `/v1/charges/${encodeURIComponent(chargeId)}`,
      });
      const invoice = safeText(charge.invoice);
      if (invoice !== undefined) {
        return { charge, subscription: await invoiceSubscription(invoice) };
      }
      const paymentIntent = safeText(charge.payment_intent);
      if (paymentIntent === undefined) return { charge, subscription: null };
      const intent = await this.transport.get({
        path: `/v1/payment_intents/${encodeURIComponent(paymentIntent)}`,
      });
      const intentInvoice = safeText(intent.invoice);
      return {
        charge,
        subscription: intentInvoice === undefined ? null : await invoiceSubscription(intentInvoice),
      };
    };

    if (input.eventType.startsWith('invoice.')) {
      if (!resolvableInvoiceEventTypes.has(input.eventType)) return null;
      const evidence = await invoiceEvidence(input.providerObjectId);
      const paidPeriod =
        input.eventType === 'invoice.paid' && evidence.subscription !== null
          ? paidInvoicePeriodEvidence(evidence.invoice, evidence.subscription)
          : undefined;
      return evidence.subscription === null
        ? null
        : {
            externalSubscriptionId: evidence.subscription,
            ...(paidPeriod === undefined ? {} : { paidPeriodEvidence: paidPeriod }),
            requiresAttention: false,
          };
    }
    if (input.eventType === 'charge.refunded') {
      const evidence = await chargeEvidence(input.providerObjectId);
      if (evidence.subscription === null) return null;
      const amount = evidence.charge.amount;
      const refunded = evidence.charge.amount_refunded;
      const fullRefund =
        evidence.charge.refunded === true &&
        typeof amount === 'number' &&
        Number.isSafeInteger(amount) &&
        amount > 0 &&
        typeof refunded === 'number' &&
        Number.isSafeInteger(refunded) &&
        refunded >= amount;
      return {
        externalSubscriptionId: evidence.subscription,
        ...(fullRefund ? { lifecycleOverride: 'refunded' as const } : {}),
        requiresAttention: !fullRefund,
      };
    }
    if (input.eventType === 'charge.dispute.created') {
      const dispute = await this.transport.get({
        path: `/v1/disputes/${encodeURIComponent(input.providerObjectId)}`,
      });
      const charge = safeText(dispute.charge);
      if (charge === undefined) return null;
      const evidence = await chargeEvidence(charge);
      return evidence.subscription === null
        ? null
        : {
            externalSubscriptionId: evidence.subscription,
            lifecycleOverride: 'disputed',
            requiresAttention: true,
          };
    }
    return null;
  }
}

export function signStripeFixture(input: {
  readonly rawBody: string;
  readonly endpointSecret: string;
  readonly timestampSeconds: number;
}): string {
  const signature = createHmac('sha256', input.endpointSecret)
    .update(`${input.timestampSeconds}.${input.rawBody}`)
    .digest('hex');
  return `t=${input.timestampSeconds},v1=${signature}`;
}
