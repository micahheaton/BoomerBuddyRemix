import type { Metadata } from 'next';
import FamilySafeWordPageClient from './page-client';
import { protectProductionMemberResource } from '../../../../lib/resource-auth';

export const metadata: Metadata = {
  title: 'Family verification aid | BoomerBuddy',
};

export default async function FamilySafeWordPage() {
  await protectProductionMemberResource();
  return <FamilySafeWordPageClient />;
}
