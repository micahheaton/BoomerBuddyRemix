import type { Metadata } from 'next';
import MemberPageClient from './page-client';
import { protectProductionMemberResource } from '../../lib/resource-auth';

export const metadata: Metadata = {
  title: 'Member home | BoomerBuddy',
};

export default async function MemberPage() {
  await protectProductionMemberResource();
  return <MemberPageClient />;
}
