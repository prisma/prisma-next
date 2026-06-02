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

    // Two connection strings live on the same database, one per
    // protocol: the `accelerate`-kind connection carries the PPG
    // WebSocket URL (data plane); the `postgres`-kind connection
    // carries the TCP direct URL (control plane). The serverless
    // facade's control surface uses TCP because DDL doesn't go over
    // the Accelerate protocol; the data plane uses PPG because that
    // is the whole point of this package.
    const database = response.data.database;
    const accelerateConn = database?.connections.find((c) => c.kind === 'accelerate');
    const tcpConn = database?.connections.find((c) => c.kind === 'postgres');
    const ppgUrl = accelerateConn?.endpoints.accelerate?.connectionString;
    const tcpUrl = tcpConn?.endpoints.direct?.connectionString;
    if (!ppgUrl) {
      throw new Error(`mgmt-api: project ${projectId} has no accelerate connection string`);
    }
    if (!tcpUrl) {
      throw new Error(`mgmt-api: project ${projectId} has no direct TCP connection string`);
    }

    // `dbInit` requires a `migrationsDir` even on a from-scratch
    // apply: the per-space flow reads on-disk refs from it. An empty
    // temp dir is sufficient — the planner generates the create-
    // from-scratch operations directly from the contract. Same
    // pattern as the framework e2e harness's `runDbInit` helper.
    migrationsDir = await mkdtemp(join(tmpdir(), 'pn-cloud-it-'));

    const controlClient = createPostgresControlClient({ connection: tcpUrl });
    try {
      const result = await controlClient.dbInit({
        contract,
        mode: 'apply',
        migrationsDir,
      });
      if (!result.ok) {
        throw new Error(
          `dbInit failed: ${result.failure.summary}\n\n${JSON.stringify(result.failure, null, 2)}`,
        );
      }
    } finally {
      await controlClient.close();
    }

    db = prismaPostgresServerless({ contract, url: ppgUrl });
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
