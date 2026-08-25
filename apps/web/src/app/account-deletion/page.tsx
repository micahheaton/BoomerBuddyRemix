import Link from 'next/link';
import { PolicyPage, PolicySection } from '../../components/policy-page';

export default function AccountDeletionPage() {
  return (
    <PolicyPage
      eyebrow="Account deletion"
      title="Request account and data deletion"
      summary="A member may request deletion without giving another household participant control over that member's privacy choice."
    >
      <PolicySection title="Start a request">
        <p>
          From the email address used for your BoomerBuddy identity, email{' '}
          <a href="mailto:support@boomerbuddy.net?subject=Account%20deletion%20request">
            support@boomerbuddy.net
          </a>{' '}
          with the subject &quot;Account deletion request.&quot; Do not include passwords,
          verification codes, payment card details, safe words, or submitted Check content.
        </p>
      </PolicySection>
      <PolicySection title="Verification and what the request covers">
        <p>
          We verify the requesting identity and explain the affected account, household access,
          Check history, support records, and subscription state before executing deletion. One
          adult cannot delete another adult&apos;s identity or independent consent record merely by
          being a household administrator or payer.
        </p>
      </PolicySection>
      <PolicySection title="Records that may remain">
        <p>
          Minimal payment, security, fraud-prevention, consent, dispute, and request records may be
          retained when needed for legal obligations or to protect the service. Retained records are
          restricted and are not used to restore deleted product content.
        </p>
      </PolicySection>
      <PolicySection title="Subscription and privacy questions">
        <p>
          Deletion does not silently leave an unwanted renewal active. We reconcile cancellation and
          access as part of the request. Read the <Link href="/privacy">privacy notice</Link> or{' '}
          <Link href="/support">contact support</Link> with questions.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
