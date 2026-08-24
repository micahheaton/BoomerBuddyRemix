import { createServer, type Server, type ServerResponse } from 'node:http';

const defaultReplitWorkerPort = 3000;
const healthPaths = new Set(['/', '/health/live']);

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  payload: Readonly<Record<string, string>>,
  headOnly: boolean,
): void => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    Connection: 'close',
    'Content-Length': String(Buffer.byteLength(body)),
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(headOnly ? undefined : body);
};

export const resolveReplitWorkerHealthPort = (
  environment: NodeJS.ProcessEnv,
): number | undefined => {
  if (environment.REPLIT_DEPLOYMENT !== '1') return undefined;
  const port = Number(environment.PORT ?? defaultReplitWorkerPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('A Replit worker deployment requires a valid PORT');
  }
  return port;
};

export const createWorkerHealthServer = (): Server =>
  createServer((request, response) => {
    const method = request.method ?? '';
    const headOnly = method === 'HEAD';
    const healthPath = healthPaths.has(request.url ?? '');

    if ((method === 'GET' || headOnly) && healthPath) {
      writeJson(response, 200, { status: 'ok' }, headOnly);
      return;
    }
    if (healthPath) {
      response.setHeader('Allow', 'GET, HEAD');
      writeJson(response, 405, { status: 'method_not_allowed' }, false);
      return;
    }
    writeJson(response, 404, { status: 'not_found' }, headOnly);
  });

export const startWorkerHealthServer = async (
  environment: NodeJS.ProcessEnv,
): Promise<Server | undefined> => {
  const port = resolveReplitWorkerHealthPort(environment);
  if (port === undefined) return undefined;
  const server = createWorkerHealthServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
  return server;
};

export const closeWorkerHealthServer = async (server: Server | undefined): Promise<void> => {
  if (server === undefined || !server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
};

export type WorkerRuntimeCleanup = {
  registerDatabaseClose(close: () => Promise<void>): void;
  registerWorkerStop(stop: () => Promise<void>): void;
};

export const runReplitWorkerLifecycle = async <Result>(
  environment: NodeJS.ProcessEnv,
  startup: (cleanup: WorkerRuntimeCleanup) => Promise<Result>,
): Promise<Result> => {
  const server = await startWorkerHealthServer(environment);
  let closeDatabase: (() => Promise<void>) | undefined;
  let stopWorker: (() => Promise<void>) | undefined;
  try {
    return await startup({
      registerDatabaseClose(close) {
        if (closeDatabase !== undefined) {
          throw new TypeError('Worker database cleanup is already registered');
        }
        closeDatabase = close;
      },
      registerWorkerStop(stop) {
        if (stopWorker !== undefined) {
          throw new TypeError('Worker stop cleanup is already registered');
        }
        stopWorker = stop;
      },
    });
  } finally {
    try {
      if (stopWorker !== undefined) await stopWorker();
    } finally {
      try {
        await closeWorkerHealthServer(server);
      } finally {
        if (closeDatabase !== undefined) await closeDatabase();
      }
    }
  }
};
