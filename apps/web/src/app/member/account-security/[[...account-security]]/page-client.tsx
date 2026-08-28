'use client';

import Link from 'next/link';
import { UserProfile } from '@clerk/nextjs';

export default function AccountSecurityPageClient({
  providerAccountSecurityEnabled,
}: {
  providerAccountSecurityEnabled: boolean;
}) {
  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Account security</span>
      <h1 className="member-heading">Manage sign-in security</h1>
      <p className="lede">
        Use the Security section below to review enrolled sign-in methods and add an available MFA
        second factor. Google or email sign-in and a trusted device do not count as that second
        factor for billing.
      </p>
      <p className="notice notice-warning">
        BoomerBuddy never asks you to send a password, backup code, authenticator code, or recovery
        code to support. If the identity provider does not offer an MFA method here, do not begin a
        billing action; <Link href="/support">contact support</Link>.
      </p>
      {process.env.NODE_ENV === 'production' && providerAccountSecurityEnabled ? (
        <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
          <UserProfile path="/member/account-security" routing="path">
            <UserProfile.Page label="security" />
          </UserProfile>
        </div>
      ) : process.env.NODE_ENV === 'production' ? (
        <div className="card">
          <h2>Account security setup is temporarily unavailable</h2>
          <p>
            BoomerBuddy has not yet confirmed that the identity provider's direct account-deletion
            control is disabled. The member area stays closed to that broader profile surface so
            deletion cannot bypass BoomerBuddy's protected account-deletion workflow. Do not begin a
            billing action; <Link href="/support">contact support</Link>.
          </p>
        </div>
      ) : (
        <div className="card">
          <p>
            Account security is managed by the production identity provider. Local development
            personas do not have identity-provider MFA settings.
          </p>
        </div>
      )}
    </main>
  );
}
