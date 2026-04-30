/**
 * Process-scoped Prisma Next Mongo runtime singleton for Next.js App
 * Router.
 *
 * Mirrors `examples/rsc-poc-postgres/src/lib/db.ts` in intent: one
 * runtime per Node process, pinned to `globalThis` so Next.js dev-mode
 * HMR doesn't leak a new MongoClient on every edit. In production the
 * `globalThis` pattern collapses to a plain module-level singleton.
 *
 * ## Key differences from the Postgres side
 *
 * 1. **No `verifyMode`.** `MongoRuntimeImpl` has no verification state
 *    and does no marker reads — this is hypothesis H5 in the project
 *    plan. The registry keys by `poolMax` alone.
 *
 * 2. **No `InstrumentedPool` subclass.** The Mongo driver owns its
 *    pool inside `MongoClient` and that class isn't designed to be
 *    subclassed. Instead, we attach listeners for the documented
 *    `CMAP` (connection monitoring) and `APM` (command monitoring)
 *    events before `client.connect()`, and push counts into the
 *    `lib/diag` registry from those handlers. See the listener setup
 *    in `createEntry()` below.
 *
 * 3. **We build the driver via `MongoDriverImpl.fromDb`.** The
 *    convenience `createMongoDriver(uri, dbName)` factory constructs
 *    its own MongoClient internally, leaving us no place to attach
 *    listeners before `connect()`. `fromDb` accepts a pre-built `Db`,
 *    so we construct the `MongoClient` ourselves, wire up monitoring,
 *    connect, hand the resolved `Db` to the driver, and keep the
 *    client reference for a clean shutdown.
 */
import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm, mongoRaw } from '@prisma-next/mongo-orm';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { MongoClient } from 'mongodb';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };
import {
  recordCommandFailed,
  recordCommandStarted,
  recordCommandSucceeded,
  recordConnectionCheckedIn,
  recordConnectionCheckedOut,
  recordConnectionClosed,
  recordConnectionCreated,
} from './diag';

/**
 * Shape of the Prisma Next Mongo surface we expose to the rest of the
 * app. Mirrors the retail-store example's `Db` type so queries written
 * against one style port over easily.
 */
export interface Db {
  readonly orm: ReturnType<typeof mongoOrm<Contract>>;
  readonly query: ReturnType<typeof mongoQuery<Contract>>;
  readonly raw: ReturnType<typeof mongoRaw>;
  readonly runtime: MongoRuntime;
  readonly contract: ReturnType<typeof validateMongoContract<Contract>>['contract'];
}

interface DbEntry {
  readonly db: Db;
  readonly client: MongoClient;
  readonly poolMax: number;
}

type DbRegistry = Map<number, DbEntry>;

const REGISTRY_KEY = Symbol.for('prisma-next.rsc-poc-mongo.registry');

interface GlobalWithRegistry {
  [REGISTRY_KEY]?: DbRegistry;
}

function getRegistry(): DbRegistry {
  const g = globalThis as unknown as GlobalWithRegistry;
  let registry = g[REGISTRY_KEY];
  if (!registry) {
    registry = new Map();
    g[REGISTRY_KEY] = registry;
  }
  return registry;
}

export interface DbOptions {
  /**
   * Max Mongo driver pool size (`maxPoolSize` on MongoClient). The
   * `/stress/pool-pressure` route pins a small value to exercise
   * hypothesis H4 (pool contention under RSC concurrency). Defaults to
   * 100, which is also the Mongo driver's default.
   *
   * Explicit `undefined` is accepted (with `exactOptionalPropertyTypes`)
   * so pass-through call sites don't need conditional-spread
   * boilerplate.
   */
  readonly poolMax?: number | undefined;
}

function readConnectionConfig(): { readonly uri: string; readonly dbName: string } {
  const uri = process.env['DB_URL'];
  if (!uri) {
    throw new Error(
      'DB_URL is not set. Copy .env.example to .env and set a MongoDB connection string.',
    );
  }
  const dbName = process.env['MONGODB_DB'] ?? 'rsc-poc-mongo';
  return { uri, dbName };
}

const { contract } = validateMongoContract<Contract>(contractJson);
const query = mongoQuery<Contract>({ contractJson });
const raw = mongoRaw({ contract });

async function createEntry(poolMax: number): Promise<DbEntry> {
  const { uri, dbName } = readConnectionConfig();

  const client = new MongoClient(uri, {
    maxPoolSize: poolMax,
    monitorCommands: true,
    // Time out cleanly under pool pressure rather than hanging — this
    // is the Mongo analogue of pg's `connectionTimeoutMillis` and lets
    // the `/stress/pool-pressure` scenario produce legible failures
    // rather than wedged requests.
    waitQueueTimeoutMS: 5_000,
  });

  // Attach listeners BEFORE connect(). The driver emits
  // `connectionPoolCreated` during connect() setup — if we attached
  // afterward we'd miss the first batch of events.
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
  const runtime = createMongoRuntime({
    adapter,
    driver,
    contract,
    targetId: 'mongo',
    middleware: [createTelemetryMiddleware()],
  });
  const orm = mongoOrm({ contract, executor: runtime });

  const db: Db = { orm, runtime, query, raw, contract };
  return { db, client, poolMax };
}

/**
 * Returns a Prisma Next Mongo client pinned to the given `poolMax`.
 * Each unique `poolMax` gets its own singleton, so `/` (default pool)
 * and `/stress/pool-pressure` (small pool) never share a runtime and
 * their counters remain apples-to-apples.
 *
 * Async because constructing the MongoClient requires awaiting
 * `client.connect()` before the runtime can serve requests. Server
 * Components that call this will suspend on the first request and
 * resolve synchronously thereafter (the cached entry is returned
 * without awaiting).
 */
export async function getDb(options: DbOptions = {}): Promise<Db> {
  const poolMax = options.poolMax ?? 100;
  const registry = getRegistry();
  const existing = registry.get(poolMax);
  if (existing) {
    return existing.db;
  }

  const entry = await createEntry(poolMax);
  // Race guard: if two concurrent callers both miss the cache, the
  // first to reach this line wins; the second's entry is dropped and
  // its client closed to avoid leaking an unused pool.
  const raced = registry.get(poolMax);
  if (raced) {
    await entry.client.close().catch(() => undefined);
    return raced.db;
  }
  registry.set(poolMax, entry);
  return entry.db;
}

/**
 * Returns the underlying MongoClient for a given `poolMax`, if one
 * has been instantiated. Used by the diagnostics panel and `/diag`
 * route to surface live pool stats (approximated via `client.topology`
 * / server descriptions).
 */
export function getClient(options: DbOptions = {}): MongoClient | undefined {
  const poolMax = options.poolMax ?? 100;
  return getRegistry().get(poolMax)?.client;
}
