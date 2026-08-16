import { HouseholdProvider, HouseholdScopeBanner } from './household-context';
import { MemberHeader } from './member-shell';

export function MemberGate({ children }: { children: React.ReactNode }) {
  return (
    <HouseholdProvider>
      <MemberHeader />
      <HouseholdScopeBanner />
      {children}
      <footer className="site-footer">
        <div className="member-shell">
          <strong>Not emergency or financial advice.</strong> Verify through an independently found
          official channel.
        </div>
      </footer>
    </HouseholdProvider>
  );
}
