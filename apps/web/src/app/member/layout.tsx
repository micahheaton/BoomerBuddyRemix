import { MemberGate } from '../../components/member-gate';

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <MemberGate>
      <p className="dev-banner">
        Local development build · Local rules-only analysis · No live reputation provider · Do not
        enter secrets
      </p>
      {children}
    </MemberGate>
  );
}
