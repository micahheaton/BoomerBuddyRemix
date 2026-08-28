import { protectProductionMemberResource } from '../../../lib/resource-auth';
import MemberProtectionPageClient from './page-client';

export default async function MemberProtectionPage() {
  await protectProductionMemberResource();
  return <MemberProtectionPageClient />;
}
