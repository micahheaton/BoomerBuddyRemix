import { PolicyPage, PolicySection } from '../../components/policy-page';

export default function AccessibilityPage() {
  return (
    <PolicyPage
      eyebrow="Accessibility"
      title="Accessibility at BoomerBuddy"
      summary="BoomerBuddy supports clear, calm use across keyboard, screen reader, zoom, contrast, and mobile experiences."
    >
      <PolicySection title="Our approach">
        <p>
          We work toward WCAG 2.2 AA for the customer web experience. The experience includes
          semantic headings and landmarks, visible focus, keyboard operation, text alternatives,
          status announcements, readable contrast, reduced-motion respect, and layouts that remain
          usable when text is enlarged.
        </p>
      </PolicySection>
      <PolicySection title="Beta limitations">
        <p>
          We continue to review the private beta across browsers, assistive technologies, mobile
          devices, and zoom settings. This statement is a commitment and feedback channel, not a
          claim that every page has completed independent conformance review.
        </p>
      </PolicySection>
      <PolicySection title="Report a barrier">
        <p>
          Email <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a> with the page,
          task, browser or device, assistive technology if relevant, and what prevented completion.
          Do not include passwords, codes, card information, or private submitted content.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
