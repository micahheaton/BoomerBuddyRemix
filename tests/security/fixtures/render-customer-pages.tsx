import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccessibilityPage from '../../../apps/web/src/app/accessibility/page';
import AccountDeletionPage from '../../../apps/web/src/app/account-deletion/page';
import BillingTermsPage from '../../../apps/web/src/app/billing-terms/page';
import HowItWorksPage from '../../../apps/web/src/app/how-it-works/page';
import HomePage from '../../../apps/web/src/app/page';
import PricingPage from '../../../apps/web/src/app/pricing/page';
import PrivacyPage from '../../../apps/web/src/app/privacy/page';
import SupportPage from '../../../apps/web/src/app/support/page';
import TermsPage from '../../../apps/web/src/app/terms/page';
import TrustPage from '../../../apps/web/src/app/trust/page';

function render(Page: ComponentType): string {
  return renderToStaticMarkup(createElement(Page));
}

export const routes = {
  home: render(HomePage),
  pricing: render(PricingPage),
  howItWorks: render(HowItWorksPage),
  trust: render(TrustPage),
  billingTerms: render(BillingTermsPage),
  support: render(SupportPage),
  privacy: render(PrivacyPage),
  terms: render(TermsPage),
  accessibility: render(AccessibilityPage),
  accountDeletion: render(AccountDeletionPage),
};
