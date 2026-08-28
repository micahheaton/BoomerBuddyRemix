export type CommerceProviderEnvironment = 'test' | 'sandbox' | 'production';

export const stripeFailedPaymentEventTypes = [
  'invoice.payment_failed',
  'invoice.payment_action_required',
] as const;

export function isStripeFailedPaymentEventType(eventType: string): boolean {
  return stripeFailedPaymentEventTypes.some((candidate) => candidate === eventType);
}

export type StripeOfferId =
  | 'founding_family_monthly_v1'
  | 'family_monthly_v2'
  | 'family_annual_v2'
  | 'individual_monthly_v1'
  | 'individual_annual_v1';

export interface StripeOffer {
  readonly offerId: StripeOfferId;
  readonly planVersionId: 'family_v1' | 'family_v3' | 'individual_v3';
  readonly plan: 'family' | 'individual';
  readonly displayName: 'Family' | 'Individual';
  readonly billingInterval: 'month' | 'year';
  readonly providerProductId: string;
  readonly providerPriceId: string;
  readonly currency: 'usd';
  readonly unitAmountMinor: 899 | 1499 | 8990 | 14990;
  readonly quantity: 1;
  readonly trialPeriodDays: 0 | 7;
  readonly customerSelectable: boolean;
  readonly defaultAcquisitionOffer: boolean;
}

/** Kept as a compatibility alias while the v1 monthly offer remains readable. */
export type StripeFoundingOffer = StripeOffer;

export interface CommerceActor {
  readonly personId: string;
  readonly householdId: string;
  readonly billingAuthorityId: string;
  readonly resolvedAt: Date;
}

export type CommerceAction = 'checkout:create' | 'portal:create';

export interface CommerceAuthorizationPort {
  readonly authorize: (input: {
    readonly actor: CommerceActor;
    readonly action: CommerceAction;
    readonly planVersionId?: string;
  }) => Promise<{ readonly allowed: boolean; readonly reason: string }>;
}

export interface CommerceSession {
  readonly provider: 'stripe';
  readonly environment: 'test' | 'production';
  readonly id: string;
  readonly url: string;
  readonly expiresAt?: Date;
}

export interface CommerceCheckoutPort {
  readonly createCheckout: (input: {
    readonly actor: CommerceActor;
    /** Server-created canonical subscription; never accepted from an untrusted client. */
    readonly canonicalSubscriptionId: string;
    readonly offerId: StripeOfferId;
    readonly customerReference?: string;
    readonly planVersionId: string;
    readonly providerPriceId: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly idempotencyKey: string;
    /** Buffered provider expiry; `expiresAt` remains accepted for old deterministic fixtures. */
    readonly providerExpiresAt?: Date;
    readonly expiresAt?: Date;
  }) => Promise<CommerceSession>;
}

export interface CommercePortalPort {
  readonly createPortal: (input: {
    readonly actor: CommerceActor;
    readonly providerCustomerId: string;
    readonly providerConfigurationId: string;
    readonly returnUrl: string;
    readonly idempotencyKey: string;
  }) => Promise<CommerceSession>;
}

export type NormalizedCommerceLifecycle =
  | 'pending'
  | 'trialing'
  | 'active'
  | 'grace'
  | 'delinquent'
  | 'paused'
  | 'hold'
  | 'cancel_at_period_end'
  | 'canceled'
  | 'expired'
  | 'refunded'
  | 'disputed'
  | 'restored';

export interface NormalizedProviderCommerceEvent {
  readonly provider: 'stripe' | 'apple' | 'google';
  readonly environment: CommerceProviderEnvironment;
  readonly externalEventId: string;
  readonly eventType: string;
  readonly providerApiVersion: string;
  readonly providerObjectId: string;
  readonly externalSubscriptionId?: string;
  readonly providerCustomerId?: string;
  readonly providerPaymentIntentId?: string;
  readonly checkoutCompletion?: {
    readonly sessionStatus: 'complete';
    readonly paymentStatus: 'paid' | 'no_payment_required';
    readonly amountTotal: number;
    readonly currency: 'usd';
    readonly paymentMethodCollection: 'always';
    readonly offerId: StripeOfferId;
    readonly providerExpiresAt: Date;
  };
  readonly checkoutExpiration?: {
    readonly sessionStatus: 'expired';
    readonly paymentStatus: 'unpaid';
    readonly mode: 'subscription';
    readonly amountTotal: number;
    readonly currency: 'usd';
    readonly providerExpiresAt: Date;
  };
  readonly providerPriceId?: string;
  readonly providerProductId?: string;
  readonly providerSubscriptionItemId?: string;
  readonly subscriptionOfferExact?: true;
  readonly offerId?: StripeOfferId;
  readonly unitAmountMinor?: number;
  readonly billingInterval?: 'month' | 'year';
  readonly trialStartsAt?: Date;
  readonly trialEndsAt?: Date;
  readonly paymentMethodPresent?: true;
  readonly currentPeriodStartsAt?: Date;
  readonly currentPeriodEndsAt?: Date;
  /** Signed provider metadata. Persistence must still validate every field against its own rows. */
  readonly canonicalBinding?: {
    readonly householdId: string;
    readonly subscriptionId: string;
    readonly planVersionId: string;
  };
  readonly eventCreatedAt: Date;
  readonly lifecycle?: NormalizedCommerceLifecycle;
  readonly requiresReconciliation: boolean;
  readonly acknowledgementRequired: boolean;
}

