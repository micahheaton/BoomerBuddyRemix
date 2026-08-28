import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function AccessIntentsPage() {
  await protectProductionHqResource();
  return <HqScreen view="access-intents" />;
}
