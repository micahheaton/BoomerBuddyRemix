import type { Metadata } from 'next';
import { cssVariableText } from '@boomerbuddy/design';
import { IdentityProvider } from '../components/identity-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoomerBuddy HQ - owner control plane',
  description: 'Role-scoped operating evidence for BoomerBuddy owner decisions.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVariableText() }} />
      </head>
      <body>
        <IdentityProvider>
          <a className="skip-link" href="#hq-main">
            Skip to main content
          </a>
          {children}
        </IdentityProvider>
      </body>
    </html>
  );
}
