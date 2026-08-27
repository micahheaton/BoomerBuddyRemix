import type { Metadata } from 'next';
import FamilyPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export const metadata: Metadata = {
  title: 'Family and Trusted Circle | BoomerBuddy',
};

export default async function FamilyPage() {
  await protectProductionMemberResource();
  return <FamilyPageClient />;
}
