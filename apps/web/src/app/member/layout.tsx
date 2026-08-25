import { MemberGate } from '../../components/member-gate';

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const production = process.env.NODE_ENV === 'production';
  return (
    <MemberGate>
      <p className="dev-banner">
        {production
          ? 'Private beta · Results can be wrong · Never enter passwords, access codes, or payment information'
          : 'Local development build · Local rules-only analysis · No live reputation provider · Do not enter secrets'}
      </p>
      {children}
    </MemberGate>
  );
}
