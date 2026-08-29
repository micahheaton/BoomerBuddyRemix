'use client';

import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../../components/public-shell';

function DevelopmentSignUp() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Development access</span>
        <h1 className="page-title">Production account creation is disabled locally</h1>
        <p className="lede">
          Local development uses fictional seeded people. Open the development sign-in page to
          choose one; no email, social account, trial, or payment is involved.
        </p>
        <Link className="button button-primary" href="/sign-in">
          Open development sign in
        </Link>
      </main>
      <PublicFooter />
    </>
  );
}

function ProductionSignUp() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <>
        <PublicHeader />
        <main id="main-content" className="page-shell narrow">
          <span className="eyebrow">BoomerBuddy account</span>
          <h1 className="page-title">Account creation is temporarily unavailable</h1>
          <p className="error" role="alert">
            No account, trial, or payment was created. Try again later or{' '}
            <Link href="/support">contact support</Link>.
          </p>
        </main>
        <PublicFooter />
      </>
    );
  }

  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">BoomerBuddy account</span>
        <h1 className="page-title">Create your BoomerBuddy account</h1>
        <p className="lede">
          Creating and verifying an account is free. It does not start a trial or charge you. After
          sign-up, preview the safety lessons and Check experience before choosing whether to review
          a paid plan.
        </p>
        <div className="notice">
          <strong>Before any annual trial begins:</strong> secure Checkout shows seven days free,
          the exact first-charge date, and $149.90 per year unless canceled before the trial ends.
        </div>
        <div className="card" style={{ marginTop: '2rem', display: 'grid', placeItems: 'center' }}>
          <ClerkLoading>
            <p className="help" role="status">
              Loading secure account creation...
            </p>
          </ClerkLoading>
          <ClerkFailed>
            <p className="error" role="alert">
              The secure account-creation form could not load. Reload this page or contact support.
            </p>
          </ClerkFailed>
          <ClerkLoaded>
            <SignUp
              path="/sign-up"
              routing="path"
              forceRedirectUrl="/member"
              signInUrl="/sign-in"
              signInForceRedirectUrl="/member"
              fallback={
                <p className="help" role="status">
                  Loading secure account creation...
                </p>
              }
            />
          </ClerkLoaded>
        </div>
        <p className="help">
          Already have an account? <Link href="/sign-in">Sign in</Link>. For current privacy and
          billing terms, review <Link href="/privacy">Privacy</Link> and{' '}
          <Link href="/billing-terms">Billing terms</Link>.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}

export default function SignUpPage() {
  return process.env.NODE_ENV === 'production' ? <ProductionSignUp /> : <DevelopmentSignUp />;
}
