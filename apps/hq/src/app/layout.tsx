import type { Metadata } from 'next';
import { cssVariableText } from '@boomerbuddy/design';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoomerBuddy HQ — development operations',
  description: 'Seeded local operating views for BoomerBuddy.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVariableText() }} />
      </head>
      <body>
        <a className="skip-link" href="#hq-main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
