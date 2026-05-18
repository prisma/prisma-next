import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTelemetryDb, type TelemetryDb } from '../src/db';
import { createHandler } from '../src/handler';

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

const REQUIRED_FIELDS = [
  'installationId',
  'version',
  'command',
  'runtimeName',
  'runtimeVersion',
  'os',
  'arch',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

function baseRequiredPayload(): Record<RequiredField, string> {
  return {
    installationId: 'install-base',
    version: '0.8.0',
    command: 'init',
    runtimeName: 'node',
    runtimeVersion: '24.13.0',
    os: 'darwin',
    arch: 'arm64',
  };
}

describe('telemetry POST /events', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let pg: Client;
  let db: TelemetryDb;
  let handler: ReturnType<typeof createHandler>;

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
    handler = createHandler({ db });
  });

  afterEach(async () => {
    await db.close();
    await pg.end();
  });

  async function postEvent(payload: unknown): Promise<Response> {
    return handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  }

  interface TelemetryRow {
    readonly installationId: string;
    readonly version: string;
    readonly command: string;
    readonly flags: readonly string[];
    readonly runtimeName: string;
    readonly runtimeVersion: string;
    readonly os: string;
    readonly arch: string;
    readonly packageManager: string | null;
    readonly databaseTarget: string | null;
    readonly tsVersion: string | null;
    readonly agent: string | null;
    readonly extensions: readonly string[];
    readonly ingestedAt: Date;
  }

  async function fetchSingleRow(): Promise<TelemetryRow> {
    const { rows } = await pg.query<TelemetryRow>('SELECT * FROM telemetry_event ORDER BY id ASC');
    expect(rows.length).toBe(1);
    return rows[0] as TelemetryRow;
  }

  async function rowCount(): Promise<number> {
    const { rows } = await pg.query<{ n: number }>(
      'SELECT count(*)::int as n FROM telemetry_event',
    );
    return rows[0]?.n ?? 0;
  }

  it('accepts events carrying the required-set, optional fields, and unknown future fields; unknown keys are dropped before storage', async () => {
    const payload = {
      ...baseRequiredPayload(),
      installationId: 'install-superset',
      flags: ['yes', 'verbose'],
      packageManager: 'pnpm/10.27.0',
      databaseTarget: 'postgres',
      tsVersion: '5.9.3',
      agent: 'claude-code',
      extensions: ['pgvector', 'paradedb'],
      // Forward-compat unknown keys; the backend must silently drop these.
      crashStackHash: 'sha256:abcdef',
      gpuVendor: 'apple',
      experimentalCapabilities: { foo: 'bar' },
    };

    const response = await postEvent(payload);
    expect(response.status).toBe(202);

    const row = await fetchSingleRow();
    expect(row.installationId).toBe('install-superset');
    expect(row.version).toBe('0.8.0');
    expect(row.command).toBe('init');
    expect(row.runtimeName).toBe('node');
    expect(row.runtimeVersion).toBe('24.13.0');
    expect(row.os).toBe('darwin');
    expect(row.arch).toBe('arm64');
    expect(row.flags).toEqual(['yes', 'verbose']);
    expect(row.packageManager).toBe('pnpm/10.27.0');
    expect(row.databaseTarget).toBe('postgres');
    expect(row.tsVersion).toBe('5.9.3');
    expect(row.agent).toBe('claude-code');
    expect(row.extensions).toEqual(['pgvector', 'paradedb']);
    expect(row.ingestedAt).toBeInstanceOf(Date);
    expect(row).not.toHaveProperty('crashStackHash');
    expect(row).not.toHaveProperty('gpuVendor');
    expect(row).not.toHaveProperty('experimentalCapabilities');
  });

  it('accepts events carrying only the required-set; omitted nullable scalars become NULL and omitted arrays become []', async () => {
    const payload = {
      ...baseRequiredPayload(),
      installationId: 'install-subset',
    };

    const response = await postEvent(payload);
    expect(response.status).toBe(202);

    const row = await fetchSingleRow();
    expect(row.installationId).toBe('install-subset');
    expect(row.flags).toEqual([]);
    expect(row.extensions).toEqual([]);
    expect(row.packageManager).toBeNull();
    expect(row.databaseTarget).toBeNull();
    expect(row.tsVersion).toBeNull();
    expect(row.agent).toBeNull();
  });

  describe('rejects payloads missing any required field with 400', () => {
    for (const omitted of REQUIRED_FIELDS) {
      it(`rejects a payload missing ${omitted}`, async () => {
        const { [omitted]: _omitted, ...rest } = baseRequiredPayload();
        const response = await postEvent(rest);
        expect(response.status).toBe(400);
        expect(await rowCount()).toBe(0);
      });
    }
  });

  it('rejects a non-POST request with 405', async () => {
    const response = await handler(new Request('http://localhost/events', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('rejects an unknown path with 404', async () => {
    const response = await handler(
      new Request('http://localhost/nope', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(response.status).toBe(404);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(response.status).toBe(400);
  });
});
