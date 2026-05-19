import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTelemetryDb, type TelemetryDb } from '../src/db';
import { createHandler } from '../src/handler';
import { createTokenBucketRateLimiter } from '../src/rate-limiter';

const CREATE_TABLE = `
  CREATE TABLE telemetry_event (
    id BIGSERIAL PRIMARY KEY,
    "ingestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "installationId" TEXT NOT NULL,
    version TEXT NOT NULL,
    command TEXT NOT NULL,
    flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    "runtimeName" TEXT NOT NULL,
    "runtimeVersion" TEXT NOT NULL,
    os TEXT NOT NULL,
    arch TEXT NOT NULL,
    "packageManager" TEXT,
    "databaseTarget" TEXT,
    "tsVersion" TEXT,
    agent TEXT,
    extensions JSONB NOT NULL DEFAULT '[]'::jsonb
  )
`;

const validPayload = {
  installationId: 'install-rl',
  version: '0.8.0',
  command: 'init',
  runtimeName: 'node',
  runtimeVersion: '24.13.0',
  os: 'darwin',
  arch: 'arm64',
};

describe('rate-limited POST /events', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let pg: Client;
  let db: TelemetryDb;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    pg = new Client({ connectionString: database.connectionString });
    await pg.connect();
    await pg.query('DROP TABLE IF EXISTS telemetry_event');
    await pg.query(CREATE_TABLE);
    db = createTelemetryDb(database.connectionString);
  });

  afterEach(async () => {
    await db.close();
    await pg.end();
  });

  function postFrom(handler: ReturnType<typeof createHandler>, ip: string): Promise<Response> {
    return handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify(validPayload),
      }),
    );
  }

  async function countRows(): Promise<number> {
    const { rows } = await pg.query<{ n: number }>(
      'SELECT count(*)::int as n FROM telemetry_event',
    );
    return rows[0]?.n ?? 0;
  }

  it('rejects over-limit requests with 429 while continuing to accept compliant clients', async () => {
    const rateLimiter = createTokenBucketRateLimiter({
      capacity: 3,
      refillTokensPerMs: 0,
      now: () => 0,
    });
    const handler = createHandler({ db, rateLimiter });

    const compliantStatuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      compliantStatuses.push((await postFrom(handler, '203.0.113.10')).status);
    }
    expect(compliantStatuses).toEqual([202, 202, 202]);

    const burstStatuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      burstStatuses.push((await postFrom(handler, '203.0.113.10')).status);
    }
    expect(burstStatuses).toEqual([429, 429, 429, 429, 429]);

    const otherIpStatus = (await postFrom(handler, '198.51.100.20')).status;
    expect(otherIpStatus).toBe(202);

    expect(await countRows()).toBe(4);
  });

  it('admits new requests after the bucket refills', async () => {
    let now = 0;
    const rateLimiter = createTokenBucketRateLimiter({
      capacity: 2,
      refillTokensPerMs: 1 / 1000,
      now: () => now,
    });
    const handler = createHandler({ db, rateLimiter });

    expect((await postFrom(handler, '203.0.113.30')).status).toBe(202);
    expect((await postFrom(handler, '203.0.113.30')).status).toBe(202);
    expect((await postFrom(handler, '203.0.113.30')).status).toBe(429);

    now = 1000;
    expect((await postFrom(handler, '203.0.113.30')).status).toBe(202);

    expect(await countRows()).toBe(3);
  });
});
