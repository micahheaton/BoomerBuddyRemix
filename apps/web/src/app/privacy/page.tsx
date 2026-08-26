import Link from 'next/link';
import { PolicyPage, PolicySection } from '../../components/policy-page';

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Privacy"
      title="BoomerBuddy privacy notice"
      summary="This notice explains the information used to provide the private beta and the choices available to members."
    >
      <PolicySection title="Information we use">
        <p>
          BoomerBuddy uses account identity and session information, household roles and consent,
          the text or website address a person deliberately submits for a Check, Check results and
          history, product feedback, support correspondence, and limited device and operational
          records needed for security and reliability.
        </p>
        <p>
          Stripe processes payment details. BoomerBuddy should receive payment and subscription
          identifiers, status, amount, and receipt information, not your full payment card number.
        </p>
      </PolicySection>
      <PolicySection title="How information is used">
        <p>
          We use information to authenticate members, enforce household and consent boundaries,
          provide Checks and history, operate subscriptions, answer support requests, prevent abuse,
          investigate incidents, and improve the beta. BoomerBuddy does not fetch a URL contained in
          submitted material and does not sell personal information.
        </p>
      </PolicySection>
      <PolicySection title="Campaign and conversion measurement">
        <p>
          When you open Public Check, BoomerBuddy accepts only a small fixed list of source and
          campaign labels and then removes all parameters from the page address. If you later choose
          to save after signing in, those fixed labels may be connected to that saved result and a
          later paid membership so we can review aggregate campaign results. Submitted messages,
          website addresses, and unrecognized address values are not used for campaign attribution.
        </p>
      </PolicySection>
      <PolicySection title="Private-beta access receipts">
        <p>
          When you choose to ask about private-beta access from the pricing page, BoomerBuddy first
          creates a temporary receipt containing only a server-issued code, the fixed purpose, and a
          recognized source and campaign label. Protected one-way values prevent duplicate requests
          and enforce abuse limits without storing the request key or network address in the
          receipt. The receipt expires after seven days. It does not contain your name, email
          address, phone number, message, account, or member identifier.
        </p>
        <p>
          This describes BoomerBuddy application storage. Hosting, edge-security, and reliability
          providers may process the original request address and limited network logs before page
          parameters are removed. Do not put your name, email address, phone number, or message in a
          pricing-page address.
        </p>
        <p>
          Your device then opens its own email composer. No message is sent automatically. Support
          receives your contact details only if you choose to send the email. A created receipt is
          access intent, not proof that support received a lead or message.
        </p>
      </PolicySection>
      <PolicySection title="Sharing and retention">
        <p>
          Information is shared only with service providers needed to operate the product, when a
          member deliberately shares a redacted result with an authorized household participant, or
          when disclosure is required by law. Access is limited by role and purpose.
        </p>
        <p>
          We retain information only while it is needed for the service, security, dispute and
          financial records, or legal obligations. Deletion may preserve minimal records that must
          be retained, such as payment, security, consent, and records documenting the request.
        </p>
      </PolicySection>
      <PolicySection title="Your choices">
        <p>
          You may request access, correction, restriction, export, or deletion by emailing{' '}
          <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>. We verify identity
          and authority before acting. See <Link href="/account-deletion">account deletion</Link>
          for the deletion process.
        </p>
      </PolicySection>
      <PolicySection title="Age and contact">
        <p>
          The private beta is for adults age 18 or older and is not directed to children. Privacy
          questions can be sent to{' '}
          <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
