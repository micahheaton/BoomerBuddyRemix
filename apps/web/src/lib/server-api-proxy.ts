import { canonicalPublicOrigin } from '@boomerbuddy/config/exact-origin';

const maximumBodyBytes = 1_048_576;
const forwardedRequestHeaders = [
  'accept',
  'content-type',
  'idempotency-key',
  'x-bb-household-id',
] as const;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BrowserApiProxyInput {
  readonly audience: 'customer' | 'hq';
  readonly environment: NodeJS.ProcessEnv;
  readonly fetchImplementation?: FetchLike;
  readonly path: readonly string[];
  readonly request: Request;
}

function safePath(path: readonly string[]): string | undefined {
  if (
    path.length === 0 ||
    path.length > 16 ||
    path.some((segment) => !/^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,127}$/u.test(segment))
  ) {
    return undefined;
  }
  return path.map((segment) => encodeURIComponent(segment)).join('/');
}

function error(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { headers: { 'Cache-Control': 'private, no-store' }, status },
  );
}

function clerkSessionCookie(raw: string | null): string | undefined | null {
  if (raw === null) return undefined;
  const values = raw
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith('__session='));
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^__session=[A-Za-z0-9._~-]{1,8192}$/u.test(values[0] ?? '')) {
    return null;
  }
  return values[0];
}

async function boundedBody(request: Request): Promise<ArrayBuffer | undefined | null> {
  if (request.body === null) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export async function proxyBrowserApi(input: BrowserApiProxyInput): Promise<Response> {
  const production = input.environment.NODE_ENV === 'production';
  const upstreamOrigin = canonicalPublicOrigin(
    input.environment.BB_API_INTERNAL_ORIGIN,
    production,
  );
  const applicationOrigin = canonicalPublicOrigin(input.environment.BB_PUBLIC_ORIGIN, production);
  const path = safePath(input.path);
  if (upstreamOrigin === undefined || applicationOrigin === undefined || path === undefined) {
    return error(503, 'service_unavailable', 'The application service is not configured');
  }

  const method = input.request.method.toUpperCase();
  if (!['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].includes(method)) {
    return error(405, 'method_not_allowed', 'The request method is not available');
  }
  if (!['GET', 'HEAD'].includes(method)) {
    if (input.request.headers.get('origin') !== applicationOrigin) {
      return error(403, 'not_authorized', 'The application origin is not trusted');
    }
    const contentLength = Number(input.request.headers.get('content-length') ?? '0');
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maximumBodyBytes) {
      return error(413, 'payload_too_large', 'The request is too large');
    }
  }

  const upstreamUrl = new URL(`/v1/${path.replace(/^v1\//u, '')}`, upstreamOrigin);
  if (input.request.url.length > 8_192) {
    return error(414, 'uri_too_long', 'The request address is too long');
  }
  const incomingUrl = new URL(input.request.url);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers({ Origin: applicationOrigin });
  for (const name of forwardedRequestHeaders) {
    const value = input.request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const cookie = clerkSessionCookie(input.request.headers.get('cookie'));
  if (cookie === null) {
    return error(401, 'not_authenticated', 'Authentication is required');
  }
  if (cookie !== undefined) headers.set('cookie', cookie);

  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    const bounded = await boundedBody(input.request);
    if (bounded === null) {
      return error(413, 'payload_too_large', 'The request is too large');
    }
    body = bounded;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await (input.fetchImplementation ?? fetch)(upstreamUrl, {
      ...(body === undefined ? {} : { body }),
      headers,
      method,
      redirect: 'manual',
      signal: controller.signal,
    });
    const responseHeaders = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const contentType = upstream.headers.get('content-type');
    if (contentType !== null) responseHeaders.set('Content-Type', contentType);
    return new Response(method === 'HEAD' ? null : upstream.body, {
      headers: responseHeaders,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch {
    return error(502, 'service_unavailable', 'The application service could not be reached');
  } finally {
    clearTimeout(timeout);
  }
}
