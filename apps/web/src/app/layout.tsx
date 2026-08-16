import type { Metadata } from 'next';
import { cssVariableText } from '@boomerbuddy/design';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoomerBuddy — a calmer next step',
  description:
    'A local development build for checking suspicious messages and involving people you trust.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVariableText() }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
