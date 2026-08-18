import { proxyBrowserApi } from '../../../lib/server-api-proxy';

interface RouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyBrowserApi({
    audience: 'customer',
    environment: process.env,
    path,
    request,
  });
}

export const dynamic = 'force-dynamic';
export const DELETE = handle;
export const GET = handle;
export const HEAD = handle;
export const PATCH = handle;
export const POST = handle;
export const PUT = handle;
