import MemberMessagingPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function MemberMessagingPage() {
  await protectProductionMemberResource();
  return <MemberMessagingPageClient />;
}
