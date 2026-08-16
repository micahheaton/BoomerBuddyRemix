export type CommerceProviderEnvironment = 'test' | 'sandbox';

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
  readonly environment: 'test';
  readonly id: string;
  readonly url: string;
  readonly expiresAt?: Date;
}

export interface CommerceCheckoutPort {
  readonly createCheckout: (input: {
    readonly actor: CommerceActor;
    /** Server-created canonical subscription; never accepted from an untrusted client. */
    readonly canonicalSubscriptionId: string;
    readonly customerReference?: string;
    readonly planVersionId: string;
    readonly providerPriceId: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly idempotencyKey: string;
    readonly expiresAt: Date;
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
  readonly providerPriceId?: string;
  readonly billingInterval?: 'month' | 'year';
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
  readonly externalSubscriptionId: string;
  readonly providerPriceId: string;
  readonly currentPeriodStartsAt: Date;
  readonly currentPeriodEndsAt: Date;
}

export interface ProviderReconciliationPort {
  readonly resolveEventSubscription: (input: {
    readonly environment: CommerceProviderEnvironment;
    readonly eventType: string;
    readonly providerObjectId: string;
  }) => Promise<{
    readonly externalSubscriptionId: string;
    readonly paidPeriodEvidence?: ProviderPaidPeriodEvidence;
    readonly lifecycleOverride?: Extract<NormalizedCommerceLifecycle, 'refunded' | 'disputed'>;
    readonly requiresAttention: boolean;
  } | null>;
  readonly retrieveSubscription: (input: {
    readonly environment: CommerceProviderEnvironment;
    readonly externalSubscriptionId: string;
    readonly observedAt: Date;
  }) => Promise<NormalizedProviderCommerceEvent>;
}
