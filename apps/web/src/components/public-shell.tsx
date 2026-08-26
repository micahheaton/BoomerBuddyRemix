import Link from 'next/link';
import { Brand } from './brand';

export function PublicHeader() {
  return (
    <>
      <p className="dev-banner">
        Early access - Public Check needs no account - Results can be wrong - Never enter passwords,
        access codes, or payment information
      </p>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="public-nav" aria-label="Main navigation">
            <Link href="/check">Check something</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/support">Support</Link>
            <Link className="button button-primary" href="/sign-in">
              Member sign in
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="page-shell" style={{ paddingBlock: '1.2rem' }}>
        <strong>BoomerBuddy early access</strong>
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
