import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/check'];

export default function CheckLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
