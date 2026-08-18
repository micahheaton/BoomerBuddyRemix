import type { Metadata } from 'next';
import { cssVariableText } from '@boomerbuddy/design';
import { IdentityProvider } from '../components/identity-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoomerBuddy — a calmer next step',
  description: 'A calm way to check suspicious messages and involve people you trust.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVariableText() }} />
      </head>
      <body>
        <IdentityProvider>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          {children}
        </IdentityProvider>
      </body>
    </html>
  );
}
