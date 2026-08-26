import type { Metadata } from 'next';
import { MemberGate } from '../../components/member-gate';

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

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <MemberGate>
      <p className="dev-banner">
        Early access - Results can be wrong - Never enter passwords, access codes, or payment
        information
      </p>
      {children}
    </MemberGate>
  );
}
