import MemberBillingPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function MemberBillingPage() {
  await protectProductionMemberResource();
  return <MemberBillingPageClient />;
}
