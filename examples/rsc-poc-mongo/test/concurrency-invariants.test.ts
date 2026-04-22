/**
 * Integration tests pinning the Mongo-side concurrency invariants.
 *
 * Mongo counterpart to `examples/rsc-poc-postgres/test/always-mode-invariant.test.ts`.
 * The Postgres tests pin H2 (redundant cold-start marker reads under
 * `onFirstUse`) and H3 (per-query verification under `always`). Neither
 * applies on Mongo: `MongoRuntimeImpl` has no verification state and
 * issues no marker reads — that's hypothesis H5 in the project plan.
 *
 * What we *do* pin here:
 *
 * - **H5 asymmetry**: no Mongo command carries a marker-read sibling.
 *   The driver's command counter advances by **exactly K** for K
 *   concurrent queries, not K × some-multiplier, because there is no
 *   pre-query verification.
 *
 * - **Balance invariants under concurrency**: every pool check-out is
 *   matched by a check-in; every command started resolves as either
 *   succeeded or failed. K ∈ {1, 5, 50} covers single-query, RSC page
 *   shape, and well-past-pool-default shapes.
 *
 * - **No cold-start anomaly**: firing a burst of K concurrent queries
 *   on a cold runtime produces exactly K commands — not K + 1 (or
 *   similar) as a stand-in for the Postgres-side H2 race. This is the
 *   test that makes the asymmetry with the Postgres app explicit.
 *
 * ## Test level: process, not HTTP
 *
 * Same rationale as the Postgres invariant test: the observables live
 * in the runtime + driver, not in RSC. HTTP-level coverage comes from
 * the k6 scripts + `/diag`.
 *
 * ## Why MongoMemoryReplSet (not MongoMemoryServer)
 *
 * Matches `retail-store`'s test setup. A replica set is required for
 * transactions and some aggregation features; while we don't use them
 * in this file today, keeping the shape consistent with retail-store
 * means a future test that needs them doesn't have to re-scaffold.
 *
 * Unlike ppg-dev (which the Postgres tests must skip around because it
 * rejects concurrent connections), `mongodb-memory-server` accepts
 * concurrent connections, so these tests run in CI without any
 * conditional guards.
 *
 * ## Why each test builds its own runtime
 *
 * Same reasoning as the Postgres side: tests need cold-start behavior
 * for at least one phase of their assertions, and `lib/db.ts`'s
 * `globalThis` registry would otherwise bleed state between tests.
 * Each test builds a disposable client + runtime against the shared
 * `MongoMemoryReplSet` and drops the database before running.
 */

import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  recordCommandFailed,
  recordCommandStarted,
  recordCommandSucceeded,
  recordConnectionCheckedIn,
  recordConnectionCheckedOut,
  recordConnectionClosed,
  recordConnectionCreated,
  reset,
  snapshot,
} from '../src/lib/diag';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

interface TestRuntime {
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
  readonly orm: ReturnType<typeof mongoOrm<Contract>>;
  readonly poolMax: number;
  close(): Promise<void>;
}

const { contract } = validateMongoContract<Contract>(contractJson);

let sharedReplSet: MongoMemoryReplSet | undefined;

async function getSharedReplSet(): Promise<MongoMemoryReplSet> {
  if (!sharedReplSet) {
    sharedReplSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  }
  return sharedReplSet;
}

/**
 * Wires a fresh MongoClient + Prisma Next Mongo runtime against the
 * shared in-memory replica set, attaching the same event listeners the
 * app's `lib/db.ts` does so the diagnostic counters behave identically.
 * Mirrors `createEntry()` in `src/lib/db.ts` closely enough that the
 * instrumentation under test is the real thing, not a stub.
 */
