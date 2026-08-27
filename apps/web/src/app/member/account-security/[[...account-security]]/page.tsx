import AccountSecurityPageClient from './page-client';
import { protectProductionMemberResource } from '../../../../lib/resource-auth';

export default async function AccountSecurityPage() {
  await protectProductionMemberResource();
  return (
    <AccountSecurityPageClient
      providerAccountSecurityEnabled={
        process.env.BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED === 'true'
      }
    />
  );
}
