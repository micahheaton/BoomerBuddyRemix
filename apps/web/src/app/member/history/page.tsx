import MemberHistoryPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function MemberHistoryPage() {
  await protectProductionMemberResource();
  return <MemberHistoryPageClient />;
}
