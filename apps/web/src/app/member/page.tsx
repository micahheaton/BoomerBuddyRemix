import MemberPageClient from './page-client';
import { protectProductionMemberResource } from '../../lib/resource-auth';

export default async function MemberPage() {
  await protectProductionMemberResource();
  return <MemberPageClient />;
}
