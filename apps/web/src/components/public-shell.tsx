import Link from 'next/link';
import { Brand } from './brand';

export function PublicHeader() {
  return (
    <>
      <p className="dev-banner">
        Local development build · Uses seeded people and local rules-only analysis · No live
        reputation provider
      </p>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="public-nav" aria-label="Main navigation">
            <Link href="/how-it-works">How it works</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/trust">Trust</Link>
            <Link className="button button-primary" href="/sign-in">
              Development sign in
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
        <strong>BoomerBuddy local development build</strong>
        <p>
          Analysis can be wrong. If money, accounts, or safety are at risk, pause and contact the
          organization using an independently verified number.
        </p>
      </div>
    </footer>
  );
}
