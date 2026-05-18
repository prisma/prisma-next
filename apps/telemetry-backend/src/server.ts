import { createTelemetryDb } from './db';
import { createHandler } from './handler';
import { createRequestsPerMinuteRateLimiter } from './rate-limiter';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL must be set');
}

const port = Number.parseInt(process.env['PORT'] ?? '8080', 10);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${process.env['PORT']}`);
}

const rpmRaw = process.env['RATE_LIMIT_RPM'] ?? '120';
const rpm = Number.parseInt(rpmRaw, 10);
if (!Number.isFinite(rpm) || rpm <= 0) {
  throw new Error(`Invalid RATE_LIMIT_RPM value: ${rpmRaw}`);
}

const db = createTelemetryDb(databaseUrl);
const rateLimiter = createRequestsPerMinuteRateLimiter(rpm);
const handler = createHandler({ db, rateLimiter });

const server = Bun.serve({
  port,
  async fetch(request, srv): Promise<Response> {
    const ip = srv.requestIP(request)?.address ?? undefined;
    return handler(request, ip !== undefined ? { ip } : undefined);
  },
  error(error): Response {
    console.error('telemetry backend internal error', error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

console.log(`telemetry backend listening on port ${server.port} (rate limit ${rpm} req/min/IP)`);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  console.log(`received ${signal}; shutting down`);
  server.stop();
  await db.close();
  process.exit(0);
};

process.on('SIGINT', (signal) => {
  void shutdown(signal);
});
process.on('SIGTERM', (signal) => {
  void shutdown(signal);
});
