import Link from 'next/link';
import { PolicyPage, PolicySection } from '../../components/policy-page';

export default function SupportPage() {
  return (
    <PolicyPage
      eyebrow="Customer support"
      title="Get help with BoomerBuddy"
      summary="Use email for account, billing, privacy, accessibility, or product help. BoomerBuddy is not an emergency service."
    >
      <PolicySection title="Contact support">
        <p>
          Email <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>. Include the
          type of help you need, but do not send passwords, verification codes, payment card
          details, safe words, or the full text of a suspicious message.
        </p>
        <p>
          Support is monitored on a best-effort basis during the private beta. We do not promise
          24-hour coverage. For an immediate threat, contact local emergency services. For a bank or
          account problem, use a number from the organization&apos;s official website, statement, or
          card.
        </p>
      </PolicySection>
      <PolicySection title="Billing and account help">
        <p>
          Support can help locate a receipt, explain access status, start cancellation or refund
          review, and begin an account-deletion or privacy request. Support cannot ask for or accept
          your full payment card number.
        </p>
        <p>
          Read the <Link href="/billing-terms">billing terms</Link> or the{' '}
          <Link href="/account-deletion">account-deletion process</Link> before sending a request.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
