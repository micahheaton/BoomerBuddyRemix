import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export default function SignInLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
