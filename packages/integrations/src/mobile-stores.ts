import type {
  CommerceProviderEnvironment,
  NormalizedCommerceLifecycle,
  NormalizedProviderCommerceEvent,
} from './commerce';

export interface StoreVerificationResult {
  readonly verified: boolean;
  readonly keyId?: string;
  readonly algorithm?: string;
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly errorCode?: string;
}

export interface StoreServerEventVerifier {
  readonly provider: 'apple' | 'google';
  readonly verify: (input: {
    readonly environment: CommerceProviderEnvironment;
    readonly signedPayload: string;
  }) => Promise<StoreVerificationResult>;
}

export interface AppleServerEventContract {
  readonly notificationUUID: string;
  readonly notificationType: string;
  readonly subtype?: string;
  readonly signedDate: Date;
  readonly originalTransactionId: string;
  readonly transactionId: string;
  readonly expiresAt?: Date;
  readonly revokedAt?: Date;
  readonly environment: CommerceProviderEnvironment;
}

export interface GoogleServerEventContract {
  readonly messageId: string;
  readonly notificationType: string;
  readonly eventTime: Date;
  readonly purchaseToken: string;
  readonly subscriptionId: string;
  readonly environment: CommerceProviderEnvironment;
  readonly acknowledgementRequired: boolean;
}

export interface MobileStoreServerAdapter<Event> {
  readonly verifyAndNormalize: (input: {
    readonly environment: CommerceProviderEnvironment;
    readonly signedPayload: string;
  }) => Promise<{ readonly event: Event; readonly normalized: NormalizedProviderCommerceEvent }>;
}

export class StoreServerEventError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StoreServerEventError';
  }
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new StoreServerEventError(code);
  return value;
}

function optionalDate(value: unknown, code: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const milliseconds = typeof value === 'number' ? value : Number(value);
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new StoreServerEventError(code);
  return date;
}

function appleLifecycle(type: string, subtype?: string): NormalizedCommerceLifecycle | undefined {
  if (type === 'DID_RENEW') return 'active';
  if (type === 'DID_FAIL_TO_RENEW') return subtype === 'GRACE_PERIOD' ? 'grace' : 'delinquent';
  if (type === 'GRACE_PERIOD_EXPIRED') return 'expired';
  if (type === 'EXPIRED') return 'expired';
  if (type === 'REFUND' || type === 'REVOKE') return 'refunded';
  if (type === 'DID_CHANGE_RENEWAL_STATUS' && subtype === 'AUTO_RENEW_DISABLED') {
    return 'cancel_at_period_end';
  }
  if (type === 'SUBSCRIBED' || type === 'OFFER_REDEEMED') return 'active';
  return undefined;
}

export class AppleServerAdapter implements MobileStoreServerAdapter<AppleServerEventContract> {
  constructor(private readonly verifier: StoreServerEventVerifier) {
    if (verifier.provider !== 'apple') throw new StoreServerEventError('apple.verifier_mismatch');
  }

