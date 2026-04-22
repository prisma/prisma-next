/**
 * Instrumented `pg.Pool` subclass for the RSC concurrency PoC.
 *
 * Counts:
 * - Connection acquires (`pool.connect()`) — every time the driver borrows a
 *   client from the pool, whether for `execute()` or for `query()`.
 * - Connection releases (`client.release()`) — so we can verify acquires and
 *   releases balance under load (H4).
 * - Marker reads — identified by SQL text containing `prisma_contract.marker`,
 *   the stable fragment emitted by `PostgresAdapterImpl.readMarkerStatement()`.
 *   The runtime's `verifyPlanIfNeeded()` issues the marker read via
 *   `driver.query()`, which in `PostgresPoolDriverImpl` does
 *   `pool.connect()` → `client.query(sql, params)` → `client.release()`.
 *   So we detect it at the client level.
 *
 * We subclass `pg.Pool` (rather than wrapping by composition) because the
 * bundled `@prisma-next/postgres` runtime uses `instanceof PgPool` in
 * `resolvePostgresBinding()` to route `pg`-input into the `pgPool` branch. A
 * composition wrapper would fail that check.
 */
import type { PoolClient, PoolConfig } from 'pg';
import { Pool as PgPool } from 'pg';
import type { VerifyMode } from './db';
import {
  isMarkerReadSql,
  recordConnectionAcquire,
  recordConnectionRelease,
  recordMarkerRead,
} from './diag';

export interface InstrumentedPoolOptions extends PoolConfig {
  readonly verifyMode: VerifyMode;
}

const INSTRUMENTED_MARKER = Symbol.for('prisma-next.rsc-poc-postgres.client.instrumented');

/**
 * Extracts the SQL text from the shapes `pg` accepts for `query()`. Returns
 * `null` for non-text shapes (e.g. `Cursor` or other `Submittable`) — the
 * marker read uses a plain string so we never need to look inside those.
 */
function extractSql(queryTextOrConfig: unknown): string | null {
  if (typeof queryTextOrConfig === 'string') {
    return queryTextOrConfig;
  }
  if (
    queryTextOrConfig !== null &&
    typeof queryTextOrConfig === 'object' &&
    'text' in queryTextOrConfig &&
    typeof (queryTextOrConfig as { text: unknown }).text === 'string'
  ) {
    return (queryTextOrConfig as { text: string }).text;
  }
  return null;
}

/**
 * Instruments a `PoolClient` in place so that `query()` records marker reads
 * and `release()` bumps the release counter. Idempotent: multiple calls on the
 * same client are no-ops after the first.
 */
function instrumentPoolClient(client: PoolClient, verifyMode: VerifyMode): PoolClient {
  const flag = client as unknown as Record<symbol, boolean>;
  if (flag[INSTRUMENTED_MARKER]) {
    return client;
  }
  flag[INSTRUMENTED_MARKER] = true;

  const originalQuery = client.query.bind(client) as (...a: unknown[]) => unknown;
  const originalRelease = client.release.bind(client) as (err?: Error | boolean) => void;

  const patchedQuery = (...args: unknown[]): unknown => {
    const sql = extractSql(args[0]);
    if (sql !== null && isMarkerReadSql(sql)) {
      recordMarkerRead(verifyMode);
    }
    return originalQuery(...args);
  };

  const patchedRelease = (err?: Error | boolean): void => {
    recordConnectionRelease(verifyMode);
    originalRelease(err);
  };

  // pg's PoolClient types use overloaded signatures for query()/release() that
  // are impractical to reproduce here without losing clarity. Assigning the
  // patched functions back keeps the duck-typed driver call sites happy while
  // preserving runtime behavior.
  const mutable = client as unknown as {
    query: typeof patchedQuery;
    release: typeof patchedRelease;
  };
  mutable.query = patchedQuery;
  mutable.release = patchedRelease;

  return client;
}

/**
 * `pg.Pool` subclass with diagnostic counters. Keeps `instanceof PgPool` true
 * so it satisfies `resolvePostgresBinding()`'s instance check.
 *
 * We only override `connect()` — the driver doesn't use `pool.query()` for
 * anything we care about (marker reads go through an acquired client, not
 * `pool.query`).
 */
export class InstrumentedPool extends PgPool {
  readonly #verifyMode: VerifyMode;

  constructor(options: InstrumentedPoolOptions) {
    const { verifyMode, ...poolConfig } = options;
    super(poolConfig);
    this.#verifyMode = verifyMode;
  }

  override connect(): Promise<PoolClient> {
    recordConnectionAcquire(this.#verifyMode);
    return super.connect().then((client) => instrumentPoolClient(client, this.#verifyMode));
  }
}
