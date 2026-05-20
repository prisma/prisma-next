import { createTelemetryDb } from './db';
import { createHandler, type HandlerInfo } from './handler';
import { createRequestsPerMinuteRateLimiter } from './rate-limiter';

const SHUTDOWN_TIMEOUT_MS = 10_000;

export type TelemetryRequestHandler = (request: Request, info?: HandlerInfo) => Promise<Response>;

export interface TelemetryServerStartOptions {
  readonly port: number;
  readonly handler: TelemetryRequestHandler;
}

export interface TelemetryServer {
  readonly port: number;
  stop(): void | Promise<void>;
}

export type StartTelemetryServer = (
  options: TelemetryServerStartOptions,
) => TelemetryServer | Promise<TelemetryServer>;

export interface TelemetryBackendConfig {
  readonly databaseUrl: string;
  readonly port: number;
  readonly requestsPerMinute: number;
  /**
   * Opt into trusting the first `x-forwarded-for` address for per-IP rate
   * limiting. Set this only when the backend sits behind a proxy that
   * strips inbound `x-forwarded-for` and writes its own. Defaults to
   * false; without a stripping proxy the header is attacker-controlled.
   */
  readonly trustForwardedFor: boolean;
}

export interface TelemetryBackendShutdownTarget {
  close(): Promise<void>;
}

interface TelemetryBackendApp extends TelemetryBackendShutdownTarget {
  readonly handler: TelemetryRequestHandler;
  readonly requestsPerMinute: number;
}

function parsePositiveIntegerFromEnv(name: string, fallbackValue: string): number {
  const value = process.env[name] ?? fallbackValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return parsed;
}

function parseBooleanEnv(
  name: string,
  env: Record<string, string | undefined>,
  fallback: boolean,
): boolean {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function shutdownTimeout(): Promise<'timed-out'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed-out'), SHUTDOWN_TIMEOUT_MS);
    timer.unref?.();
  });
}

export async function stopTelemetryBackend(
  server: TelemetryServer,
  app: TelemetryBackendShutdownTarget,
): Promise<'stopped' | 'timed-out'> {
  const result = await Promise.race([
    (async () => {
      await server.stop();
      await app.close();
      return 'stopped' as const;
    })(),
    shutdownTimeout(),
  ]);
  if (result === 'timed-out') {
    console.error(`telemetry backend shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms`);
  }
  return result;
}

function createTelemetryBackendApp(config: TelemetryBackendConfig): TelemetryBackendApp {
  const db = createTelemetryDb(config.databaseUrl);
  const rateLimiter = createRequestsPerMinuteRateLimiter(config.requestsPerMinute);
  return {
    handler: createHandler({
      db,
      rateLimiter,
      trustForwardedFor: config.trustForwardedFor,
    }),
    requestsPerMinute: config.requestsPerMinute,
    close: () => db.runtime().close(),
  };
}

export function resolveTelemetryBackendConfig(
  env: Record<string, string | undefined> = process.env,
): TelemetryBackendConfig {
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL must be set');
  }

  const port = parsePositiveIntegerFromEnv('PORT', '8080');
  const requestsPerMinute = parsePositiveIntegerFromEnv('RATE_LIMIT_RPM', '120');
  const trustForwardedFor = parseBooleanEnv('TELEMETRY_TRUST_FORWARDED_FOR', env, false);

  return { databaseUrl, port, requestsPerMinute, trustForwardedFor };
}

export async function runTelemetryBackendServer(
  startServer: StartTelemetryServer,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const config = resolveTelemetryBackendConfig(env);
  const app = createTelemetryBackendApp(config);
  let server: TelemetryServer;
  try {
    server = await startServer({ port: config.port, handler: app.handler });
  } catch (error) {
    await app.close();
    throw error;
  }

  console.log(
    `telemetry backend listening on port ${server.port} (rate limit ${app.requestsPerMinute} req/min/IP)`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`received ${signal}; shutting down`);

    let exitCode: 0 | 1 = 0;
    try {
      await stopTelemetryBackend(server, app);
    } catch (error) {
      exitCode = 1;
      console.error('telemetry backend shutdown failed', error);
    }
    process.exit(exitCode);
  };

  process.on('SIGINT', (signal) => {
    void shutdown(signal);
  });
  process.on('SIGTERM', (signal) => {
    void shutdown(signal);
  });
}
