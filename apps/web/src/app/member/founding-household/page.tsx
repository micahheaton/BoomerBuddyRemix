import FoundingHouseholdPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function FoundingHouseholdPage() {
  await protectProductionMemberResource();
  return <FoundingHouseholdPageClient />;
}
