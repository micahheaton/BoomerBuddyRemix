import { HqScreen } from '../../components/hq-screen';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function StripeControlPage() {
  await protectProductionHqResource();
  return <HqScreen view="stripe-control" />;
}
