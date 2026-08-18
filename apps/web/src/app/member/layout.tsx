import { MemberGate } from '../../components/member-gate';

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const production = process.env.NODE_ENV === 'production';
  return (
    <MemberGate>
      <p className="dev-banner">
        {production
          ? 'Private Founding Household beta · Rules-only analysis is not calibrated efficacy evidence · Do not enter secrets'
          : 'Local development build · Local rules-only analysis · No live reputation provider · Do not enter secrets'}
      </p>
      {children}
    </MemberGate>
  );
}
