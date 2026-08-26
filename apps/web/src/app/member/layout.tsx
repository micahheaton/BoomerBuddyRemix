import { MemberGate } from '../../components/member-gate';

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <MemberGate>
      <p className="dev-banner">
        Private beta - Results can be wrong - Never enter passwords, access codes, or payment
        information
      </p>
      {children}
    </MemberGate>
  );
}
