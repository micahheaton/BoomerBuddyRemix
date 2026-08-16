export type StorePlatform = 'apple' | 'google';

export interface StorefrontPolicy {
  readonly id: string;
  readonly platform: StorePlatform;
  readonly storefront: string;
  readonly jurisdiction: string;
  readonly program: string;
  readonly appVersion: string;
  readonly policyVersion: string;
  readonly checkedAt: Date;
  readonly staleAfter: Date;
  readonly externalPurchaseLinkAllowed: boolean;
  readonly nativePurchaseRequired: boolean;
  readonly accountManagementAllowed: boolean;
  readonly state: 'active' | 'superseded';
}

export interface StorefrontPolicyDecision {
  readonly matchedPolicyId?: string;
  readonly externalPurchaseLinkAllowed: boolean;
  readonly nativePurchaseRequired: boolean;
  readonly accountManagementAllowed: boolean;
  readonly reason:
    'current_explicit_policy' | 'unknown_policy' | 'stale_policy' | 'ambiguous_policy';
}

export function evaluateStorefrontPolicy(input: {
  readonly platform: StorePlatform;
  readonly storefront: string;
  readonly jurisdiction: string;
  readonly program: string;
  readonly appVersion: string;
  readonly policies: readonly StorefrontPolicy[];
  readonly now: Date;
}): StorefrontPolicyDecision {
  const candidates = input.policies
    .filter(
      (policy) =>
        policy.state === 'active' &&
        policy.platform === input.platform &&
        policy.storefront === input.storefront &&
        policy.jurisdiction === input.jurisdiction &&
        policy.program === input.program &&
        policy.appVersion === input.appVersion &&
        policy.checkedAt.getTime() <= input.now.getTime(),
    )
    .sort(
      (left, right) =>
        right.checkedAt.getTime() - left.checkedAt.getTime() || left.id.localeCompare(right.id),
    );
  const selected = candidates[0];
  if (selected === undefined) {
    return {
      externalPurchaseLinkAllowed: false,
      nativePurchaseRequired: true,
      accountManagementAllowed: false,
      reason: 'unknown_policy',
    };
  }
  if (
    candidates[1] !== undefined &&
    candidates[1].checkedAt.getTime() === selected.checkedAt.getTime()
  ) {
    return {
      externalPurchaseLinkAllowed: false,
      nativePurchaseRequired: true,
      accountManagementAllowed: false,
      reason: 'ambiguous_policy',
    };
  }
  if (selected.staleAfter.getTime() <= input.now.getTime()) {
    return {
      matchedPolicyId: selected.id,
      externalPurchaseLinkAllowed: false,
      nativePurchaseRequired: true,
      accountManagementAllowed: false,
      reason: 'stale_policy',
    };
  }
  return {
    matchedPolicyId: selected.id,
    externalPurchaseLinkAllowed: selected.externalPurchaseLinkAllowed,
    nativePurchaseRequired: selected.nativePurchaseRequired,
    accountManagementAllowed: selected.accountManagementAllowed,
    reason: 'current_explicit_policy',
  };
}
