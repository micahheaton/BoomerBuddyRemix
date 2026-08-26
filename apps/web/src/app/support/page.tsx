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
          If the pricing page gives you an access-intent receipt, leave that code in the email
          subject so an authorized HQ owner can correlate it with the content-free receipt. The code
          expires after seven days. Creating it does not send an email or confirm that support
          received your request.
        </p>
        <p>
          Email is not an emergency channel. Sending a message does not confirm delivery, review, or
          a reply. For an immediate threat, contact local emergency services. For a bank or account
          problem, use a number from the organization&apos;s official website, statement, or card.
        </p>
      </PolicySection>
      <PolicySection title="Billing and account help">
        <p>
          Use the address above to request a receipt lookup, an explanation of access status,
          cancellation or refund review, or the start of an account-deletion or privacy process. Do
          not send your full payment card number.
        </p>
        <p>
          Read the <Link href="/billing-terms">billing terms</Link> or the{' '}
          <Link href="/account-deletion">account-deletion process</Link> before sending a request.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
