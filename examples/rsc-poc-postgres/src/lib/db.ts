/**
 * Process-scoped Prisma Next runtime singleton for Next.js App Router.
 *
 * Why `globalThis`?
 *
 * Next.js dev mode evaluates this module multiple times under HMR. A plain
 * module-level `let` would produce a new runtime (and a new pg pool) on every
 * edit, exhausting Postgres connection slots within seconds. Pinning the
 * instance to `globalThis` survives HMR re-evaluation while still giving us
 * one runtime per Node process in production.
 *
 * This is exactly the configuration the RSC concurrency PoC is designed to
 * stress: one runtime, many concurrent Server Components sharing it.
 *
 * ## Registry shape
 *
 * We support multiple (verifyMode, poolMax) singletons in the same process
 * because `/` and `/stress/always` test different things and must not share
 * a runtime. Each unique combination gets its own entry in the registry.
 *
 * ## Why we construct the pg Pool ourselves
 *
 * The bundled `@prisma-next/postgres` runtime will build a `pg.Pool` for us
 * if we pass `{ url }`, but we need an **instrumented** subclass
 * (`InstrumentedPool`) that counts connection acquires, releases, and marker
 * reads so the diagnostics panel and the H3 integration test have something
 * to observe. `@prisma-next/postgres` accepts a pre-built `pg.Pool` via the
 * `{ pg }` option, routing it through `resolvePostgresBinding()`'s
 * `instanceof PgPool` check — `InstrumentedPool` subclasses `pg.Pool`, so
 * the check passes.
 */

import pgvector from '@prisma-next/extension-pgvector/runtime';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import type { PostgresClient } from '@prisma-next/postgres/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { RuntimeVerifyOptions } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };
import { InstrumentedPool } from './pool';

export type VerifyMode = RuntimeVerifyOptions['mode'];

interface DbEntry {
  readonly client: PostgresClient<Contract>;
  readonly pool: InstrumentedPool;
  readonly verifyMode: VerifyMode;
  readonly poolMax: number;
}

type DbRegistry = Map<string, DbEntry>;

const REGISTRY_KEY = Symbol.for('prisma-next.rsc-poc-postgres.registry');

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
   * Contract verification mode. Defaults to `onFirstUse` (matches the bundled
   * `@prisma-next/postgres` default). The `/stress/always` route uses
   * `'always'` to reproduce hypothesis H3 (skipped-verification under
   * concurrency).
   *
   * Explicit `undefined` is accepted (with `exactOptionalPropertyTypes`) so
   * pass-through call sites like `getDb({ verifyMode: props.verifyMode })`
   * don't need conditional-spread boilerplate.
   */
  readonly verifyMode?: VerifyMode | undefined;
  /**
   * Max pg pool size. The `pool-pressure` stress scenario uses a small value
   * (e.g. 5) to characterize hypothesis H4 (pool contention under RSC
   * concurrency). Defaults to 10 to match pg's default.
   *
   * Explicit `undefined` is accepted; see `verifyMode` above.
   */
  readonly poolMax?: number | undefined;
}

function registryKey(verifyMode: VerifyMode, poolMax: number): string {
  return `${verifyMode}|${poolMax}`;
}

function readDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and set a Postgres connection string.',
    );
  }
  return url;
}

function createEntry(verifyMode: VerifyMode, poolMax: number): DbEntry {
  const pool = new InstrumentedPool({
    connectionString: readDatabaseUrl(),
    max: poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    verifyMode,
  });

  const client = postgres<Contract>({
    contractJson,
    pg: pool,
    extensions: [pgvector],
    verify: { mode: verifyMode, requireMarker: false },
    // Only telemetry. The demo app adds `lints()` and `budgets(...)`, but
    // those flag ordinary queries the PoC issues (e.g. unbounded aggregates
    // on small seed data) as errors, which distracts from what we're
    // actually measuring. The PoC cares about runtime/pool behavior under
    // RSC concurrency, not query-shape ergonomics.
    middleware: [createTelemetryMiddleware()],
  });

  return { client, pool, verifyMode, poolMax };
}

/**
 * Returns a Prisma Next Postgres client pinned to the given `verifyMode` and
 * `poolMax`. Each unique (verifyMode, poolMax) combination gets its own
 * singleton, so the default `/` page and `/stress/always` route don't share
 * a runtime — they're probing different hypotheses.
 */
export function getDb(options: DbOptions = {}): PostgresClient<Contract> {
  const verifyMode: VerifyMode = options.verifyMode ?? 'onFirstUse';
  const poolMax = options.poolMax ?? 10;
  const key = registryKey(verifyMode, poolMax);
  const registry = getRegistry();

  let entry = registry.get(key);
  if (!entry) {
    entry = createEntry(verifyMode, poolMax);
    registry.set(key, entry);
  }
  return entry.client;
}

/**
 * Returns the underlying `InstrumentedPool` for a given (verifyMode, poolMax)
 * combination, or `undefined` if no runtime has been instantiated for it yet.
 * Used by the diagnostics panel to report pool stats (`pool.totalCount`,
 * `pool.idleCount`, `pool.waitingCount`).
 */
export function getPool(options: DbOptions = {}): InstrumentedPool | undefined {
  const verifyMode: VerifyMode = options.verifyMode ?? 'onFirstUse';
  const poolMax = options.poolMax ?? 10;
  const key = registryKey(verifyMode, poolMax);
  return getRegistry().get(key)?.pool;
}
