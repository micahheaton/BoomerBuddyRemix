import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function BillingAuthorityPage() {
  await protectProductionHqResource();
  return <HqScreen view="billing-authority" />;
}
