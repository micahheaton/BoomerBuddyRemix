import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from 'node:timers';
import { URL } from 'node:url';

const nextCli = resolve('node_modules/next/dist/bin/next');
const normalizeNextEnvScript = resolve('scripts/normalize-next-env.mjs');
const buildTimeoutMs = 120_000;
const serverReadyTimeoutMs = 20_000;

const applications = [
  {
    application: 'web',
    name: 'Customer',
    directory: resolve('apps/web'),
    host: 'customer.resource-auth.invalid',
    port: 3_200,
    publicPaths: ['/check', '/learn', '/robots.txt', '/sitemap.xml'],
    authenticationPaths: [
      '/sign-in',
      '/sign-in/client-trust',
      '/sign-in/session-recovery',
      '/sign-in/sso-callback',
      '/sign-in/oauth-callback',
    ],
    protectedPaths: [
      '/member',
      '/member/history',
      '/checkmate',
      '/learning',
      '/sign-in-danger',
      '/apiary',
      '/check%6date',
      '/sign-in%2ddanger',
      '/api%61ry',
    ],
    delegatedApiPath: '/api/v1/me',
  },
  {
    application: 'hq',
    name: 'HQ',
    directory: resolve('apps/hq'),
    host: 'hq.resource-auth.invalid',
    port: 3_201,
    publicPaths: ['/robots.txt', '/sign-in'],
    protectedPaths: [
      '/',
      '/customers',
      '/api/v1/me',
      '/sign-in-danger',
      '/sign-in%2ddanger',
      '/api%61ry',
    ],
  },
];

async function normalizeNextEnv(application) {
  const child = spawn(process.execPath, [normalizeNextEnvScript, application.application], {
    cwd: resolve('.'),
    env: process.env,
    stdio: 'inherit',
  });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(
      `${application.name} generated declaration cleanup failed with ${signal === null ? `exit ${code}` : `signal ${signal}`}`,
    );
  }
}

function placeholderEnvironment(application) {
  const publishableKey = `pk${'_test_'}${Buffer.from(`${application.host}$`).toString('base64')}`;
  const secretKey = `sk${'_test_'}${application.name.toLowerCase().padEnd(48, 'x')}`;
  return {
    ...process.env,
    // Keep API delegation proof deterministic and offline. The Customer handler returns its
    // own JSON configuration response after the Clerk proxy deliberately delegates /api.
    BB_API_INTERNAL_ORIGIN: '',
    BB_PUBLIC_ORIGIN: `https://${application.host}`,
    CLERK_SECRET_KEY: secretKey,
    CLERK_TELEMETRY_DISABLED: 'true',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  };
}

async function runBuild(application, environment) {
  const child = spawn(process.execPath, [nextCli, 'build'], {
    cwd: application.directory,
    env: environment,
    stdio: 'inherit',
  });
  const timeout = scheduleTimeout(() => child.kill('SIGKILL'), buildTimeoutMs);
  try {
    const [code, signal] = await once(child, 'exit');
    if (code !== 0) {
      throw new Error(
        `${application.name} production build failed with ${signal === null ? `exit ${code}` : `signal ${signal}`}`,
      );
    }
  } finally {
    cancelTimeout(timeout);
    await normalizeNextEnv(application);
  }
}

function request(application, path, { authority = application.host } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: application.port,
        path,
        method: 'GET',
        headers: {
          Host: authority,
          'X-Forwarded-Host': authority,
          'X-Forwarded-Port': '443',
          'X-Forwarded-Proto': 'https',
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length < 8_192) body += chunk.slice(0, 8_192 - body.length);
        });
        response.once('end', () => {
          resolveRequest({
            body,
            cacheControl: response.headers['cache-control'],
            contentType: response.headers['content-type'],
            location: response.headers.location,
            status: response.statusCode,
          });
        });
      },
    );
    request.setTimeout(5_000, () => request.destroy(new Error('request timed out')));
    request.once('error', rejectRequest);
    request.end();
  });
}

