import { stripeOfferIdSchema, stripePublicCatalogSchema } from '@boomerbuddy/contracts';

export const defaultPublicAcquisitionOfferId = 'family_annual_v2' as const;

const publicOfferDefinitions = Object.freeze([
  {
    offerId: 'family_annual_v2' as const,
    plan: 'family' as const,
    displayName: 'Family',
    billingInterval: 'year' as const,
    unitAmountMinor: 14_990,
    currency: 'usd' as const,
    trialPeriodDays: 7 as const,
    defaultAcquisitionOffer: true,
    disclosure: '7 days free, then $149.90/year unless canceled.',
  },
  {
    offerId: 'family_monthly_v2' as const,
    plan: 'family' as const,
    displayName: 'Family',
    billingInterval: 'month' as const,
    unitAmountMinor: 1_499,
    currency: 'usd' as const,
    trialPeriodDays: 0 as const,
    defaultAcquisitionOffer: false,
    disclosure: '$14.99/month until canceled.',
  },
  {
    offerId: 'individual_annual_v1' as const,
    plan: 'individual' as const,
    displayName: 'Individual',
    billingInterval: 'year' as const,
    unitAmountMinor: 8_990,
    currency: 'usd' as const,
    trialPeriodDays: 7 as const,
    defaultAcquisitionOffer: false,
    disclosure: '7 days free, then $89.90/year unless canceled.',
  },
  {
    offerId: 'individual_monthly_v1' as const,
    plan: 'individual' as const,
    displayName: 'Individual',
    billingInterval: 'month' as const,
    unitAmountMinor: 899,
    currency: 'usd' as const,
    trialPeriodDays: 0 as const,
    defaultAcquisitionOffer: false,
    disclosure: '$8.99/month until canceled.',
  },
]);

export function publicCommerceCatalog(input?: { readonly individualOffersEnabled?: boolean }) {
  const individualOffersEnabled = input?.individualOffersEnabled === true;
  const offers = publicOfferDefinitions.map((offer) => ({
    ...offer,
    customerSelectable: offer.plan === 'family' || individualOffersEnabled,
  }));
  for (const offer of offers) stripeOfferIdSchema.parse(offer.offerId);
  const familyAnnual = offers.find((offer) => offer.offerId === 'family_annual_v2');
  const familyMonthly = offers.find((offer) => offer.offerId === 'family_monthly_v2');
  const individualAnnual = offers.find((offer) => offer.offerId === 'individual_annual_v1');
  const individualMonthly = offers.find((offer) => offer.offerId === 'individual_monthly_v1');
  if (
    familyAnnual === undefined ||
    familyMonthly === undefined ||
    individualAnnual === undefined ||
    individualMonthly === undefined ||
    familyAnnual.unitAmountMinor !== familyMonthly.unitAmountMinor * 10 ||
    individualAnnual.unitAmountMinor !== individualMonthly.unitAmountMinor * 10
  ) {
    throw new TypeError('Public billing catalogue annual arithmetic is invalid');
  }
  return stripePublicCatalogSchema.parse({
    defaultOfferId: defaultPublicAcquisitionOfferId,
    offers,
  });
}
