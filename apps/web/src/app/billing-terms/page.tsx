import Link from 'next/link';
import { PolicyPage, PolicySection } from '../../components/policy-page';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/billing-terms'];

export default function BillingTermsPage() {
  return (
    <PolicyPage
      eyebrow="Billing terms"
      title="Family annual and monthly subscriptions"
      summary="Family annual is seven days free, then USD 149.90 per year unless canceled before the trial ends. Family monthly is USD 14.99 per month with no trial."
    >
      <PolicySection title="Family annual trial and renewal">
        <p>
          Family annual starts with a seven-day free trial. A payment method is required in secure
          Stripe Checkout, but the USD 149.90 annual subscription price is not charged when the
          trial starts. Before confirmation, Checkout shows the trial start, trial end, exact first
          charge date, annual amount, renewal, and any applicable tax. Unless the payer cancels
          before the trial ends, the payer authorizes Stripe to charge USD 149.90, plus any tax
          shown, on the displayed first-charge date and on each yearly renewal until cancellation.
        </p>
      </PolicySection>
      <PolicySection title="Family monthly price and renewal">
        <p>
          Family monthly has no free trial. By confirming Checkout, the payer authorizes Stripe to
          charge USD 14.99, plus any tax shown, at Checkout and on each monthly renewal until
          cancellation. Annual and monthly Family include the same product features; the billing
          interval, trial, charge timing, and savings differ.
        </p>
      </PolicySection>
      <PolicySection title="Who may purchase">
        <p>
          Only an active household administrator who explicitly accepts billing responsibility for
          themself and completes the required recent identity check may start a subscription for the
          selected household. Membership, household administration, protected status, and billing
          authority remain separate. Another adult cannot accept billing terms for the payer.
          Returning from Checkout is not payment evidence by itself.
        </p>
      </PolicySection>
      <PolicySection title="Cancellation and access">
        <p>
          You may cancel renewal through the billing-management link when available or by emailing{' '}
          <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>. Cancel annual during
          the seven-day trial and before the displayed trial end to avoid the first annual charge.
          After a paid charge, cancellation stops future renewal. Unless law or a stated refund
          requires otherwise, paid access ordinarily continues through the current billing period.
        </p>
      </PolicySection>
      <PolicySection title="Refunds and payment problems">
        <p>
          Subscription charges are generally not refundable after they are billed. Contact support
          promptly about a duplicate, unauthorized, incorrect, or service-failure charge. We will
          review the charge, tell you the outcome, and issue any approved or legally required refund
          to the original payment method. Canceling stops future renewals but does not by itself
          refund a paid period. Do not email payment card details.
        </p>
      </PolicySection>
      <PolicySection title="Receipts, processor, and support">
        <p>
          Stripe processes payment. Checkout confirms the terms before a trial or payment starts,
          and support can help locate the payment record afterward. BoomerBuddy checks signed
          subscription, trial, and invoice evidence before changing access. Review the{' '}
          <Link href="/privacy">privacy notice</Link> and contact{' '}
          <Link href="/support">support</Link> for billing help.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
