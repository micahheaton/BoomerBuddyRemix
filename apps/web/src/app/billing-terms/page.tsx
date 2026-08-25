import Link from 'next/link';
import { PolicyPage, PolicySection } from '../../components/policy-page';

export default function BillingTermsPage() {
  return (
    <PolicyPage
      eyebrow="Billing terms"
      title="Family monthly subscription"
      summary="The private beta has one paid offer: Family at USD 14.99 per month."
    >
      <PolicySection title="Price and renewal">
        <p>
          Family costs USD 14.99 each month, plus any tax shown before payment. By confirming
          Checkout, the payer authorizes Stripe to charge the selected payment method now and on
          each monthly renewal until cancellation. Stripe Checkout shows the amount and renewal
          terms before confirmation.
        </p>
      </PolicySection>
      <PolicySection title="Who may purchase">
        <p>
          Only a person with current billing authority for the selected household may start or
          manage a subscription. Membership, household administration, protected status, and billing
          authority are separate. Returning from Checkout does not by itself activate paid access.
          BoomerBuddy confirms a completed payment before turning on the membership.
        </p>
      </PolicySection>
      <PolicySection title="Cancellation and access">
        <p>
          You may cancel renewal through the billing-management link when available or by emailing{' '}
          <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>. Unless law or a
          stated refund requires otherwise, access continues through the paid billing period and no
          further renewal is charged.
        </p>
      </PolicySection>
      <PolicySection title="Refunds and payment problems">
        <p>
          Monthly charges are generally not refundable after they are billed. Contact support
          promptly about a duplicate, unauthorized, incorrect, or service-failure charge. We will
          review the charge, tell you the outcome, and issue any approved or legally required refund
          to the original payment method. Canceling stops future renewals but does not by itself
          refund the current paid period. Do not email payment card details.
        </p>
      </PolicySection>
      <PolicySection title="Receipts, processor, and support">
        <p>
          Stripe processes payment. Checkout confirms the amount before payment, and support can
          help locate your payment record afterward. BoomerBuddy confirms payment and subscription
          status before granting paid access. Review the <Link href="/privacy">privacy notice</Link>{' '}
          and contact <Link href="/support">support</Link> for billing help.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
