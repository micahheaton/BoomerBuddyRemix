export const productionMobileApiOrigin = 'https://api.boomerbuddy.net';

function hasRejectedRawOriginCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      character === '\\'
    ) {
      return true;
    }
  }
  return false;
}

export function resolveMobileApiOrigin(input: {
  readonly configured?: string | undefined;
  readonly development: boolean;
}): string {
  const configured = input.configured;
  if (
    configured !== undefined &&
    (configured.length > 2_048 ||
      hasRejectedRawOriginCharacter(configured) ||
      configured.includes('%'))
  ) {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid API origin.');
  }
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
