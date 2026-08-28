import Link from 'next/link';
import { PolicyPage, PolicySection } from '../../components/policy-page';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/terms'];

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Terms"
      title="BoomerBuddy early-access terms"
      summary="These terms govern the BoomerBuddy web service provided by BoomerBuddy LLC."
    >
      <PolicySection title="Eligibility and accounts">
        <p>
          You must be at least 18, provide accurate information, protect your sign-in methods, and
          use only households and roles you are authorized to access. Creating an account does not
          start a trial or charge you. Household administration does not override another
          adult&apos;s consent or privacy choices.
        </p>
      </PolicySection>
      <PolicySection title="What the service does">
        <p>
          BoomerBuddy offers educational guidance for reviewing suspicious messages and choosing a
          calmer next step. Results can be incomplete or wrong. The service is not a bank, law firm,
          law-enforcement agency, credit bureau, emergency service, or guarantee that material is
          safe or fraudulent.
        </p>
      </PolicySection>
      <PolicySection title="Safe and acceptable use">
        <p>
          Do not submit passwords, verification codes, payment card details, safe words, illegal
          content, or information you lack permission to use. Do not probe another household, bypass
          access controls, automate abusive traffic, or use the service to deceive or harm another
          person.
        </p>
      </PolicySection>
      <PolicySection title="Early-access availability and changes">
        <p>
          The service is in early access and may change, pause, or end. We may restrict or suspend
          access to protect people, data, payment integrity, or the service. Material changes to
          paid terms will be presented before they govern a later renewal.
        </p>
      </PolicySection>
      <PolicySection title="Payment and cancellation">
        <p>
          Paid access is governed by the <Link href="/billing-terms">billing terms</Link>. You may
          stop renewal through the provided billing-management path or by contacting support.
        </p>
      </PolicySection>
      <PolicySection title="Warranty and responsibility">
        <p>
          The service is provided as available to the extent permitted by law. You remain
          responsible for verifying organizations through independent contact information and
          deciding what action to take. Nothing in these terms limits rights that applicable law
          does not allow us to limit.
        </p>
      </PolicySection>
      <PolicySection title="Contact">
        <p>
          Questions, complaints, or notices may be sent to{' '}
          <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
