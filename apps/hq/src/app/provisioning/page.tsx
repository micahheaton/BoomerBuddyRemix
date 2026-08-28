import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function ProvisioningPage() {
  await protectProductionHqResource();
  return <HqScreen view="provisioning" />;
}
