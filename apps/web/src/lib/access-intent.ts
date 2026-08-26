import {
  accessIntentAttributionSchema,
  accessIntentReceiptCodeSchema,
  type AccessIntentAttribution,
} from '@boomerbuddy/contracts';

export const accessIntentMailbox = 'support@boomerbuddy.net' as const;

export function accessIntentAttributionFromSearch(search: string): AccessIntentAttribution | null {
  const parameters = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if ([...parameters.keys()].length === 0) return { source: 'direct', campaign: 'none' };
  if (
    [...parameters.keys()].some((key) => key !== 'source' && key !== 'campaign') ||
    parameters.getAll('source').length !== 1 ||
    parameters.getAll('campaign').length !== 1
  ) {
    return null;
  }
  const parsed = accessIntentAttributionSchema.safeParse({
    source: parameters.get('source'),
    campaign: parameters.get('campaign'),
  });
  return parsed.success ? parsed.data : null;
}

export function accessIntentMailto(receiptCode: string): string {
  const safeReceiptCode = accessIntentReceiptCodeSchema.parse(receiptCode);
  const subject = encodeURIComponent(`Private beta access request ${safeReceiptCode}`);
  return `mailto:${accessIntentMailbox}?subject=${subject}`;
}
