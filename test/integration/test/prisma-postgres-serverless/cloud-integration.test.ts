/**
 * Real-cloud integration test: provisions a fresh Prisma Postgres project
 * via the Management API, applies the contract over TCP (control plane),
 * exercises ORM round-trip + transaction COMMIT/ROLLBACK over PPG WebSocket
 * (data plane), then deletes the project. Skipped without
 * `PRISMA_POSTGRES_SERVICE_TOKEN`; the CI workflow hard-fails own-repo PR
 * runs missing the secret.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManagementApiClient } from '@prisma/management-api-sdk';
import { defineContract } from '@prisma-next/prisma-postgres-serverless/contract-builder';
import { createPostgresControlClient } from '@prisma-next/prisma-postgres-serverless/control';
import prismaPostgresServerless, {
  type PrismaPostgresServerlessClient,
} from '@prisma-next/prisma-postgres-serverless/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVICE_TOKEN = process.env['PRISMA_POSTGRES_SERVICE_TOKEN'];
const REGION = 'us-east-1' as const;

/** Used in `beforeAll` to wait out PPG's TCP gateway warm-up window. */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: {
    readonly backoffSchedule: ReadonlyArray<number>;
    readonly isTransient: (err: unknown) => boolean;
    readonly onAttempt?: (
      attempt: number,
      elapsedMs: number,
      outcome: 'ok' | 'transient' | 'fatal',
    ) => void;
  },
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  for (let i = 0; i < opts.backoffSchedule.length; i++) {
    const waitMs = opts.backoffSchedule[i] ?? 0;
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const elapsed = Date.now() - start;
    try {
      const result = await fn();
      opts.onAttempt?.(i + 1, elapsed, 'ok');
      return result;
    } catch (err) {
      lastErr = err;
      if (!opts.isTransient(err)) {
        opts.onAttempt?.(i + 1, elapsed, 'fatal');
        throw err;
      }
      opts.onAttempt?.(i + 1, elapsed, 'transient');
    }
  }
  throw lastErr;
}

// PPG's TCP gateway transient-rejects with a non-Postgres ErrorResponse during
// the warm-up window between `POST /v1/projects` returning `status: "ready"`
// and the gateway finishing its backend routing. The marker string is the same
// whether the error surfaces bare (from `pg`) or wrapped (framework's
// `errorRuntime` moves it into `why`).
function isGatewayWarmupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const marker = 'Failed to connect to upstream database';
  if (err.message.includes(marker)) return true;
  if ('why' in err && typeof err.why === 'string') {
    return err.why.includes(marker);
  }
  return false;
}

// Explicit ids on `create(...)`: `defineContract`'s factory form doesn't yet
// propagate field-level execution defaults to `CreateInput` type-level
// optionality. Same pattern as `collection-mutation-defaults.test.ts`.
const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Item: model('Item', {
      fields: {
        id: field.id.uuidv7(),
        name: field.text(),
      },
    }),
  },
}));

type Contract = typeof contract;

