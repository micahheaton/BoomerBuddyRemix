import type { IndexedCustomerRoutePath } from './public-search-routes';

export type IndexedCustomerPageMetadata = {
  readonly title: string;
  readonly description: string;
  readonly alternates: { readonly canonical: IndexedCustomerRoutePath };
};

export const indexedCustomerPageMetadata = {
  '/': {
    title: 'BoomerBuddy Family: scam-response support for households',
    description:
      'Prepare, check warning signs, and ask one person you choose for help with private, consent-based household scam-response support.',
    alternates: { canonical: '/' },
  },
  '/check': {
    title: 'Public Check | BoomerBuddy',
    description:
      'Review suspicious text or a website address for educational guidance before deciding what to do next. Results can be wrong.',
    alternates: { canonical: '/check' },
  },
  '/how-it-works': {
    title: 'How BoomerBuddy works',
    description:
      'Learn how Family combines short lessons, Check, deliberate redacted sharing, in-app acknowledgement, and weekly practice.',
    alternates: { canonical: '/how-it-works' },
  },
  '/pricing': {
    title: 'Family pricing | BoomerBuddy',
    description:
      'See what the invitation-only Family plan includes for USD 14.99 monthly, with consent boundaries, renewal, and cancellation details.',
    alternates: { canonical: '/pricing' },
  },
  '/trust': {
    title: 'Trust and safety | BoomerBuddy',
    description:
      'Learn how BoomerBuddy supports families without monitoring, preserves adult consent, and keeps Checks private by default.',
    alternates: { canonical: '/trust' },
  },
  '/support': {
    title: 'BoomerBuddy support',
    description:
      'Find account, billing, privacy, accessibility, and product support options. BoomerBuddy is not an emergency service.',
    alternates: { canonical: '/support' },
  },
  '/privacy': {
    title: 'BoomerBuddy privacy notice',
    description:
      'Learn what information BoomerBuddy uses, why it is used, how it is shared and retained, and which choices members have.',
    alternates: { canonical: '/privacy' },
  },
  '/terms': {
    title: 'BoomerBuddy terms',
    description:
      'Read the eligibility, acceptable-use, service-availability, payment, cancellation, and responsibility terms for BoomerBuddy.',
    alternates: { canonical: '/terms' },
  },
  '/billing-terms': {
    title: 'Family billing terms | BoomerBuddy',
    description:
      'Review the USD 14.99 monthly Family subscription price, renewal, billing authority, cancellation, refund, and support terms.',
    alternates: { canonical: '/billing-terms' },
  },
  '/accessibility': {
    title: 'BoomerBuddy accessibility',
    description:
      'Read BoomerBuddy accessibility goals, current review limitations, and how to report a barrier without sharing sensitive information.',
    alternates: { canonical: '/accessibility' },
  },
  '/account-deletion': {
    title: 'Account deletion | BoomerBuddy',
    description:
      'Learn how to request deletion, how identity and authority are verified, and which limited records may need to be retained.',
    alternates: { canonical: '/account-deletion' },
  },
} satisfies Readonly<Record<IndexedCustomerRoutePath, IndexedCustomerPageMetadata>>;
