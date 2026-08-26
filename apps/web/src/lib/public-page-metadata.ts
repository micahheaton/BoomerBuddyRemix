import type { IndexedCustomerRoutePath } from './public-search-routes';

export type IndexedCustomerPageMetadata = {
  readonly title: string;
  readonly description: string;
  readonly alternates: { readonly canonical: IndexedCustomerRoutePath };
};

export const indexedCustomerPageMetadata = {
  '/': {
    title: 'BoomerBuddy: a calmer next step',
    description:
      'Pause, review suspicious messages, and choose a safer next step with calm educational guidance.',
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
      'Learn the pause, check, and connect approach for reviewing something suspicious without false certainty.',
    alternates: { canonical: '/how-it-works' },
  },
  '/pricing': {
    title: 'Family pricing | BoomerBuddy',
    description:
      'Review the invite-only Family monthly plan at USD 14.99, including billing authority, renewal, and cancellation boundaries.',
    alternates: { canonical: '/pricing' },
  },
  '/trust': {
    title: 'Trust and safety | BoomerBuddy',
    description:
      'Read how BoomerBuddy limits data use, preserves household and consent boundaries, and avoids hidden website lookups.',
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
