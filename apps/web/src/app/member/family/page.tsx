import FamilyPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function FamilyPage() {
  await protectProductionMemberResource();
  return <FamilyPageClient />;
}