describe.skipIf(!SERVICE_TOKEN)('prisma-postgres-serverless / cloud ORM round-trip', () => {
  let mgmt: ReturnType<typeof createManagementApiClient>;
  let projectId: string | undefined;
  let migrationsDir: string | undefined;
  let db: PrismaPostgresServerlessClient<Contract> | undefined;

  beforeAll(async () => {
    mgmt = createManagementApiClient({ token: SERVICE_TOKEN! });
    const name = `pn-ci-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const { data: response, error } = await mgmt.POST('/v1/projects', {
      body: { name, region: REGION },
    });
    if (error || !response) {
      throw new Error(`mgmt-api: provision failed: ${JSON.stringify(error ?? 'no data')}`);
    }
    // Capture the id before anything else can throw — afterAll needs it to
    // teardown the project even if dbInit (the failure-prone step) blows up.
    projectId = response.data.id;

    // `endpoints.pooled` is the PPG raw-SQL endpoint (data plane);
    // `endpoints.direct` is raw TCP (control plane). `endpoints.accelerate`
    // is the GraphQL data-proxy and is NOT consumable by `@prisma/ppg`
    // despite the shared `prisma+postgres://` scheme.
    const database = response.data.database;
    const conn = database?.connections[0];
    const ppgUrl = conn?.endpoints.pooled?.connectionString;
    const tcpUrl = conn?.endpoints.direct?.connectionString;
    if (!ppgUrl) {
      throw new Error(`mgmt-api: project ${projectId} has no pooled (PPG) connection endpoint`);
    }
    if (!tcpUrl) {
      throw new Error(`mgmt-api: project ${projectId} has no direct TCP connection endpoint`);
    }

    // `dbInit` requires a `migrationsDir` even from-scratch (per-space flow
    // reads on-disk refs from it); an empty temp dir is sufficient.
    const dir = await mkdtemp(join(tmpdir(), 'pn-cloud-it-'));
    migrationsDir = dir;

    // PPG's TCP gateway has a ~5–10s warm-up window after `POST /v1/projects`
    // returns ready, during which `pg.Client.connect` transient-rejects with
    // `isGatewayWarmupError`. Retry only on that envelope; everything else
    // surfaces immediately.
    const controlClient = createPostgresControlClient({ connection: tcpUrl });
    try {
      const result = await retryWithBackoff(
        () => controlClient.dbInit({ contract, mode: 'apply', migrationsDir: dir }),
        {
          backoffSchedule: [0, 5_000, 10_000, 20_000, 40_000],
          isTransient: isGatewayWarmupError,
          onAttempt: (attempt, elapsedMs, outcome) => {
            console.log(
              `dbInit attempt ${attempt} at t=${(elapsedMs / 1000).toFixed(1)}s: ${outcome}`,
            );
          },
        },
      );
      if (!result.ok) {
        throw new Error(
          `dbInit failed: ${result.failure.summary}\n\n${JSON.stringify(result.failure, null, 2)}`,
        );
      }
    } finally {
      await controlClient.close();
    }

    db = prismaPostgresServerless({ contract, binding: { kind: 'url', url: ppgUrl } });
    await db.connect();
  }, 120_000);

  afterAll(async () => {
    // Each step is guarded so one failure does not block the rest; the
    // project-delete failure mode is the only one with a real leak cost.
    try {
      await db?.close();
    } catch {}

    if (migrationsDir !== undefined) {
      await rm(migrationsDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (!projectId) return;
    const { error } = await mgmt.DELETE('/v1/projects/{id}', {
      params: { path: { id: projectId } },
    });
    if (error) {
      // Leak the breadcrumb instead of failing the suite — provision + tests
      // already ran, manual cleanup is still possible from the project id.
      console.warn(
        `mgmt-api: teardown leak — manual delete needed for project ${projectId}:`,
        JSON.stringify(error),
      );
    }
  }, 60_000);

  it('round-trips INSERT and SELECT through the ORM', async () => {
    if (!db) throw new Error('db not initialised — beforeAll failed');
    const aliceId = randomUUID();
    const created = await db.orm.Item.create({ id: aliceId, name: 'alice' });
    expect(created.name).toBe('alice');
    expect(created.id).toBe(aliceId);

    const rows = await db.orm.Item.all();
    expect(rows).toEqual([{ id: aliceId, name: 'alice' }]);
  }, 60_000);

  it('commits a transaction', async () => {
    if (!db) throw new Error('db not initialised — beforeAll failed');
    const bobId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.orm.Item.create({ id: bobId, name: 'bob' });
    });

    const rows = await db.orm.Item.all();
    const names = rows.map((row) => row.name).sort();
    expect(names).toEqual(['alice', 'bob']);
  }, 60_000);

  it('rolls back a transaction on thrown error', async () => {
    if (!db) throw new Error('db not initialised — beforeAll failed');
    const carolId = randomUUID();
    await db
      .transaction(async (tx) => {
        await tx.orm.Item.create({ id: carolId, name: 'carol' });
        throw new Error('intentional rollback');
      })
      .catch(() => {});

    const rows = await db.orm.Item.all();
    const names = rows.map((row) => row.name).sort();
    expect(names).toEqual(['alice', 'bob']);
  }, 60_000);
});
