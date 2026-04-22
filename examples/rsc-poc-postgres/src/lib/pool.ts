/**
 * Instrumented `pg.Pool` subclass for the RSC concurrency PoC.
 *
 * Counts:
 * - Connection acquires (`pool.connect()`) — every time the driver borrows a
 *   client from the pool, whether for `execute()` or for `query()`.
 * - Connection releases — observed via the pool's `'release'` event, which
 *   `pg-pool` emits from `_release()` on every checkin. We intentionally do
 *   NOT wrap `client.release`: `pg-pool` reassigns `client.release` inside
 *   `_acquireClient()` on *every* checkout (see `_releaseOnce`), so any
 *   wrapper we install gets clobbered on the second acquire of a pooled
 *   client, producing the classic "acquires keep growing, releases stuck"
 *   anomaly. The `'release'` event is emitted unconditionally and is the
 *   supported observation point.
 * - Marker reads — identified by SQL text containing `prisma_contract.marker`,
 *   the stable fragment emitted by `PostgresAdapterImpl.readMarkerStatement()`.
 *   The runtime's `verifyPlanIfNeeded()` issues the marker read via
 *   `driver.query()`, which in `PostgresPoolDriverImpl` does
 *   `pool.connect()` → `client.query(sql, params)` → `client.release()`.
 *   So we detect it at the client level by patching `client.query` (which,
 *   unlike `release`, is NOT reassigned on every checkout). An idempotent
 *   guard prevents double-wrapping when the same pooled client is reused.
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

const QUERY_INSTRUMENTED_MARKER = Symbol.for(
  'prisma-next.rsc-poc-postgres.client.query-instrumented',
);

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
 * Patches `client.query` in place so that executed SQL matching the marker
 * fragment bumps the marker-read counter. Idempotent via a symbol flag so
 * re-acquires of the same pooled client don't double-wrap.
 *
 * We do NOT patch `client.release` here — see the module docstring for why.
 */
function instrumentPoolClient(client: PoolClient, verifyMode: VerifyMode): PoolClient {
  const flag = client as unknown as Record<symbol, boolean>;
  if (flag[QUERY_INSTRUMENTED_MARKER]) {
    return client;
  }
  flag[QUERY_INSTRUMENTED_MARKER] = true;

  const originalQuery = client.query.bind(client) as (...a: unknown[]) => unknown;

  const patchedQuery = (...args: unknown[]): unknown => {
    const sql = extractSql(args[0]);
    if (sql !== null && isMarkerReadSql(sql)) {
      recordMarkerRead(verifyMode);
    }
    return originalQuery(...args);
  };

  // pg's PoolClient types use overloaded signatures for query() that are
  // impractical to reproduce here without losing clarity. Assigning the
  // patched function back keeps the duck-typed driver call sites happy while
  // preserving runtime behavior.
  const mutable = client as unknown as { query: typeof patchedQuery };
  mutable.query = patchedQuery;

  return client;
}

/**
 * `pg.Pool` subclass with diagnostic counters. Keeps `instanceof PgPool` true
 * so it satisfies `resolvePostgresBinding()`'s instance check.
 *
 * Observations:
 * - `connect()` is overridden to count **successful** acquires (after the
 *   promise resolves) and instrument the returned client's `query` method.
 *   Counting before `super.connect()` resolved would inflate acquires by
 *   the number of pool-timeout rejections, breaking the `acquires ==
 *   releases` invariant on any run that exceeds pool capacity — see
 *   `/stress/spike` under `poolMax: 10` where dozens of connects time out
 *   with `connectionTimeoutMillis: 5000` and never deliver a client.
 * - Releases are counted via the pool's `'release'` event (emitted by
 *   `pg-pool`'s internal `_release()` on every checkin), so we stay robust
 *   against `pg-pool` reassigning `client.release` on each acquire.
 */
export class InstrumentedPool extends PgPool {
  readonly #verifyMode: VerifyMode;

  constructor(options: InstrumentedPoolOptions) {
    const { verifyMode, ...poolConfig } = options;
    super(poolConfig);
    this.#verifyMode = verifyMode;

    // `pg-pool` emits `'release'` from `_release()` with signature
    // `(err, client)`. We only care that it fired; the arguments are unused.
    this.on('release', () => {
      recordConnectionRelease(verifyMode);
    });
  }

  override connect(): Promise<PoolClient> {
    return super.connect().then((client) => {
      // Count only after `super.connect()` resolves. If it rejects (pool
      // timeout), no client was delivered and no `'release'` will ever
      // fire — bumping the counter on entry would desync
      // acquires/releases permanently for the remainder of the process.
      recordConnectionAcquire(this.#verifyMode);
      return instrumentPoolClient(client, this.#verifyMode);
    });
  }
}
