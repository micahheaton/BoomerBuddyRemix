import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function PrivacyPage() {
  await protectProductionHqResource();
  return <HqScreen view="privacy" />;
}