async function createTestRuntime(poolMax: number): Promise<TestRuntime> {
  const replSet = await getSharedReplSet();
  const uri = replSet.getUri();
  // Unique DB per test run so no ordering coupling between tests.
  const dbName = `rsc_poc_mongo_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

  const client = new MongoClient(uri, {
    maxPoolSize: poolMax,
    monitorCommands: true,
    waitQueueTimeoutMS: 5_000,
  });

  // Attach listeners BEFORE connect() so we don't miss setup-time
  // events. Mirrors `lib/db.ts` exactly.
  client.on('commandStarted', () => recordCommandStarted(poolMax));
  client.on('commandSucceeded', () => recordCommandSucceeded(poolMax));
  client.on('commandFailed', () => recordCommandFailed(poolMax));
  client.on('connectionCheckedOut', () => recordConnectionCheckedOut(poolMax));
  client.on('connectionCheckedIn', () => recordConnectionCheckedIn(poolMax));
  client.on('connectionCreated', () => recordConnectionCreated(poolMax));
  client.on('connectionClosed', () => recordConnectionClosed(poolMax));

  await client.connect();

  const driver = MongoDriverImpl.fromDb(client.db(dbName));
  const adapter = createMongoAdapter();
  const runtime = createMongoRuntime({ adapter, driver, contract, targetId: 'mongo' });
  const orm = mongoOrm({ contract, executor: runtime });

  // Seed minimal data so reads return something the ORM's stitching
  // actually does work on.
  await orm.products.create({
    name: 'Test Shirt',
    brand: 'Test',
    code: 'TST-001',
    description: 'Test product',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 19.99, currency: 'USD' },
    image: { url: '/images/products/tst-001.jpg' },
    embedding: null,
  });

  return {
    client,
    runtime,
    orm,
    poolMax,
    async close() {
      await runtime.close();
      await client.close();
    },
  };
}

/**
 * Exercises the same ORM path the five Server Components use. A
 * simpler `runtime.execute(somePlan)` would bypass `acquireRuntimeScope`
 * equivalents — we want the production-shape path so the test catches
 * regressions in the same place users would see them.
 */
async function runOneQuery(rt: TestRuntime): Promise<void> {
  await rt.orm.products.take(1).all();
}

async function runKParallelQueries(rt: TestRuntime, k: number): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  for (let i = 0; i < k; i++) {
    tasks.push(runOneQuery(rt));
  }
  await Promise.all(tasks);
}

async function withFreshRuntime(
  poolMax: number,
  fn: (rt: TestRuntime) => Promise<void>,
): Promise<void> {
  // Counters persist via `globalThis`; clear before the test so its
  // snapshot reflects only its own work. Seed calls in
  // `createTestRuntime` also emit events, so we reset AFTER creating
  // the runtime (but before the test's own queries).
  const rt = await createTestRuntime(poolMax);
  reset();
  try {
    await fn(rt);
  } finally {
    await rt.close();
  }
}

describe(
  'Mongo runtime invariants under concurrency',
  { timeout: timeouts.spinUpMongoMemoryServer },
  () => {
    beforeAll(async () => {
      // Warm up the replica set once up front so the first test doesn't
      // absorb the binary-download delay.
      await getSharedReplSet();
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      if (sharedReplSet) {
        await sharedReplSet.stop();
        sharedReplSet = undefined;
      }
    }, timeouts.spinUpMongoMemoryServer);

    afterEach(() => {
      reset();
    });

    describe('H5 — no marker reads, no cold-start race', () => {
      it.each([
        { name: 'K=1 (single query)', k: 1 },
        { name: 'K=5 (matches the RSC page shape)', k: 5 },
        { name: 'K=50 (well past the default pool max)', k: 50 },
      ])('K concurrent queries issue exactly K commands, with no verification multiplier: $name', async ({
        k,
      }) => {
        await withFreshRuntime(100, async (rt) => {
          await runKParallelQueries(rt, k);
          const snap = snapshot(100);

          // The core H5 invariant: no marker-read multiplier. If
          // Mongo ever grew a verification round-trip per query,
          // `commandsStarted` would exceed K and this test would
          // surface it immediately.
          expect(snap.commandsStarted).toBe(k);

          // Every command resolves as either succeeded or failed.
          // With this dataset (trivial find on a 1-row collection)
          // all should succeed, but the balance invariant is the
          // stable assertion — it holds even if the fixture grows.
          expect(snap.commandsStarted).toBe(snap.commandsSucceeded + snap.commandsFailed);
          expect(snap.commandsFailed).toBe(0);
        });
      });

      it('cold-start burst issues exactly K commands (no H2 analogue)', async () => {
        await withFreshRuntime(100, async (rt) => {
          const K = 5;

          // First burst on a cold-ish runtime. This is the mirror of
          // the Postgres H2 test, where the same burst on `onFirstUse`
          // mode produces 1..K marker reads. On Mongo we expect
          // exactly K commands and zero extra — no verification
          // path exists to race on.
          await runKParallelQueries(rt, K);
          const coldSnap = snapshot(100);

          expect(coldSnap.commandsStarted).toBe(K);
          expect(coldSnap.commandsStarted).toBe(
            coldSnap.commandsSucceeded + coldSnap.commandsFailed,
          );

          // Second burst. On the Postgres side the warm-burst snapshot
          // would show no new marker reads; on Mongo it's just +K more
          // commands. Same arithmetic, different underlying mechanism.
          await runKParallelQueries(rt, K);
          const warmSnap = snapshot(100);

          expect(warmSnap.commandsStarted).toBe(coldSnap.commandsStarted + K);
          expect(warmSnap.commandsStarted).toBe(
            warmSnap.commandsSucceeded + warmSnap.commandsFailed,
          );
        });
      });
    });

    describe('Balance invariants', () => {
      it.each([
        { name: 'K=1', k: 1, poolMax: 100 },
        { name: 'K=5', k: 5, poolMax: 100 },
        { name: 'K=50 with large pool', k: 50, poolMax: 100 },
        { name: 'K=50 with small pool (contention)', k: 50, poolMax: 5 },
      ])('pool check-outs and check-ins balance: $name', async ({ k, poolMax }) => {
        await withFreshRuntime(poolMax, async (rt) => {
          await runKParallelQueries(rt, k);
          const snap = snapshot(poolMax);

          // Every pool check-out resolves to a check-in. Desync
          // here would indicate either an instrumentation bug or a
          // real connection leak in the driver/runtime. Holds under
          // contention too (K=50 on poolMax=5) because waiters
          // queue rather than leaking.
          expect(snap.connectionsCheckedOut).toBe(snap.connectionsCheckedIn);

          // At least K check-outs happened (one per query). More
          // is fine — internal driver monitoring may contribute.
          expect(snap.connectionsCheckedOut).toBeGreaterThanOrEqual(k);
        });
      });

      it('repeated bursts keep balance and linearly grow command count', async () => {
        await withFreshRuntime(100, async (rt) => {
          const K = 5;
          const BURSTS = 3;

          for (let i = 0; i < BURSTS; i++) {
            await runKParallelQueries(rt, K);
          }

          const snap = snapshot(100);

          // K commands per burst, cumulative.
          expect(snap.commandsStarted).toBe(K * BURSTS);
          expect(snap.commandsStarted).toBe(snap.commandsSucceeded + snap.commandsFailed);
          expect(snap.commandsFailed).toBe(0);

          // Balance holds across bursts.
          expect(snap.connectionsCheckedOut).toBe(snap.connectionsCheckedIn);
        });
      });
    });
  },
);
