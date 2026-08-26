import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { randomInt } from 'node:crypto';
import { RevenueResearchPreview } from '../../../components/revenue-research-preview';
import {
  isLocalRevenueResearchPreviewEnabled,
  revenueResearchPresentationOrderFromSelector,
} from '../../../lib/revenue-research-preview';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Local offer research preview',
  description: 'A private, noncollecting local research preview.',
  referrer: 'no-referrer',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export default function RevenueResearchPreviewPage() {
  if (!isLocalRevenueResearchPreviewEnabled(process.env)) {
    notFound();
  }

  return (
    <RevenueResearchPreview
      presentationOrders={{
        family: revenueResearchPresentationOrderFromSelector(randomInt(2)),
        individual: revenueResearchPresentationOrderFromSelector(randomInt(2)),
      }}
    />
  );
}
