import type { IndexedCustomerRoutePath } from './public-search-routes';

export type IndexedCustomerPageMetadata = {
  readonly title: string;
  readonly description: string;
  readonly alternates: { readonly canonical: IndexedCustomerRoutePath };
};

export const indexedCustomerPageMetadata = {
  '/': {
    title: 'BoomerBuddy Family: practice, Check, and respond together',
    description:
      'Use seven short lessons, private Checks, and optional redacted help from someone you trust to respond to suspicious messages together.',
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
  '/learn': {
    title: 'Reviewed scam guidance | BoomerBuddy Learn',
    description:
      'Read practical, human-reviewed scam-safety guidance based on dated public sources from government and law-enforcement organizations.',
    alternates: { canonical: '/learn' },
  },
  '/pricing': {
    title: 'Family pricing | BoomerBuddy',
    description:
      'Compare Family annual with a seven-day free trial and Family monthly, including lessons, private Checks, Trusted Circle help, and Safe Word.',
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
      'Review Family annual trial and monthly pricing, first-charge timing, renewal, billing authority, cancellation, refund, and support terms.',
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
