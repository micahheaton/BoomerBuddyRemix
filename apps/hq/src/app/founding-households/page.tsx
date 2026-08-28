import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function FoundingHouseholdsPage() {
  await protectProductionHqResource();
  return <HqScreen view="founding-households" />;
}
