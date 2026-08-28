import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function SupportPage() {
  await protectProductionHqResource();
  return <HqScreen view="support" />;
}
