import BillingSuccessPageClient from './page-client';
import { protectProductionMemberResource } from '../../../../lib/resource-auth';

export default async function BillingSuccessPage() {
  await protectProductionMemberResource();
  return <BillingSuccessPageClient />;
}
