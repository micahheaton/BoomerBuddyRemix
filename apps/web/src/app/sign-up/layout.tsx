import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create an account | BoomerBuddy',
  description:
    'Create a BoomerBuddy account on the web. Account creation alone does not start a trial or charge you.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export default function SignUpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
