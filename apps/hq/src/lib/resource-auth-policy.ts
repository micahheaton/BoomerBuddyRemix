export type HqResourceAuthDisposition = 'guarded' | 'guarded-and-delegated' | 'public';

function isPathSegment(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`);
}

export function classifyHqResourcePath(pathname: string): HqResourceAuthDisposition {
  if (pathname === '/robots.txt' || isPathSegment(pathname, '/sign-in')) return 'public';
  if (isPathSegment(pathname, '/api')) return 'guarded-and-delegated';
  return 'guarded';
}

export function isPublicHqResourcePath(pathname: string): boolean {
  return classifyHqResourcePath(pathname) === 'public';
}
