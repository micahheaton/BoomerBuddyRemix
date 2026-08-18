import Link from 'next/link';
import { ProductionHqSignIn } from '../../../components/production-identity';

export default function HqSignInPage() {
  if (process.env.NODE_ENV !== 'production') {
    return (
      <main id="hq-main" className="sign-in-shell">
        <div className="sign-in-card">
          <h1>Local HQ sign in</h1>
          <p>Development personas are available only on the local HQ home page.</p>
          <Link href="/">Return to local HQ</Link>
        </div>
      </main>
    );
  }

  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main id="hq-main" className="sign-in-shell">
        <div className="sign-in-card">
          <span className="seed-label">Access closed</span>
          <h1>HQ identity is not configured</h1>
          <p className="error" role="alert">
            BoomerBuddy HQ remains unavailable until the separate Clerk HQ application and exact
            founder binding are configured.
          </p>
        </div>
      </main>
    );
  }

  return <ProductionHqSignIn />;
}