async function waitForServer(application, child) {
  const deadline = Date.now() + serverReadyTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${application.name} production server exited before becoming ready`);
    }
    try {
      await request(application, application.publicPaths[0]);
      return;
    } catch {
      await new Promise((resolveDelay) => scheduleTimeout(resolveDelay, 100));
    }
  }
  throw new Error(`${application.name} production server did not become ready`);
}

function assertPublic(application, path, response) {
  if (response.status !== 200) {
    throw new Error(
      `${application.name} anonymous ${path} returned ${String(response.status)} instead of 200`,
    );
  }
}

function assertAuthenticationPath(application, path, response) {
  assertPublic(application, path, response);
  const cacheControl = response.cacheControl ?? '';
  if (
    !/(?:^|,)\s*(?:private|no-store)(?:\s|,|$)/iu.test(cacheControl) ||
    /s-maxage/iu.test(cacheControl)
  ) {
    throw new Error(
      `${application.name} authentication path ${path} allowed public shared caching: ${cacheControl || 'missing cache-control'}`,
    );
  }
}

function assertSignedOutRedirect(application, path, response) {
  if (response.status !== 307 || response.location === undefined) {
    throw new Error(
      `${application.name} signed-out ${path} returned ${String(response.status)} without a Clerk redirect`,
    );
  }
  const location = new URL(response.location);
  const origin = `https://${application.host}`;
  if (location.origin !== origin || location.pathname !== '/sign-in') {
    throw new Error(`${application.name} signed-out ${path} left its exact sign-in origin`);
  }
  const returnAddress = location.searchParams.get('redirect_url');
  if (returnAddress === null) {
    throw new Error(`${application.name} signed-out ${path} lost its exact return address`);
  }
  if (path.includes('%')) {
    const returnedUrl = new URL(returnAddress);
    if (
      returnedUrl.origin !== origin ||
      decodeURIComponent(returnedUrl.pathname) !== decodeURIComponent(path) ||
      returnedUrl.search !== '' ||
      returnedUrl.hash !== ''
    ) {
      throw new Error(`${application.name} encoded sibling ${path} changed its return address`);
    }
  } else if (returnAddress !== `${origin}${path}`) {
    throw new Error(`${application.name} signed-out ${path} lost its exact return address`);
  }
}

function assertMissingIdentityFailsClosed(application, response) {
  if (
    response.status !== 503 ||
    response.location !== undefined ||
    response.cacheControl !== 'no-store'
  ) {
    throw new Error(
      `${application.name} missing identity configuration did not fail closed at 503`,
    );
  }
}

function assertWrongOriginRejected(application, response) {
  if (
    response.status !== 421 ||
    response.location !== undefined ||
    response.cacheControl !== 'no-store'
  ) {
    throw new Error(`${application.name} wrong canonical origin was not rejected at 421`);
  }
}

function assertCustomerApiDelegated(application, response) {
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`${application.name} delegated API response was not handler JSON`);
  }
  if (
    response.status !== 503 ||
    response.location !== undefined ||
    !response.contentType?.startsWith('application/json') ||
    payload?.error?.code !== 'service_unavailable'
  ) {
    throw new Error(`${application.name} /api was intercepted by Clerk instead of its handler`);
  }
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveDelay) => scheduleTimeout(resolveDelay, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function withProductionServer(application, environment, assertions) {
  const child = spawn(process.execPath, [nextCli, 'start', '-p', String(application.port)], {
    cwd: application.directory,
    env: environment,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    await waitForServer(application, child);
    await assertions();
  } finally {
    await stopServer(child);
  }
}

async function verifyApplication(application) {
  const environment = placeholderEnvironment(application);
  await runBuild(application, environment);

  await withProductionServer(application, environment, async () => {
    for (const path of application.publicPaths) {
      assertPublic(application, path, await request(application, path));
    }
    for (const path of application.authenticationPaths ?? []) {
      assertAuthenticationPath(application, path, await request(application, path));
    }
    for (const path of application.protectedPaths) {
      assertSignedOutRedirect(application, path, await request(application, path));
    }
    assertWrongOriginRejected(
      application,
      await request(application, '/robots.txt', {
        authority: `wrong.${application.host}`,
      }),
    );
    if (application.delegatedApiPath !== undefined) {
      assertCustomerApiDelegated(
        application,
        await request(application, application.delegatedApiPath),
      );
    }
  });

  await withProductionServer(application, { ...environment, CLERK_SECRET_KEY: '' }, async () => {
    assertMissingIdentityFailsClosed(application, await request(application, '/robots.txt'));
  });
}

for (const application of applications) {
  await verifyApplication(application);
}

process.stdout.write(
  'Customer and HQ offline configured-placeholder builds prove public metadata, production resource guards, encoded sibling denial, API delegation, missing-identity 503, and wrong-origin 421.\n',
);
