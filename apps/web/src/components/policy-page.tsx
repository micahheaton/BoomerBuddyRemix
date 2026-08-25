import type { ReactNode } from 'react';
import { PublicFooter, PublicHeader } from './public-shell';

export function PolicyPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="page-title">{title}</h1>
        <p className="lede">{summary}</p>
        <p className="help">Effective August 25, 2026. Last updated August 25, 2026.</p>
        <div className="form-stack" style={{ marginTop: '2rem' }}>
          {children}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
