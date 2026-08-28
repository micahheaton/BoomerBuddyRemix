import type { Metadata } from 'next';
import MemberOrientationPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export const metadata: Metadata = {
  title: 'Orientation, Learn and updates | BoomerBuddy',
};

export default async function MemberOrientationPage() {
  await protectProductionMemberResource();
  return <MemberOrientationPageClient />;
}
