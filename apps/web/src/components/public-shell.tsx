import Link from 'next/link';
import { Brand } from './brand';

export function PublicHeader() {
  const production = process.env.NODE_ENV === 'production';
  return (
    <>
      <p className="dev-banner">
        {production
          ? 'Private Founding Household beta · Public Check needs no account · Rules-only analysis is not calibrated fraud-detection proof · Never enter secrets'
          : 'Local development build · Public Check needs no account; member access uses seeded people · Local rules-only analysis · No live reputation provider'}
      </p>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="public-nav" aria-label="Main navigation">
            <Link href="/check">Check something</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/trust">Trust</Link>
            <Link className="button button-primary" href="/sign-in">
              {production ? 'Member sign in' : 'Development sign in'}
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}

export function PublicFooter() {
  const production = process.env.NODE_ENV === 'production';
  return (
    <footer className="site-footer">
      <div className="page-shell" style={{ paddingBlock: '1.2rem' }}>
        <strong>
          {production
            ? 'BoomerBuddy private Founding Household beta'
            : 'BoomerBuddy local development build'}
        </strong>
        <p>
          Analysis can be wrong. If money, accounts, or safety are at risk, pause and contact the
          organization using an independently verified number.
        </p>
      </div>
    </footer>
  );
}
