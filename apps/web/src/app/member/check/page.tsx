import type { Metadata } from 'next';
import MemberCheckPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export const metadata: Metadata = {
  title: 'Check something suspicious | BoomerBuddy',
};

export default async function MemberCheckPage() {
  await protectProductionMemberResource();
  return <MemberCheckPageClient />;
}