export interface ProviderPaidPeriodEvidence {
  readonly offerId: StripeOfferId;
  readonly providerInvoiceId: string;
  readonly externalSubscriptionId: string;
  readonly providerSubscriptionItemId: string;
  readonly providerInvoiceLineId: string;
  readonly providerInvoicePaymentId: string;
  readonly providerProductId: string;
  readonly providerPaymentIntentId: string;
  readonly providerPriceId: string;
  readonly billingReason: 'subscription_create' | 'subscription_cycle';
  readonly amountPaid: number;
  readonly amountRemaining: 0;
  readonly currency: 'usd';
  readonly quantity: 1;
  readonly discountAmount: 0;
  readonly taxAmount: 0;
  readonly invoiceDiscountsEmpty: true;
  readonly invoiceTaxesEmpty: true;
  readonly invoiceCreditsEmpty: true;
  readonly providerPaidAt: Date;
  readonly currentPeriodStartsAt: Date;
  readonly currentPeriodEndsAt: Date;
}

export interface ProviderFailedPaymentEvidence {
  readonly offerId: StripeOfferId;
  readonly providerInvoiceId: string;
  readonly externalSubscriptionId: string;
  readonly providerSubscriptionItemId: string;
  readonly providerInvoiceLineId: string;
  readonly providerInvoicePaymentId: string;
  readonly providerProductId: string;
  readonly providerPaymentIntentId?: string;
  readonly providerPriceId: string;
  readonly billingReason: 'subscription_create' | 'subscription_cycle';
  readonly amountDue: number;
  readonly currency: 'usd';
  readonly quantity: 1;
  readonly attemptCount: number;
  readonly failureStatus: 'requires_payment_method' | 'requires_action' | 'canceled' | 'failed';
  readonly lineProration: false;
  readonly currentPeriodStartsAt: Date;
  readonly currentPeriodEndsAt: Date;
}

export interface StripePreflightEvidence {
  readonly environment: 'test' | 'production';
  readonly accountId: string;
  readonly accountChargesEnabled: boolean;
  readonly accountPayoutsEnabled: boolean;
  readonly accountCountry: string | null;
  readonly accountBusinessType: string | null;
  readonly livemode: boolean;
  readonly apiVersion: string;
  readonly offer: StripeOffer;
  readonly portalConfigurationId: string;
  readonly productActive: true;
  readonly priceActive: true;
  readonly portalCancelOnly: true;
  readonly portalMutationControlsExact: true;
  readonly portalCancellationMode: 'at_period_end';
  readonly portalProrationBehavior: 'none';
  readonly portalSubscriptionUpdateDefaultsEmpty: true;
  readonly portalPaymentMethodUpdateEnabled: true;
  readonly portalInvoiceHistoryEnabled: true;
  readonly retentionCouponEvidence: 'manual_founder_browser_required';
  readonly promotionsEnabled: false;
  readonly automaticTaxEnabled: false;
  readonly adaptivePricingEnabled: false;
}

interface ProviderFinancialRestrictionEvidenceBase {
  readonly providerRestrictionId: string;
  readonly providerChargeId: string;
  readonly providerPaymentIntentId: string;
  readonly providerInvoiceId: string;
  readonly externalSubscriptionId: string;
  readonly providerChargeAmount: number;
  readonly restrictionAmount: number;
  readonly currency: 'usd';
  readonly eventState: 'opened' | 'cleared' | 'retained';
  readonly resolution?:
    | 'provider_dispute_won'
    | 'provider_dispute_prevented'
    | 'provider_dispute_warning_closed'
    | 'provider_dispute_lost'
    | 'refund_failed'
    | 'refund_canceled';
}

export type ProviderFinancialRestrictionEvidence =
  | (ProviderFinancialRestrictionEvidenceBase & { readonly kind: 'refund' })
  | (ProviderFinancialRestrictionEvidenceBase & { readonly kind: 'dispute' });

export interface StripeInventoryPage {
  readonly pageNumber: number;
  readonly requestCursor?: string;
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly subscriptions: readonly {
    readonly externalSubscriptionId: string;
    readonly lifecycle: NormalizedCommerceLifecycle;
  }[];
}

export interface StripeInventoryPort {
  readonly fetchSubscriptionInventory: (input: {
    readonly environment: 'test' | 'production';
    readonly onPage: (page: StripeInventoryPage) => Promise<void>;
  }) => Promise<{
    readonly verifiedAccountId: string;
    readonly pages: readonly StripeInventoryPage[];
  }>;
}

export interface ProviderReconciliationPort {
  readonly resolveEventSubscription: (input: {
    readonly environment: CommerceProviderEnvironment;
    readonly eventType: string;
    readonly providerObjectId: string;
  }) => Promise<{
    readonly externalSubscriptionId: string;
    readonly paidPeriodEvidence?: ProviderPaidPeriodEvidence;
    readonly failedPaymentEvidence?: ProviderFailedPaymentEvidence;
    readonly lifecycleOverride?: Extract<NormalizedCommerceLifecycle, 'refunded' | 'disputed'>;
    readonly financialResolution?:
      | 'provider_dispute_won'
      | 'provider_dispute_prevented'
      | 'provider_dispute_warning_closed'
      | 'provider_dispute_lost'
      | 'refund_failed'
      | 'refund_canceled';
    readonly financialRestrictionEvidence?: readonly ProviderFinancialRestrictionEvidence[];
    readonly requiresAttention: boolean;
  } | null>;
  readonly retrieveSubscription: (input: {
    readonly environment: CommerceProviderEnvironment;
    readonly externalSubscriptionId: string;
    readonly observedAt: Date;
  }) => Promise<NormalizedProviderCommerceEvent>;
}

export interface StripePreflightPort {
  readonly verifyConfiguredResources: (offerId?: StripeOfferId) => Promise<StripePreflightEvidence>;
}
