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
  ProviderFailedPaymentEvidence,
  ProviderFinancialRestrictionEvidence,
  ProviderReconciliationPort,
  StripeFoundingOffer,
  StripeInventoryPage,
  StripeInventoryPort,
  StripePreflightEvidence,
  StripePreflightPort,
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
  readonly account?: string;
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

export class StripeSessionDispatchError extends StripeWebhookError {
  constructor(
    code: string,
    readonly dispatchAttempted: boolean,
  ) {
    super(code);
    this.name = 'StripeSessionDispatchError';
  }
}

function safeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function explicitlyEmptyArrayOrNull(
  object: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(object, key)) return false;
  const value = object[key];
  return value === null || (Array.isArray(value) && value.length === 0);
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
    ...(safeText(event.account) === undefined
      ? {}
      : { account: safeText(event.account) as string }),
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
  readonly environment: 'test' | 'production';
  readonly expectedAccountId?: string;
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
  if (envelope.livemode !== (input.environment === 'production')) {
    throw new StripeWebhookError('stripe.environment_mismatch');
  }
  if (
    input.expectedAccountId !== undefined &&
    envelope.account !== undefined &&
    envelope.account !== input.expectedAccountId
  ) {
    throw new StripeWebhookError('stripe.account_mismatch');
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

function exactSubscriptionEnvelope(
  object: Readonly<Record<string, unknown>>,
  expectedId: string,
  expectedLivemode: boolean,
): boolean {
  return (
    object.object === 'subscription' &&
    safeText(object.id) === expectedId &&
    object.livemode === expectedLivemode
  );
}

function isExactFixedMonthlyPrice(price: Readonly<Record<string, unknown>>): boolean {
  const recurring = objectRecord(price.recurring);
  return (
    price.active === true &&
    price.currency === 'usd' &&
    price.unit_amount === 1499 &&
    price.unit_amount_decimal === '1499' &&
    price.type === 'recurring' &&
    price.billing_scheme === 'per_unit' &&
    price.custom_unit_amount === null &&
    price.tiers_mode === null &&
    price.transform_quantity === null &&
    recurring?.interval === 'month' &&
    recurring.interval_count === 1 &&
    recurring.usage_type === 'licensed' &&
    recurring.trial_period_days === null
  );
}

function subscriptionCommerceEvidence(object: Readonly<Record<string, unknown>>): {
  readonly providerPriceId?: string;
  readonly providerProductId?: string;
  readonly providerSubscriptionItemId?: string;
  readonly billingInterval?: 'month' | 'year';
  readonly currentPeriodStartsAt?: Date;
  readonly currentPeriodEndsAt?: Date;
  readonly subscriptionOfferExact?: true;
} {
  const items = objectRecord(object.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  if (items?.has_more !== false || data.length !== 1) return {};
  const item = objectRecord(data[0]);
  const price = objectRecord(item?.price);
  if (item === undefined || price === undefined) return {};
  const line = { item, price };
  const interval = safeText(objectRecord(line.price.recurring)?.interval);
  const startsAt = integerDate(line.item.current_period_start ?? object.current_period_start);
  const endsAt = integerDate(line.item.current_period_end ?? object.current_period_end);
  const providerPriceId = safeText(line.price.id);
  const providerProductId =
    safeText(line.price.product) ?? safeText(objectRecord(line.price.product)?.id);
  const providerSubscriptionItemId = safeText(line.item.id);
  const exact =
    providerPriceId !== undefined &&
    providerProductId !== undefined &&
    providerSubscriptionItemId !== undefined &&
    line.item.quantity === 1 &&
    isExactFixedMonthlyPrice(line.price);
  return {
    ...(providerPriceId === undefined ? {} : { providerPriceId }),
    ...(providerProductId === undefined ? {} : { providerProductId }),
    ...(providerSubscriptionItemId === undefined ? {} : { providerSubscriptionItemId }),
    ...(interval === 'month' || interval === 'year' ? { billingInterval: interval } : {}),
    ...(startsAt === undefined ? {} : { currentPeriodStartsAt: startsAt }),
    ...(endsAt === undefined ? {} : { currentPeriodEndsAt: endsAt }),
    ...(exact ? { subscriptionOfferExact: true as const } : {}),
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

function invoiceLineProductId(line: Readonly<Record<string, unknown>>): string | undefined {
  const legacyPrice = objectRecord(line.price);
  const pricingDetails = objectRecord(objectRecord(line.pricing)?.price_details);
  const candidates = [
    safeText(legacyPrice?.product),
    safeText(objectRecord(legacyPrice?.product)?.id),
    safeText(pricingDetails?.product),
    safeText(objectRecord(pricingDetails?.product)?.id),
  ].filter((value): value is string => value !== undefined);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

function subscriptionCycleLineage(
  line: Readonly<Record<string, unknown>>,
  externalSubscriptionId: string,
): { readonly schema: 'legacy' | 'modern'; readonly subscriptionItemId: string } | undefined {
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
    return { schema: 'legacy', subscriptionItemId: legacySubscriptionItem };
  }
  if (
    hasModernLineage &&
    modernType === 'subscription_item_details' &&
    modernSubscription === externalSubscriptionId &&
    modernSubscriptionItem !== undefined
  ) {
    return { schema: 'modern', subscriptionItemId: modernSubscriptionItem };
  }
  return undefined;
}

function paidInvoicePeriodEvidence(
  invoice: Readonly<Record<string, unknown>>,
  externalSubscriptionId: string,
  paymentIntent: Readonly<Record<string, unknown>>,
  expectedLivemode: boolean,
): ProviderPaidPeriodEvidence | undefined {
  if (
    invoice.object !== 'invoice' ||
    invoice.status !== 'paid' ||
    invoice.livemode !== expectedLivemode ||
    subscriptionReference(invoice) !== externalSubscriptionId
  ) {
    return undefined;
  }
  const lines = objectRecord(invoice.lines);
  if (lines?.object !== 'list' || lines.has_more !== false) return undefined;
  const lineRows = Array.isArray(lines.data)
    ? lines.data.map((value) => objectRecord(value)).filter((value) => value !== undefined)
    : [];
  if (lineRows.length !== 1) return undefined;
  const candidates: Array<{
    readonly line: Readonly<Record<string, unknown>>;
    readonly lineage: { readonly schema: 'legacy' | 'modern'; readonly subscriptionItemId: string };
  }> = [];
  for (const line of lineRows) {
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
    (lineage.schema === 'legacy' && line.proration !== false) ||
    (lineage.schema === 'modern' && details?.proration !== false)
  ) {
    return undefined;
  }
  const providerPriceId = invoiceLinePriceId(line);
  const providerProductId = invoiceLineProductId(line);
  const providerInvoiceLineId = safeText(line.id);
  const period = objectRecord(line.period);
  const currentPeriodStartsAt = integerDate(period?.start);
  const currentPeriodEndsAt = integerDate(period?.end);
  const providerInvoiceId = safeText(invoice.id);
  const payments = objectRecord(invoice.payments);
  const paymentRows = Array.isArray(payments?.data)
    ? payments.data.map((value) => objectRecord(value)).filter((value) => value !== undefined)
    : [];
  const payment = paymentRows.length === 1 ? paymentRows[0] : undefined;
  const paymentReference = objectRecord(payment?.payment);
  const providerInvoicePaymentId = safeText(payment?.id);
  const providerPaymentIntentId = safeText(paymentReference?.payment_intent);
  const billingReason = safeText(invoice.billing_reason);
  const providerPaidAt = integerDate(objectRecord(payment?.status_transitions)?.paid_at);
  const quantity = line.quantity;
  const lineDiscounts = Array.isArray(line.discounts) ? line.discounts : undefined;
  if (
    providerPriceId === undefined ||
    providerProductId === undefined ||
    providerInvoiceLineId === undefined ||
    providerInvoiceId === undefined ||
    providerInvoicePaymentId === undefined ||
    providerPaymentIntentId === undefined ||
    paymentIntent.object !== 'payment_intent' ||
    safeText(paymentIntent.id) !== providerPaymentIntentId ||
    paymentIntent.livemode !== expectedLivemode ||
    paymentIntent.status !== 'succeeded' ||
    paymentIntent.amount !== 1499 ||
    paymentIntent.amount_received !== 1499 ||
    paymentIntent.currency !== 'usd' ||
    (billingReason !== 'subscription_create' && billingReason !== 'subscription_cycle') ||
    invoice.amount_paid !== 1499 ||
    invoice.amount_remaining !== 0 ||
    invoice.currency !== 'usd' ||
    invoice.subtotal !== 1499 ||
    invoice.total !== 1499 ||
    !explicitlyEmptyArrayOrNull(invoice, 'total_discount_amounts') ||
    !explicitlyEmptyArrayOrNull(invoice, 'total_pretax_credit_amounts') ||
    !explicitlyEmptyArrayOrNull(invoice, 'total_taxes') ||
    !Array.isArray(invoice.discounts) ||
    invoice.discounts.length !== 0 ||
    invoice.pre_payment_credit_notes_amount !== 0 ||
    invoice.post_payment_credit_notes_amount !== 0 ||
    invoice.starting_balance !== 0 ||
    invoice.ending_balance !== 0 ||
    invoice.amount_overpaid !== 0 ||
    payments?.object !== 'list' ||
    payments.has_more !== false ||
    payment?.object !== 'invoice_payment' ||
    safeText(payment.id) !== providerInvoicePaymentId ||
    payment.livemode !== expectedLivemode ||
    payment?.status !== 'paid' ||
    payment?.is_default !== true ||
    payment?.amount_paid !== 1499 ||
    payment?.amount_requested !== 1499 ||
    payment?.currency !== 'usd' ||
    paymentReference?.type !== 'payment_intent' ||
    safeText(payment?.invoice) !== providerInvoiceId ||
    line.object !== 'line_item' ||
    line.amount !== 1499 ||
    line.currency !== 'usd' ||
    quantity !== 1 ||
    !explicitlyEmptyArrayOrNull(line, 'discount_amounts') ||
    lineDiscounts?.length !== 0 ||
    !explicitlyEmptyArrayOrNull(line, 'pretax_credit_amounts') ||
    !explicitlyEmptyArrayOrNull(line, 'taxes') ||
    providerPaidAt === undefined ||
    currentPeriodStartsAt === undefined ||
    currentPeriodEndsAt === undefined ||
    currentPeriodEndsAt <= currentPeriodStartsAt
  ) {
    return undefined;
  }
  return {
    providerInvoiceId,
    externalSubscriptionId,
    providerSubscriptionItemId: lineage.subscriptionItemId,
    providerInvoiceLineId,
    providerInvoicePaymentId,
    providerProductId,
    providerPaymentIntentId,
    providerPriceId,
    billingReason,
    amountPaid: 1499,
    amountRemaining: 0,
    currency: 'usd',
    quantity: 1,
    discountAmount: 0,
    taxAmount: 0,
    invoiceDiscountsEmpty: true,
    invoiceTaxesEmpty: true,
    invoiceCreditsEmpty: true,
    providerPaidAt,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
  };
}

function failedInvoiceEvidence(
  invoice: Readonly<Record<string, unknown>>,
  externalSubscriptionId: string,
  paymentIntent: Readonly<Record<string, unknown>> | undefined,
  expectedLivemode: boolean,
): ProviderFailedPaymentEvidence | undefined {
  if (
    invoice.object !== 'invoice' ||
    invoice.status !== 'open' ||
    invoice.livemode !== expectedLivemode ||
    subscriptionReference(invoice) !== externalSubscriptionId ||
    invoice.amount_due !== 1499 ||
    invoice.currency !== 'usd' ||
    invoice.subtotal !== 1499 ||
    invoice.total !== 1499 ||
    !explicitlyEmptyArrayOrNull(invoice, 'total_discount_amounts') ||
    !explicitlyEmptyArrayOrNull(invoice, 'total_taxes') ||
    typeof invoice.attempt_count !== 'number' ||
    !Number.isSafeInteger(invoice.attempt_count) ||
    invoice.attempt_count < 1
  ) {
    return undefined;
  }
  const billingReason = safeText(invoice.billing_reason);
  if (billingReason !== 'subscription_create' && billingReason !== 'subscription_cycle') {
    return undefined;
  }
  const lines = objectRecord(invoice.lines);
  if (lines?.object !== 'list' || lines.has_more !== false) return undefined;
  const lineRows = Array.isArray(lines.data) ? lines.data : [];
  if (lineRows.length !== 1) return undefined;
  const candidates = lineRows
    .map((value) => objectRecord(value))
    .filter((line): line is Readonly<Record<string, unknown>> => line !== undefined)
    .map((line) => ({ line, lineage: subscriptionCycleLineage(line, externalSubscriptionId) }))
    .filter(
      (
        candidate,
      ): candidate is {
        readonly line: Readonly<Record<string, unknown>>;
        readonly lineage: {
          readonly schema: 'legacy' | 'modern';
          readonly subscriptionItemId: string;
        };
      } => candidate.lineage !== undefined,
    );
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  const candidateParent = objectRecord(candidate?.line.parent);
  const candidateDetails = objectRecord(candidateParent?.subscription_item_details);
  const lineProration =
    candidate?.lineage.schema === 'legacy'
      ? candidate?.line.proration
      : candidateDetails?.proration;
  const period = objectRecord(candidate?.line.period);
  const currentPeriodStartsAt = integerDate(period?.start);
  const currentPeriodEndsAt = integerDate(period?.end);
  const providerInvoiceLineId = safeText(candidate?.line.id);
  const providerProductId =
    candidate === undefined ? undefined : invoiceLineProductId(candidate.line);
  if (
    candidate === undefined ||
    candidate.line.object !== 'line_item' ||
    invoiceLinePriceId(candidate.line) === undefined ||
    providerProductId === undefined ||
    providerInvoiceLineId === undefined ||
    lineProration !== false ||
    currentPeriodStartsAt === undefined ||
    currentPeriodEndsAt === undefined ||
    currentPeriodEndsAt <= currentPeriodStartsAt ||
    candidate.line.amount !== 1499 ||
    candidate.line.currency !== 'usd' ||
    candidate.line.quantity !== 1 ||
    !explicitlyEmptyArrayOrNull(candidate.line, 'discount_amounts') ||
    !Array.isArray(candidate.line.discounts) ||
    candidate.line.discounts.length > 0 ||
    !explicitlyEmptyArrayOrNull(candidate.line, 'pretax_credit_amounts') ||
    !explicitlyEmptyArrayOrNull(candidate.line, 'taxes') ||
    !explicitlyEmptyArrayOrNull(invoice, 'total_pretax_credit_amounts') ||
    !Array.isArray(invoice.discounts) ||
    invoice.discounts.length > 0 ||
    invoice.pre_payment_credit_notes_amount !== 0 ||
    invoice.post_payment_credit_notes_amount !== 0
  ) {
    return undefined;
  }
  const payments = objectRecord(invoice.payments);
  const paymentRows = Array.isArray(payments?.data)
    ? payments.data.map((value) => objectRecord(value)).filter((value) => value !== undefined)
    : [];
  const payment = paymentRows.length === 1 ? paymentRows[0] : undefined;
  const paymentReference = objectRecord(payment?.payment);
  const providerInvoicePaymentId = safeText(payment?.id);
  const paymentIntentId = safeText(paymentReference?.payment_intent);
  const providerStatus = safeText(paymentIntent?.status);
  const failureStatus: ProviderFailedPaymentEvidence['failureStatus'] | undefined =
    providerStatus === 'requires_payment_method' ||
    providerStatus === 'requires_action' ||
    providerStatus === 'canceled'
      ? providerStatus
      : paymentIntentId === undefined
        ? 'failed'
        : undefined;
  if (
    failureStatus === undefined ||
    providerInvoicePaymentId === undefined ||
    payments?.object !== 'list' ||
    payments.has_more !== false ||
    payment?.object !== 'invoice_payment' ||
    safeText(payment.id) !== providerInvoicePaymentId ||
    payment.livemode !== expectedLivemode ||
    payment?.status !== 'open' ||
    payment?.is_default !== true ||
    payment?.amount_requested !== 1499 ||
    payment?.currency !== 'usd' ||
    paymentReference?.type !== 'payment_intent' ||
    safeText(payment?.invoice) !== providerObjectId(invoice) ||
    (paymentIntentId !== undefined &&
      (paymentIntent?.object !== 'payment_intent' ||
        safeText(paymentIntent.id) !== paymentIntentId ||
        paymentIntent?.livemode !== expectedLivemode))
  ) {
    return undefined;
  }
  return {
    providerInvoiceId: providerObjectId(invoice),
    externalSubscriptionId,
    providerSubscriptionItemId: candidate.lineage.subscriptionItemId,
    providerInvoiceLineId,
    providerInvoicePaymentId,
    providerProductId,
    ...(paymentIntentId === undefined ? {} : { providerPaymentIntentId: paymentIntentId }),
    providerPriceId: invoiceLinePriceId(candidate.line) as string,
    billingReason: billingReason as ProviderFailedPaymentEvidence['billingReason'],
    amountDue: 1499 as const,
    currency: 'usd' as const,
    quantity: 1 as const,
    attemptCount: invoice.attempt_count,
    failureStatus,
    lineProration: false,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
  };
}

const resolvableInvoiceEventTypes = new Set(['invoice.paid', 'invoice.payment_failed']);

function withBoundedGrace(
  lifecycle: NormalizedCommerceLifecycle,
  evidence: ReturnType<typeof subscriptionCommerceEvidence>,
  observedAt: Date,
): ReturnType<typeof subscriptionCommerceEvidence> {
  // A provider past_due snapshot is not authority to truncate an already-paid period.
  // Persistence derives any three-day renewal grace from canonical paid-through evidence.
  void lifecycle;
  void observedAt;
  return evidence;
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
    environment: envelope.livemode ? ('production' as const) : ('test' as const),
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
  if (envelope.type === 'checkout.session.completed') {
    const expiresAt = integerDate(object.expires_at);
    if (
      object.object !== 'checkout.session' ||
      object.livemode !== envelope.livemode ||
      object.mode !== 'subscription' ||
      object.status !== 'complete' ||
      object.payment_status !== 'paid' ||
      object.amount_total !== 1499 ||
      object.currency !== 'usd' ||
      subscription === undefined ||
      customer === undefined ||
      expiresAt === undefined ||
      binding === undefined
    ) {
      return {
        ...base,
        ...(subscription === undefined ? {} : { externalSubscriptionId: subscription }),
        ...(customer === undefined ? {} : { providerCustomerId: customer }),
        ...(binding === undefined ? {} : { canonicalBinding: binding }),
        requiresReconciliation: true,
      };
    }
    return {
      ...base,
      externalSubscriptionId: subscription,
      providerCustomerId: customer,
      ...(safeText(object.payment_intent) === undefined
        ? {}
        : { providerPaymentIntentId: safeText(object.payment_intent) as string }),
      canonicalBinding: binding,
      checkoutCompletion: {
        sessionStatus: 'complete',
        paymentStatus: 'paid',
        amountTotal: 1499,
        currency: 'usd',
        providerExpiresAt: expiresAt,
      },
      requiresReconciliation: false,
    };
  }
  if (envelope.type === 'checkout.session.expired') {
    const expiresAt = integerDate(object.expires_at);
    if (
      object.object !== 'checkout.session' ||
      object.livemode !== envelope.livemode ||
      object.status !== 'expired' ||
      object.payment_status !== 'unpaid' ||
      object.mode !== 'subscription' ||
      object.amount_total !== 1499 ||
      object.currency !== 'usd' ||
      expiresAt === undefined ||
      binding === undefined
    ) {
      return {
        ...base,
        ...(binding === undefined ? {} : { canonicalBinding: binding }),
        requiresReconciliation: true,
      };
    }
    return {
      ...base,
      canonicalBinding: binding,
      checkoutExpiration: {
        sessionStatus: 'expired',
        paymentStatus: 'unpaid',
        mode: 'subscription',
        amountTotal: 1499,
        currency: 'usd',
        providerExpiresAt: expiresAt,
      },
      requiresReconciliation: false,
    };
  }
  const lifecycle = envelope.type.startsWith('customer.subscription.')
    ? envelope.type === 'customer.subscription.deleted'
      ? 'canceled'
      : subscriptionLifecycle(object)
    : undefined;
  const subscriptionEnvelopeExact =
    envelope.type.startsWith('customer.subscription.') &&
    exactSubscriptionEnvelope(object, providerObjectId(object), envelope.livemode);
  const commerceEvidence = withBoundedGrace(
    lifecycle ?? 'pending',
    subscriptionEnvelopeExact ? subscriptionCommerceEvidence(object) : {},
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
        commerceEvidence.subscriptionOfferExact !== true ||
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

function providerHostedSessionUrl(value: unknown, origin: string): string | undefined {
  const text = safeText(value);
  if (text === undefined) return undefined;
  try {
    const parsed = new URL(text);
    return parsed.origin === origin && parsed.username === '' && parsed.password === ''
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function checkoutResponseSession(
  value: Readonly<Record<string, unknown>>,
  environment: 'test' | 'production',
  input: Parameters<CommerceCheckoutPort['createCheckout']>[0],
): CommerceSession {
  const id = safeText(value.id);
  const url = providerHostedSessionUrl(value.url, 'https://checkout.stripe.com');
  const metadata = objectRecord(value.metadata);
  if (
    value.object !== 'checkout.session' ||
    value.livemode !== (environment === 'production') ||
    id === undefined ||
    id.startsWith(environment === 'test' ? 'cs_test_' : 'cs_live_') !== true ||
    url === undefined ||
    value.mode !== 'subscription' ||
    value.status !== 'open' ||
    value.payment_status !== 'unpaid' ||
    safeText(value.client_reference_id) !== input.actor.householdId ||
    safeText(value.success_url) !== input.successUrl ||
    safeText(value.cancel_url) !== input.cancelUrl ||
    safeText(metadata?.household_id) !== input.actor.householdId ||
    safeText(metadata?.canonical_subscription_id) !== input.canonicalSubscriptionId ||
    safeText(metadata?.plan_version_id) !== input.planVersionId ||
    (input.customerReference === undefined
      ? value.customer !== null
      : safeText(value.customer) !== input.customerReference)
  ) {
    throw new StripeWebhookError('stripe.invalid_session');
  }
  const expiresAt = integerDate(value.expires_at);
  return {
    provider: 'stripe',
    environment,
    id,
    url,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function portalResponseSession(
  value: Readonly<Record<string, unknown>>,
  environment: 'test' | 'production',
  input: Parameters<CommercePortalPort['createPortal']>[0],
): CommerceSession {
  const id = safeText(value.id);
  const url = providerHostedSessionUrl(value.url, 'https://billing.stripe.com');
  if (
    value.object !== 'billing_portal.session' ||
    value.livemode !== (environment === 'production') ||
    id === undefined ||
    !id.startsWith('bps_') ||
    url === undefined ||
    safeText(value.customer) !== input.providerCustomerId ||
    safeText(value.configuration) !== input.providerConfigurationId ||
    safeText(value.return_url) !== input.returnUrl
  ) {
    throw new StripeWebhookError('stripe.invalid_session');
  }
  return {
    provider: 'stripe',
    environment,
    id,
    url,
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

export interface StripeAdapterConfiguration {
  readonly environment: 'test' | 'production';
  readonly accountId: string;
  readonly apiVersion: string;
  readonly portalConfigurationId: string;
  readonly offer: StripeFoundingOffer;
}

export class StripeAdapter
  implements
    CommerceCheckoutPort,
    CommercePortalPort,
    ProviderReconciliationPort,
    StripeInventoryPort,
    StripePreflightPort
{
  constructor(
    private readonly transport: StripeTransport,
    private readonly authorization: CommerceAuthorizationPort,
    private readonly allowedOrigins: ReadonlySet<string>,
    private readonly configuration: StripeAdapterConfiguration,
  ) {}

  async verifyConfiguredResources(): Promise<StripePreflightEvidence> {
    const expectedLivemode = this.configuration.environment === 'production';
    const [account, product, price, portal] = await Promise.all([
      this.transport.get({ path: '/v1/account' }),
      this.transport.get({
        path: `/v1/products/${encodeURIComponent(this.configuration.offer.providerProductId)}`,
      }),
      this.transport.get({
        path: `/v1/prices/${encodeURIComponent(this.configuration.offer.providerPriceId)}`,
      }),
      this.transport.get({
        path: `/v1/billing_portal/configurations/${encodeURIComponent(this.configuration.portalConfigurationId)}`,
      }),
    ]);
    const features = objectRecord(portal.features);
    const subscriptionCancel = objectRecord(features?.subscription_cancel);
    const subscriptionUpdate = objectRecord(features?.subscription_update);
    const paymentMethodUpdate = objectRecord(features?.payment_method_update);
    const customerUpdate = objectRecord(features?.customer_update);
    if (
      account.object !== 'account' ||
      safeText(account.id) !== this.configuration.accountId ||
      product.object !== 'product' ||
      product.livemode !== expectedLivemode ||
      price.object !== 'price' ||
      price.livemode !== expectedLivemode ||
      portal.object !== 'billing_portal.configuration' ||
      portal.livemode !== expectedLivemode ||
      safeText(product.id) !== this.configuration.offer.providerProductId ||
      product.active !== true ||
      safeText(price.id) !== this.configuration.offer.providerPriceId ||
      !isExactFixedMonthlyPrice(price) ||
      safeText(price.product) !== this.configuration.offer.providerProductId ||
      safeText(portal.id) !== this.configuration.portalConfigurationId ||
      portal.active !== true ||
      subscriptionCancel?.enabled !== true ||
      subscriptionCancel.mode !== 'at_period_end' ||
      subscriptionCancel.proration_behavior !== 'none' ||
      subscriptionUpdate?.enabled !== false ||
      !Array.isArray(subscriptionUpdate.default_allowed_updates) ||
      subscriptionUpdate.default_allowed_updates.length !== 0 ||
      paymentMethodUpdate?.enabled !== false ||
      customerUpdate?.enabled !== false ||
      !Array.isArray(customerUpdate.allowed_updates) ||
      customerUpdate.allowed_updates.length !== 0
    ) {
      throw new StripeWebhookError('stripe.preflight_resource_mismatch');
    }
    return {
      environment: this.configuration.environment,
      accountId: this.configuration.accountId,
      livemode: expectedLivemode,
      apiVersion: this.configuration.apiVersion,
      offer: this.configuration.offer,
      portalConfigurationId: this.configuration.portalConfigurationId,
      productActive: true,
      priceActive: true,
      portalCancelOnly: true,
      portalMutationControlsExact: true,
      portalCancellationMode: 'at_period_end',
      portalProrationBehavior: 'none',
      portalSubscriptionUpdateDefaultsEmpty: true,
      retentionCouponEvidence: 'manual_founder_browser_required',
      promotionsEnabled: false,
      automaticTaxEnabled: false,
      adaptivePricingEnabled: false,
    };
  }

  async createCheckout(
    input: Parameters<CommerceCheckoutPort['createCheckout']>[0],
  ): Promise<CommerceSession> {
    let dispatchAttempted = false;
    try {
      assertActor(input.actor);
      if (
        input.planVersionId !== this.configuration.offer.planVersionId ||
        input.providerPriceId !== this.configuration.offer.providerPriceId
      ) {
        throw new StripeWebhookError('stripe.offer_mapping_mismatch');
      }
      const providerExpiresAt = input.providerExpiresAt ?? input.expiresAt;
      if (
        providerExpiresAt === undefined ||
        !Number.isFinite(providerExpiresAt.getTime()) ||
        providerExpiresAt.getTime() % 1_000 !== 0 ||
        providerExpiresAt.getTime() < input.actor.resolvedAt.getTime() + 30 * 60_000 ||
        providerExpiresAt.getTime() > input.actor.resolvedAt.getTime() + 24 * 60 * 60_000
      ) {
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
      dispatchAttempted = true;
      const response = await this.transport.postForm({
        path: '/v1/checkout/sessions',
        idempotencyKey: input.idempotencyKey,
        form: {
          mode: 'subscription',
          'automatic_tax[enabled]': 'false',
          allow_promotion_codes: 'false',
          'adaptive_pricing[enabled]': 'false',
          'after_expiration[recovery][enabled]': 'false',
          'payment_method_types[0]': 'card',
          payment_method_collection: 'always',
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
          expires_at: String(providerExpiresAt.getTime() / 1_000),
          ...(input.customerReference === undefined ? {} : { customer: input.customerReference }),
        },
      });
      const session = checkoutResponseSession(response, this.configuration.environment, input);
      if (
        session.expiresAt === undefined ||
        session.expiresAt.getTime() !== providerExpiresAt.getTime()
      ) {
        throw new StripeWebhookError('stripe.checkout_expiry_mismatch');
      }
      return session;
    } catch (error) {
      if (error instanceof StripeSessionDispatchError) throw error;
      throw new StripeSessionDispatchError(
        error instanceof StripeWebhookError
          ? error.code
          : dispatchAttempted
            ? 'stripe.transport_or_response_failure'
            : 'stripe.pre_dispatch_failure',
        dispatchAttempted,
      );
    }
  }

  async createPortal(
    input: Parameters<CommercePortalPort['createPortal']>[0],
  ): Promise<CommerceSession> {
    let dispatchAttempted = false;
    try {
      assertActor(input.actor);
      if (input.providerConfigurationId !== this.configuration.portalConfigurationId) {
        throw new StripeWebhookError('stripe.portal_configuration_mismatch');
      }
      assertAllowedUrl(input.returnUrl, this.allowedOrigins);
      const decision = await this.authorization.authorize({
        actor: input.actor,
        action: 'portal:create',
      });
      if (!decision.allowed) throw new StripeWebhookError('stripe.billing_authority_denied');
      dispatchAttempted = true;
      const response = await this.transport.postForm({
        path: '/v1/billing_portal/sessions',
        idempotencyKey: input.idempotencyKey,
        form: {
          customer: input.providerCustomerId,
          return_url: input.returnUrl,
          configuration: input.providerConfigurationId,
        },
      });
      return portalResponseSession(response, this.configuration.environment, input);
    } catch (error) {
      if (error instanceof StripeSessionDispatchError) throw error;
      throw new StripeSessionDispatchError(
        error instanceof StripeWebhookError
          ? error.code
          : dispatchAttempted
            ? 'stripe.transport_or_response_failure'
            : 'stripe.pre_dispatch_failure',
        dispatchAttempted,
      );
    }
  }

  async retrieveSubscription(input: {
    readonly environment: 'test' | 'sandbox' | 'production';
    readonly externalSubscriptionId: string;
    readonly observedAt: Date;
  }): Promise<NormalizedProviderCommerceEvent> {
    if (input.environment !== this.configuration.environment) {
      throw new StripeWebhookError('stripe.environment_mismatch');
    }
    const object = await this.transport.get({
      path: `/v1/subscriptions/${encodeURIComponent(input.externalSubscriptionId)}`,
    });
    if (
      !exactSubscriptionEnvelope(
        object,
        input.externalSubscriptionId,
        this.configuration.environment === 'production',
      )
    ) {
      throw new StripeWebhookError('stripe.subscription_envelope_mismatch');
    }
    const created = typeof object.created === 'number' ? object.created : 0;
    const lifecycle = subscriptionLifecycle(object);
    const commerceEvidence = withBoundedGrace(
      lifecycle,
      subscriptionCommerceEvidence(object),
      input.observedAt,
    );
    return {
      provider: 'stripe',
      environment: this.configuration.environment,
      externalEventId: `reconciliation:${input.externalSubscriptionId}:${created}`,
      eventType: 'subscription.reconciliation',
      providerApiVersion: this.configuration.apiVersion,
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
        commerceEvidence.providerPriceId !== this.configuration.offer.providerPriceId ||
        commerceEvidence.providerProductId !== this.configuration.offer.providerProductId ||
        commerceEvidence.subscriptionOfferExact !== true ||
        commerceEvidence.billingInterval === undefined ||
        commerceEvidence.currentPeriodStartsAt === undefined ||
        commerceEvidence.currentPeriodEndsAt === undefined,
      acknowledgementRequired: false,
    };
  }

  async fetchSubscriptionInventory(input: {
    readonly environment: 'test' | 'production';
    readonly onPage: (page: StripeInventoryPage) => Promise<void>;
  }): Promise<{
    readonly verifiedAccountId: string;
    readonly pages: readonly StripeInventoryPage[];
  }> {
    if (input.environment !== this.configuration.environment) {
      throw new StripeWebhookError('stripe.environment_mismatch');
    }
    const account = await this.transport.get({ path: '/v1/account' });
    if (account.object !== 'account' || safeText(account.id) !== this.configuration.accountId) {
      throw new StripeWebhookError('stripe.inventory_account_mismatch');
    }
    const verifiedAccountId = this.configuration.accountId;
    const expectedLivemode = input.environment === 'production';
    const pages: StripeInventoryPage[] = [];
    const seenCursors = new Set<string>();
    let requestCursor: string | undefined;
    for (let pageNumber = 1; pageNumber <= 1_000; pageNumber += 1) {
      const path =
        requestCursor === undefined
          ? '/v1/subscriptions?status=all&limit=100'
          : `/v1/subscriptions?status=all&limit=100&starting_after=${encodeURIComponent(requestCursor)}`;
      const response = await this.transport.get({ path });
      if (response.object !== 'list' || typeof response.has_more !== 'boolean') {
        throw new StripeWebhookError('stripe.inventory_page_invalid');
      }
      const data = Array.isArray(response.data) ? response.data : undefined;
      if (data === undefined || data.length > 100) {
        throw new StripeWebhookError('stripe.inventory_page_invalid');
      }
      const subscriptions = data.map((value) => {
        const subscription = objectRecord(value);
        if (
          subscription === undefined ||
          subscription.object !== 'subscription' ||
          subscription.livemode !== expectedLivemode
        ) {
          throw new StripeWebhookError('stripe.inventory_page_invalid');
        }
        return {
          externalSubscriptionId: providerObjectId(subscription),
          lifecycle: subscriptionLifecycle(subscription),
        };
      });
      const nextCursor =
        response.has_more === true ? subscriptions.at(-1)?.externalSubscriptionId : undefined;
      if (
        (response.has_more === true && nextCursor === undefined) ||
        (nextCursor !== undefined && seenCursors.has(nextCursor))
      ) {
        throw new StripeWebhookError('stripe.inventory_pagination_invalid');
      }
      const page: StripeInventoryPage = {
        pageNumber,
        ...(requestCursor === undefined ? {} : { requestCursor }),
        ...(nextCursor === undefined ? {} : { nextCursor }),
        hasMore: response.has_more,
        subscriptions,
      };
      await input.onPage(page);
      pages.push(page);
      if (!page.hasMore) return { verifiedAccountId, pages };
      seenCursors.add(nextCursor as string);
      requestCursor = nextCursor;
    }
    throw new StripeWebhookError('stripe.inventory_pagination_limit');
  }

  async resolveEventSubscription(input: {
    readonly environment: 'test' | 'sandbox' | 'production';
    readonly eventType: string;
    readonly providerObjectId: string;
  }): Promise<{
    readonly externalSubscriptionId: string;
    readonly paidPeriodEvidence?: ProviderPaidPeriodEvidence;
    readonly failedPaymentEvidence?: ProviderFailedPaymentEvidence;
    readonly lifecycleOverride?: 'refunded' | 'disputed';
    readonly financialResolution?:
      | 'provider_dispute_won'
      | 'provider_dispute_prevented'
      | 'provider_dispute_warning_closed'
      | 'provider_dispute_lost'
      | 'refund_failed'
      | 'refund_canceled';
    readonly financialRestrictionEvidence?: readonly ProviderFinancialRestrictionEvidence[];
    readonly requiresAttention: boolean;
  } | null> {
    if (input.environment !== this.configuration.environment) {
      throw new StripeWebhookError('stripe.environment_mismatch');
    }

    const invoiceEvidence = async (
      invoiceId: string,
    ): Promise<{
      readonly invoice: Readonly<Record<string, unknown>>;
      readonly subscription: string | null;
    }> => {
      const invoice = await this.transport.get({
        path: `/v1/invoices/${encodeURIComponent(invoiceId)}`,
      });
      const exactEnvelope =
        invoice.object === 'invoice' &&
        safeText(invoice.id) === invoiceId &&
        invoice.livemode === (this.configuration.environment === 'production');
      return {
        invoice,
        subscription: exactEnvelope ? (subscriptionReference(invoice) ?? null) : null,
      };
    };
    const invoiceSubscription = async (invoiceId: string): Promise<string | null> => {
      return (await invoiceEvidence(invoiceId)).subscription;
    };
    const invoicePaymentIntent = (
      invoice: Readonly<Record<string, unknown>>,
    ): string | undefined => {
      const payments = objectRecord(invoice.payments);
      const rows = Array.isArray(payments?.data)
        ? payments.data.map((value) => objectRecord(value)).filter((value) => value !== undefined)
        : [];
      const payment = rows[0];
      if (
        payments?.object !== 'list' ||
        payments.has_more !== false ||
        rows.length !== 1 ||
        payment?.object !== 'invoice_payment' ||
        safeText(payment.id) === undefined ||
        payment.livemode !== (this.configuration.environment === 'production') ||
        safeText(payment.invoice) !== safeText(invoice.id)
      ) {
        return undefined;
      }
      return safeText(objectRecord(payment.payment)?.payment_intent);
    };
    const chargeEvidence = async (
      chargeId: string,
    ): Promise<{
      readonly charge: Readonly<Record<string, unknown>>;
      readonly subscription: string | null;
      readonly providerPaymentIntentId: string | null;
      readonly providerInvoiceId: string | null;
    }> => {
      const charge = await this.transport.get({
        path: `/v1/charges/${encodeURIComponent(chargeId)}`,
      });
      const expectedLivemode = this.configuration.environment === 'production';
      const paymentIntent = safeText(charge.payment_intent);
      if (
        charge.object !== 'charge' ||
        safeText(charge.id) !== chargeId ||
        charge.livemode !== expectedLivemode ||
        charge.status !== 'succeeded' ||
        charge.paid !== true ||
        charge.amount !== 1499 ||
        charge.currency !== 'usd' ||
        paymentIntent === undefined
      ) {
        return {
          charge,
          subscription: null,
          providerPaymentIntentId: null,
          providerInvoiceId: null,
        };
      }
      const intent = await this.transport.get({
        path: `/v1/payment_intents/${encodeURIComponent(paymentIntent)}`,
      });
      if (
        intent.object !== 'payment_intent' ||
        safeText(intent.id) !== paymentIntent ||
        intent.livemode !== expectedLivemode ||
        intent.status !== 'succeeded' ||
        intent.amount !== 1499 ||
        intent.amount_received !== 1499 ||
        intent.currency !== 'usd' ||
        safeText(intent.latest_charge) !== chargeId
      ) {
        return {
          charge,
          subscription: null,
          providerPaymentIntentId: null,
          providerInvoiceId: null,
        };
      }
      const payments = await this.transport.get({
        path: `/v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=${encodeURIComponent(paymentIntent)}&limit=2`,
      });
      const paymentRows = Array.isArray(payments.data)
        ? payments.data.map((value) => objectRecord(value)).filter((value) => value !== undefined)
        : [];
      const payment = paymentRows.length === 1 ? paymentRows[0] : undefined;
      const paymentReference = objectRecord(payment?.payment);
      const invoiceId = safeText(payment?.invoice);
      if (
        payments.object !== 'list' ||
        payments.has_more !== false ||
        payment?.object !== 'invoice_payment' ||
        safeText(payment.id) === undefined ||
        payment.livemode !== expectedLivemode ||
        payment.status !== 'paid' ||
        payment.is_default !== true ||
        payment.amount_paid !== 1499 ||
        payment.amount_requested !== 1499 ||
        payment.currency !== 'usd' ||
        paymentReference?.type !== 'payment_intent' ||
        safeText(paymentReference.payment_intent) !== paymentIntent ||
        invoiceId === undefined
      ) {
        return {
          charge,
          subscription: null,
          providerPaymentIntentId: null,
          providerInvoiceId: null,
        };
      }
      return {
        charge,
        subscription: await invoiceSubscription(invoiceId),
        providerPaymentIntentId: paymentIntent,
        providerInvoiceId: invoiceId,
      };
    };

    if (input.eventType.startsWith('invoice.')) {
      if (!resolvableInvoiceEventTypes.has(input.eventType)) return null;
      const evidence = await invoiceEvidence(input.providerObjectId);
      const subscription =
        evidence.subscription === null
          ? undefined
          : await this.transport.get({
              path: `/v1/subscriptions/${encodeURIComponent(evidence.subscription)}`,
            });
      const currentSubscription =
        subscription === undefined ? undefined : subscriptionCommerceEvidence(subscription);
      const currentSubscriptionExact =
        subscription !== undefined &&
        exactSubscriptionEnvelope(
          subscription,
          evidence.subscription ?? '',
          this.configuration.environment === 'production',
        ) &&
        currentSubscription?.subscriptionOfferExact === true &&
        currentSubscription.providerPriceId === this.configuration.offer.providerPriceId &&
        currentSubscription.providerProductId === this.configuration.offer.providerProductId;
      const paymentIntentId = invoicePaymentIntent(evidence.invoice);
      const paymentIntent =
        paymentIntentId === undefined
          ? undefined
          : await this.transport.get({
              path: `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
            });
      const candidatePaidPeriod =
        input.eventType === 'invoice.paid' &&
        evidence.subscription !== null &&
        paymentIntent !== undefined
          ? paidInvoicePeriodEvidence(
              evidence.invoice,
              evidence.subscription,
              paymentIntent,
              this.configuration.environment === 'production',
            )
          : undefined;
      const paidPeriod =
        candidatePaidPeriod?.providerPriceId === this.configuration.offer.providerPriceId &&
        candidatePaidPeriod.providerProductId === this.configuration.offer.providerProductId &&
        currentSubscriptionExact &&
        candidatePaidPeriod.providerSubscriptionItemId ===
          currentSubscription.providerSubscriptionItemId
          ? candidatePaidPeriod
          : undefined;
      const candidateFailedPayment =
        input.eventType === 'invoice.payment_failed' && evidence.subscription !== null
          ? failedInvoiceEvidence(
              evidence.invoice,
              evidence.subscription,
              paymentIntent,
              this.configuration.environment === 'production',
            )
          : undefined;
      const failedPayment =
        candidateFailedPayment?.providerPriceId === this.configuration.offer.providerPriceId &&
        candidateFailedPayment.providerProductId === this.configuration.offer.providerProductId &&
        currentSubscriptionExact &&
        candidateFailedPayment.providerSubscriptionItemId ===
          currentSubscription.providerSubscriptionItemId
          ? candidateFailedPayment
          : undefined;
      return evidence.subscription === null
        ? null
        : {
            externalSubscriptionId: evidence.subscription,
            ...(paidPeriod === undefined ? {} : { paidPeriodEvidence: paidPeriod }),
            ...(failedPayment === undefined ? {} : { failedPaymentEvidence: failedPayment }),
            requiresAttention:
              (input.eventType === 'invoice.paid' && paidPeriod === undefined) ||
              (input.eventType === 'invoice.payment_failed' && failedPayment === undefined),
          };
    }
    if (input.eventType === 'charge.refunded') {
      const evidence = await chargeEvidence(input.providerObjectId);
      if (evidence.subscription === null) return null;
      const amount = evidence.charge.amount;
      const refunded = evidence.charge.amount_refunded;
      const refunds = objectRecord(evidence.charge.refunds);
      const refundRows = Array.isArray(refunds?.data)
        ? refunds.data.map((value) => objectRecord(value)).filter((value) => value !== undefined)
        : [];
      const exactRefunds = refundRows.map((refund) => ({
        refund,
        providerRefundId: safeText(refund.id),
      }));
      const refundIds = exactRefunds
        .map(({ providerRefundId }) => providerRefundId)
        .filter((value): value is string => value !== undefined);
      const succeededAmount = exactRefunds.reduce(
        (total, { refund }) =>
          refund.status === 'succeeded' &&
          typeof refund.amount === 'number' &&
          Number.isSafeInteger(refund.amount)
            ? total + refund.amount
            : total,
        0,
      );
      const providerPaymentIntentId = evidence.providerPaymentIntentId;
      const providerInvoiceId = evidence.providerInvoiceId;
      const allRefundRowsExact =
        providerPaymentIntentId !== null &&
        exactRefunds.every(({ refund }) => {
          const paymentIntentReference = Object.hasOwn(refund, 'payment_intent')
            ? refund.payment_intent
            : undefined;
          return (
            refund.object === 'refund' &&
            refund.livemode === (this.configuration.environment === 'production') &&
            typeof refund.amount === 'number' &&
            Number.isSafeInteger(refund.amount) &&
            refund.amount > 0 &&
            refund.amount <= 1499 &&
            refund.currency === 'usd' &&
            safeText(refund.charge) === input.providerObjectId &&
            (paymentIntentReference === null ||
              safeText(paymentIntentReference) === providerPaymentIntentId) &&
            ['succeeded', 'failed', 'canceled'].includes(safeText(refund.status) ?? '')
          );
        });
      const succeededRefunds = exactRefunds.filter(({ refund }) => refund.status === 'succeeded');
      const fullRefund =
        evidence.charge.refunded === true &&
        amount === 1499 &&
        evidence.charge.currency === 'usd' &&
        typeof refunded === 'number' &&
        Number.isSafeInteger(refunded) &&
        refunded === amount &&
        refunds?.has_more === false &&
        exactRefunds.length > 0 &&
        refundIds.length === exactRefunds.length &&
        new Set(refundIds).size === refundIds.length &&
        allRefundRowsExact &&
        succeededRefunds.length > 0 &&
        succeededAmount === amount &&
        providerPaymentIntentId !== null &&
        providerInvoiceId !== null;
      return {
        externalSubscriptionId: evidence.subscription,
        ...(fullRefund ? { lifecycleOverride: 'refunded' as const } : {}),
        ...(fullRefund
          ? {
              financialRestrictionEvidence: succeededRefunds.map(
                ({ refund, providerRefundId }) => ({
                  kind: 'refund' as const,
                  providerRestrictionId: providerRefundId as string,
                  providerChargeId: input.providerObjectId,
                  providerPaymentIntentId: providerPaymentIntentId as string,
                  providerInvoiceId: providerInvoiceId as string,
                  externalSubscriptionId: evidence.subscription as string,
                  eventState: 'opened' as const,
                  providerChargeAmount: 1499 as const,
                  restrictionAmount: refund.amount as number,
                  currency: 'usd' as const,
                }),
              ),
            }
          : {}),
        requiresAttention: !fullRefund,
      };
    }
    if (input.eventType.startsWith('refund.')) {
      const refund = await this.transport.get({
        path: `/v1/refunds/${encodeURIComponent(input.providerObjectId)}`,
      });
      const charge = safeText(refund.charge);
      if (charge === undefined) return null;
      const evidence = await chargeEvidence(charge);
      if (evidence.subscription === null) return null;
      const status = safeText(refund.status);
      const failedRefund = status === 'failed';
      const canceledRefund = status === 'canceled';
      const terminalRefund = failedRefund || canceledRefund;
      const chargeAmount = evidence.charge.amount;
      const paymentIntentReference = Object.hasOwn(refund, 'payment_intent')
        ? refund.payment_intent
        : undefined;
      const exactRefund =
        refund.object === 'refund' &&
        safeText(refund.id) === input.providerObjectId &&
        refund.livemode === (this.configuration.environment === 'production') &&
        chargeAmount === 1499 &&
        evidence.charge.currency === 'usd' &&
        refund.currency === 'usd' &&
        typeof refund.amount === 'number' &&
        Number.isSafeInteger(refund.amount) &&
        refund.amount >= 1 &&
        refund.amount <= chargeAmount &&
        evidence.providerPaymentIntentId !== null &&
        (paymentIntentReference === null ||
          safeText(paymentIntentReference) === evidence.providerPaymentIntentId);
      const fullRefund =
        status === 'succeeded' &&
        exactRefund &&
        refund.amount === chargeAmount &&
        evidence.charge.refunded === true &&
        evidence.charge.amount_refunded === evidence.charge.amount;
      const restrictionState =
        (status === 'succeeded' || status === 'pending' || status === 'requires_action') &&
        exactRefund
          ? ('opened' as const)
          : terminalRefund && exactRefund
            ? ('cleared' as const)
            : undefined;
      return {
        externalSubscriptionId: evidence.subscription,
        ...(fullRefund ? { lifecycleOverride: 'refunded' as const } : {}),
        ...(failedRefund
          ? { financialResolution: 'refund_failed' as const }
          : canceledRefund
            ? { financialResolution: 'refund_canceled' as const }
            : {}),
        ...(evidence.providerPaymentIntentId === null ||
        evidence.providerInvoiceId === null ||
        restrictionState === undefined
          ? {}
          : {
              financialRestrictionEvidence: [
                {
                  kind: 'refund' as const,
                  providerRestrictionId: providerObjectId(refund),
                  providerChargeId: charge,
                  providerPaymentIntentId: evidence.providerPaymentIntentId,
                  providerInvoiceId: evidence.providerInvoiceId,
                  externalSubscriptionId: evidence.subscription,
                  eventState: restrictionState,
                  providerChargeAmount: 1499 as const,
                  restrictionAmount: refund.amount as number,
                  currency: 'usd' as const,
                  ...(failedRefund
                    ? { resolution: 'refund_failed' as const }
                    : canceledRefund
                      ? { resolution: 'refund_canceled' as const }
                      : {}),
                },
              ],
            }),
        requiresAttention: !fullRefund || terminalRefund,
      };
    }
    if (
      input.eventType === 'charge.dispute.created' ||
      input.eventType === 'charge.dispute.closed'
    ) {
      const dispute = await this.transport.get({
        path: `/v1/disputes/${encodeURIComponent(input.providerObjectId)}`,
      });
      const charge = safeText(dispute.charge);
      if (charge === undefined) return null;
      const evidence = await chargeEvidence(charge);
      const status = safeText(dispute.status);
      const disputePaymentIntentReference = Object.hasOwn(dispute, 'payment_intent')
        ? dispute.payment_intent
        : undefined;
      const disputeExact =
        dispute.object === 'dispute' &&
        safeText(dispute.id) === input.providerObjectId &&
        dispute.livemode === (this.configuration.environment === 'production') &&
        typeof dispute.amount === 'number' &&
        Number.isSafeInteger(dispute.amount) &&
        dispute.amount >= 1 &&
        dispute.amount <= 1499 &&
        dispute.currency === 'usd' &&
        evidence.providerPaymentIntentId !== null &&
        (disputePaymentIntentReference === null ||
          safeText(disputePaymentIntentReference) === evidence.providerPaymentIntentId);
      const restrictionState = !disputeExact
        ? undefined
        : status === 'won' || status === 'prevented' || status === 'warning_closed'
          ? ('cleared' as const)
          : status === 'lost'
            ? ('retained' as const)
            : status === 'warning_needs_response' ||
                status === 'warning_under_review' ||
                status === 'needs_response' ||
                status === 'under_review'
              ? ('opened' as const)
              : undefined;
      return evidence.subscription === null
        ? null
        : {
            externalSubscriptionId: evidence.subscription,
            ...(restrictionState === 'opened' || restrictionState === 'retained'
              ? { lifecycleOverride: 'disputed' as const }
              : {}),
            ...(status === 'won'
              ? { financialResolution: 'provider_dispute_won' as const }
              : status === 'prevented'
                ? { financialResolution: 'provider_dispute_prevented' as const }
                : status === 'warning_closed'
                  ? { financialResolution: 'provider_dispute_warning_closed' as const }
                  : status === 'lost'
                    ? { financialResolution: 'provider_dispute_lost' as const }
                    : {}),
            ...(evidence.providerPaymentIntentId === null ||
            evidence.providerInvoiceId === null ||
            restrictionState === undefined
              ? {}
              : {
                  financialRestrictionEvidence: [
                    {
                      kind: 'dispute' as const,
                      providerRestrictionId: providerObjectId(dispute),
                      providerChargeId: charge,
                      providerPaymentIntentId: evidence.providerPaymentIntentId,
                      providerInvoiceId: evidence.providerInvoiceId,
                      externalSubscriptionId: evidence.subscription,
                      eventState: restrictionState,
                      providerChargeAmount: 1499 as const,
                      restrictionAmount: dispute.amount as number,
                      currency: 'usd' as const,
                      ...(status === 'won'
                        ? { resolution: 'provider_dispute_won' as const }
                        : status === 'prevented'
                          ? { resolution: 'provider_dispute_prevented' as const }
                          : status === 'warning_closed'
                            ? { resolution: 'provider_dispute_warning_closed' as const }
                            : status === 'lost'
                              ? { resolution: 'provider_dispute_lost' as const }
                              : {}),
                    },
                  ],
                }),
            requiresAttention: true,
          };
    }
    return null;
  }
}

/** Compatibility wrapper for deterministic test fixtures; runtime code uses StripeAdapter. */
export class StripeTestAdapter extends StripeAdapter {
  constructor(
    transport: StripeTransport,
    authorization: CommerceAuthorizationPort,
    allowedOrigins: ReadonlySet<string>,
    apiVersion: string,
  ) {
    super(transport, authorization, allowedOrigins, {
      environment: 'test',
      accountId: 'acct_fixture1234',
      apiVersion,
      portalConfigurationId: 'bpc_cancel_only_fixture',
      offer: {
        offerId: 'founding_family_monthly_v1',
        planVersionId: 'family_v1',
        billingInterval: 'month',
        providerProductId: 'prod_family_fixture',
        providerPriceId: 'price_family_month_fixture',
        currency: 'usd',
        unitAmountMinor: 1499,
        quantity: 1,
      },
    });
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
