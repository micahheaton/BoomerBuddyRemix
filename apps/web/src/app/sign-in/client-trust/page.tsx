import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Confirm this device | BoomerBuddy',
};

// Clerk uses this path while confirming a browser or device. Keep an explicit
// application route in addition to the optional catch-all so deployment routers
// cannot turn the identity-provider handoff into a generic 404.
export { default } from '../[[...sign-in]]/page';
