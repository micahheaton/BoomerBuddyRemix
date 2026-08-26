import { proxyBrowserApi } from '../../../lib/server-api-proxy';
import { protectProductionHqResource } from '../../../lib/resource-auth';

interface RouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  await protectProductionHqResource();
  // Clerk is only the resource-local outer gate. Fastify still independently enforces
  // the HQ realm, issuer, origin, authorized party, session, audience, tenant, and role.
  const { path } = await context.params;
  return proxyBrowserApi({
    audience: 'hq',
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
