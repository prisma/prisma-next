/**
 * Real-cloud integration test for `@prisma-next/prisma-postgres-serverless`.
 *
 * Proves the facade's ORM round-trips through the real PPG WebSocket
 * wire protocol end-to-end against a real Prisma Postgres database.
 * Every other test in the facade and driver packages mocks the PPG
 * client at the `Client.newSession` boundary; wire-level serialization,
 * auth, and WS framing are not covered there.
 *
 * Lifecycle per run:
 *   beforeAll: provision a fresh project via the Management API,
 *              apply the contract via the facade's `./control` surface
 *              (TCP path — control plane is TCP-only by design;
 *              `./control` re-exports `@prisma-next/postgres/control`).
 *   it × 3:    INSERT + SELECT via ORM, transaction COMMIT, transaction
 *              ROLLBACK — all through the facade's data plane (PPG
 *              wire protocol over WebSocket).
 *   afterAll:  close the facade, drop the temp `migrationsDir`,
 *              DELETE the project via the Management API.
 *
 * Skipped silently when `PRISMA_POSTGRES_SERVICE_TOKEN` is unset
 * (local development, fork PR runs). On prisma/prisma-next-owned CI
 * runs the workflow YAML's require-token step hard-fails before this
 * suite is reached if the secret is missing.
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

/**
 * Retry an async operation with a fixed backoff schedule when its
 * thrown error matches `isTransient`. Non-transient errors propagate
 * immediately. Used in `beforeAll` to wait out Prisma Postgres's TCP
 * gateway warm-up window (see comment at the call site).
 */
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

/**
 * Recognise Prisma Postgres's TCP gateway warm-up rejection. The
 * gateway returns a non-Postgres-shape `ErrorResponse` packet during
 * the brief window after `POST /v1/projects` returns `status: "ready"`
 * but before the gateway has finished routing to the backend Postgres
 * engine. The message string is the same whether the error surfaces
 * bare (from `pg`) or wrapped (from the framework's `errorRuntime`,
 * which puts the original message into a `why` field).
 */
function isGatewayWarmupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const marker = 'Failed to connect to upstream database';
  if (err.message.includes(marker)) return true;
  if ('why' in err && typeof err.why === 'string') {
    return err.why.includes(marker);
  }
  return false;
}

/**
 * Minimal one-model contract. `field.id.uuidv7()` is the canonical
 * generated-id preset across the workspace (used by the CLI's `init`
 * scaffold). The SQL ORM's `CreateInput` type currently requires the
 * id field even when the contract has a runtime execution default,
 * so this test passes explicit ids — same pattern as
 * `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts`.
 * From the PPG wire protocol's perspective the explicit-id path is
 * indistinguishable from the executed-default path; what matters here
 * is the round-trip, not which side generated the id.
 */
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

    // Provision the project + its default database (one Management
    // API call). The response carries the project id (for teardown)
    // and the database with all connection variants.
    const { data: response, error } = await mgmt.POST('/v1/projects', {
      body: { name, region: REGION },
    });
    if (error || !response) {
      throw new Error(`mgmt-api: provision failed: ${JSON.stringify(error ?? 'no data')}`);
    }
    // Capture the id before anything else can throw — the afterAll
    // teardown needs it to delete the project even if schema apply
    // (the more failure-prone step) blows up.
    projectId = response.data.id;

    // Prisma Postgres returns one connection per database with all
    // endpoint variants populated. `endpoints` is a discriminated
    // bag of three URL forms — one per protocol the platform speaks:
    //   - `direct`:     `postgres://…@<host>:5432/…` for raw TCP /
    //                   `pg` (control plane: DDL, migrations).
    //   - `pooled`:     `postgres://identifier:key@db.prisma.io:5432/…`
    //                   for PPG's raw-SQL WebSocket protocol
    //                   (data plane: `@prisma/ppg`).
    //   - `accelerate`: `prisma+postgres://accelerate.prisma-data.net/?api_key=…`
    //                   for Prisma Accelerate / data-proxy's GraphQL
    //                   protocol (consumed by `@prisma/client/edge`,
    //                   NOT by `@prisma/ppg`).
    // The `prisma+postgres://…api_key=…` form looks PPG-y because it
    // shares the scheme with `@prisma/dev`'s endpoint, but the wire
    // protocol underneath is GraphQL/Accelerate, not PPG. For PPG,
    // take the `pooled` endpoint.
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

    // `dbInit` requires a `migrationsDir` even on a from-scratch
    // apply: the per-space flow reads on-disk refs from it. An empty
    // temp dir is sufficient — the planner generates the create-
    // from-scratch operations directly from the contract. Same
    // pattern as the framework e2e harness's `runDbInit` helper.
    const dir = await mkdtemp(join(tmpdir(), 'pn-cloud-it-'));
    migrationsDir = dir;

    // Prisma Postgres's TCP gateway has a brief warm-up window after
    // `POST /v1/projects` returns `status: "ready"` — during which
    // the gateway transient-rejects pg.Client connections with a
    // non-Postgres-shape ErrorResponse ("Failed to connect to
    // upstream database…"). Observed warm-up ~5–10s. Retry the whole
    // `dbInit` call (which internally calls `pg.Client.connect`) on
    // that specific envelope; any other error class is non-transient
    // and surfaces immediately.
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
    // Best-effort teardown: each step is guarded so a failure in one
    // does not prevent the others. Resource leaks (the cloud
    // project) are the only step whose failure produces a
    // human-actionable breadcrumb.
    try {
      await db?.close();
    } catch {
      // facade close never fails today, but be defensive
    }

    if (migrationsDir !== undefined) {
      await rm(migrationsDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (!projectId) return;
    const { error } = await mgmt.DELETE('/v1/projects/{id}', {
      params: { path: { id: projectId } },
    });
    if (error) {
      // Surface the leak so manual cleanup is possible; do not fail
      // the suite (provision + tests already ran).
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
      .catch(() => {
        // `withTransaction` re-throws the callback's error after the
        // rollback succeeds. Absorb here so the test continues to
        // the read-back assertion that proves the row was discarded.
      });

    const rows = await db.orm.Item.all();
    const names = rows.map((row) => row.name).sort();
    expect(names).toEqual(['alice', 'bob']);
  }, 60_000);
});
