import type { Metadata } from 'next';
import { MemberGate } from '../../components/member-gate';
import { protectProductionMemberResource } from '../../lib/resource-auth';

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

export default async function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await protectProductionMemberResource();
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
