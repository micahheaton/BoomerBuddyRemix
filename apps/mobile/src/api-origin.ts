export const productionMobileApiOrigin = 'https://api.boomerbuddy.net';

export function resolveMobileApiOrigin(input: {
  readonly configured?: string | undefined;
  readonly development: boolean;
}): string {
  const configured = input.configured?.trim();
  const candidate = configured || (input.development ? 'http://127.0.0.1:4000' : '');
  if (!candidate) throw new Error('EXPO_PUBLIC_API_URL is required for production mobile builds.');
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid API origin.');
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (!input.development && url.protocol !== 'https:')
  ) {
    throw new Error('EXPO_PUBLIC_API_URL must be a credential-free HTTPS origin.');
  }
  if (!input.development && url.origin !== productionMobileApiOrigin) {
    throw new Error(`Production mobile builds require ${productionMobileApiOrigin}.`);
  }
  return url.origin;
}
