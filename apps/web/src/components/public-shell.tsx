import Link from 'next/link';
import { Brand } from './brand';

export function PublicHeader() {
  const navigation = (
    <>
      <Link href="/how-it-works">How it works</Link>
      <Link href="/learn">Learn</Link>
      <Link href="/pricing">Family</Link>
      <Link href="/trust">Trust</Link>
      <Link href="/check">Free Check</Link>
      <Link href="/sign-in">Sign in</Link>
      <Link className="button button-primary" href="/sign-up">
        Create account
      </Link>
    </>
  );

  return (
    <>
      <p className="dev-banner">
        Account creation is free - A trial starts only after secure checkout
      </p>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="public-nav public-nav-desktop" aria-label="Main navigation">
            {navigation}
          </nav>
          <details className="public-nav-menu">
            <summary>Menu</summary>
            <nav className="public-nav" aria-label="Main navigation">
              {navigation}
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="page-shell" style={{ paddingBlock: '1.2rem' }}>
        <strong>BoomerBuddy</strong>
        <p>
          Analysis can be wrong. If money, accounts, or safety are at risk, pause and contact the
          organization using an independently verified number.
        </p>
        <nav className="public-nav" aria-label="Policies and support">
          <Link href="/support">Support</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/billing-terms">Billing terms</Link>
          <Link href="/accessibility">Accessibility</Link>
          <Link href="/account-deletion">Account deletion</Link>
        </nav>
      </div>
    </footer>
  );
}
