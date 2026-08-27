import type { Metadata } from 'next';
import MemberHistoryPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export const metadata: Metadata = {
  title: 'Check history | BoomerBuddy',
};

export default async function MemberHistoryPage() {
  await protectProductionMemberResource();
  return <MemberHistoryPageClient />;
}