  async verifyAndNormalize(input: {
    readonly environment: CommerceProviderEnvironment;
    readonly signedPayload: string;
  }): Promise<{
    readonly event: AppleServerEventContract;
    readonly normalized: NormalizedProviderCommerceEvent;
  }> {
    const result = await this.verifier.verify(input);
    if (!result.verified || result.claims === undefined) {
      throw new StoreServerEventError(result.errorCode ?? 'apple.signature_unverified');
    }
    const claims = result.claims;
    const type = requiredText(claims.notificationType, 'apple.notification_type_missing');
    const subtype = typeof claims.subtype === 'string' ? claims.subtype : undefined;
    const event: AppleServerEventContract = {
      notificationUUID: requiredText(claims.notificationUUID, 'apple.notification_id_missing'),
      notificationType: type,
      ...(subtype === undefined ? {} : { subtype }),
      signedDate:
        optionalDate(claims.signedDate, 'apple.signed_date_invalid') ?? new Date(Number.NaN),
      originalTransactionId: requiredText(
        claims.originalTransactionId,
        'apple.original_transaction_missing',
      ),
      transactionId: requiredText(claims.transactionId, 'apple.transaction_missing'),
      ...(optionalDate(claims.expiresDate, 'apple.expiry_invalid') === undefined
        ? {}
        : { expiresAt: optionalDate(claims.expiresDate, 'apple.expiry_invalid') as Date }),
      ...(optionalDate(claims.revocationDate, 'apple.revocation_invalid') === undefined
        ? {}
        : { revokedAt: optionalDate(claims.revocationDate, 'apple.revocation_invalid') as Date }),
      environment: input.environment,
    };
    if (!Number.isFinite(event.signedDate.getTime())) {
      throw new StoreServerEventError('apple.signed_date_missing');
    }
    const lifecycle = appleLifecycle(type, subtype);
    return {
      event,
      normalized: {
        provider: 'apple',
        environment: input.environment,
        externalEventId: event.notificationUUID,
        eventType: subtype === undefined ? type : `${type}.${subtype}`,
        providerApiVersion: 'app-store-server-notifications-v2',
        providerObjectId: event.transactionId,
        externalSubscriptionId: event.originalTransactionId,
        eventCreatedAt: event.signedDate,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        requiresReconciliation: lifecycle === undefined,
        acknowledgementRequired: false,
      },
    };
  }
}

function googleLifecycle(type: string): NormalizedCommerceLifecycle | undefined {
  const states: Readonly<Record<string, NormalizedCommerceLifecycle>> = {
    SUBSCRIPTION_RECOVERED: 'restored',
    SUBSCRIPTION_RENEWED: 'active',
    SUBSCRIPTION_CANCELED: 'cancel_at_period_end',
    SUBSCRIPTION_PURCHASED: 'active',
    SUBSCRIPTION_ON_HOLD: 'hold',
    SUBSCRIPTION_IN_GRACE_PERIOD: 'grace',
    SUBSCRIPTION_RESTARTED: 'restored',
    SUBSCRIPTION_REVOKED: 'refunded',
    SUBSCRIPTION_EXPIRED: 'expired',
    SUBSCRIPTION_PAUSED: 'paused',
  };
  return states[type];
}

export class GoogleServerAdapter implements MobileStoreServerAdapter<GoogleServerEventContract> {
  constructor(private readonly verifier: StoreServerEventVerifier) {
    if (verifier.provider !== 'google') throw new StoreServerEventError('google.verifier_mismatch');
  }

  async verifyAndNormalize(input: {
    readonly environment: CommerceProviderEnvironment;
    readonly signedPayload: string;
  }): Promise<{
    readonly event: GoogleServerEventContract;
    readonly normalized: NormalizedProviderCommerceEvent;
  }> {
    const result = await this.verifier.verify(input);
    if (!result.verified || result.claims === undefined) {
      throw new StoreServerEventError(result.errorCode ?? 'google.signature_unverified');
    }
    const claims = result.claims;
    const eventTime = optionalDate(claims.eventTimeMillis, 'google.event_time_invalid');
    if (eventTime === undefined) throw new StoreServerEventError('google.event_time_missing');
    const event: GoogleServerEventContract = {
      messageId: requiredText(claims.messageId, 'google.message_id_missing'),
      notificationType: requiredText(claims.notificationType, 'google.notification_type_missing'),
      eventTime,
      purchaseToken: requiredText(claims.purchaseToken, 'google.purchase_token_missing'),
      subscriptionId: requiredText(claims.subscriptionId, 'google.subscription_id_missing'),
      environment: input.environment,
      acknowledgementRequired: claims.acknowledged !== true,
    };
    const lifecycle = googleLifecycle(event.notificationType);
    return {
      event,
      normalized: {
        provider: 'google',
        environment: input.environment,
        externalEventId: event.messageId,
        eventType: event.notificationType,
        providerApiVersion: 'google-play-rtdn-v1',
        providerObjectId: event.purchaseToken,
        externalSubscriptionId: event.purchaseToken,
        eventCreatedAt: event.eventTime,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        requiresReconciliation: true,
        acknowledgementRequired: event.acknowledgementRequired,
      },
    };
  }
}
