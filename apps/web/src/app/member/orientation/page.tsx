import MemberOrientationPageClient from './page-client';
import { protectProductionMemberResource } from '../../../lib/resource-auth';

export default async function MemberOrientationPage() {
  await protectProductionMemberResource();
  return <MemberOrientationPageClient />;
}
