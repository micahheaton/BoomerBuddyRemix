import MemberCheckPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function MemberCheckPage() {
  await protectProductionMemberResource();
  return <MemberCheckPageClient />;
}
