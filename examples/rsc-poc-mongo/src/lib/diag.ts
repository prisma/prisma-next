/**
 * In-process diagnostic counters for the Mongo RSC concurrency PoC.
 *
 * Unlike the Postgres app — where counters are populated by an
 * instrumented `pg.Pool` subclass — the Mongo driver owns its own
 * connection pool inside `MongoClient`. We can't subclass that, but
 * `MongoClient` emits command- and pool-level events we can listen to.
 * The listeners live in `src/lib/db.ts`; this module is just the
 * counter store they write into, plus the snapshot readers the `/diag`
 * route and `<DiagPanel />` pull from.
 *
 * ## What we count
 *
 * - **commandStarted / commandSucceeded / commandFailed**: one MongoDB
 *   command (find, aggregate, insert, …) issued against the driver.
 *   This is the Mongo analogue of a pg query.
 *
 * - **connectionCheckedOut / connectionCheckedIn**: a pool client
 *   borrowed from the driver's internal pool. Roughly the Mongo
 *   analogue of `pool.connect()` / `client.release()` on the pg side.
 *
 * - **connectionCreated / connectionClosed**: underlying TCP
 *   connections opened and closed. These don't have a direct pg
 *   analogue — pg-pool's `connect()` may reuse a TCP connection that
 *   was opened earlier, and we don't count TCP-level events there.
 *
 * ## Why no marker-read counter
 *
 * The Mongo runtime (`MongoRuntimeImpl`) has **no verification state**
 * and issues no marker reads — that's hypothesis H5 from the project
 * plan. A counter here would always be zero. Omitting it keeps the
 * snapshot shape minimal and makes the contrast with the Postgres
 * side obvious in the findings doc: one side verifies, one doesn't.
 *
 * ## `globalThis`-backed storage
 *
 * Same pattern as the Postgres app's `lib/diag.ts`: counters live on
 * `globalThis` under a stable `Symbol.for(...)` key so they survive
 * Next.js dev-mode HMR. In production there's no HMR and this
 * collapses to a regular module-level singleton per Node process.
 *
 * Counters are keyed by `poolMax` (default vs. the small value the
 * pool-pressure route pins), mirroring how the Postgres registry
 * keys by `(verifyMode, poolMax)`. The Mongo app has no `verifyMode`
 * dimension, so `poolMax` alone is enough.
 */

export interface DiagCounters {
  /** MongoDB commands started (find, aggregate, insertOne, …). */
  commandsStarted: number;
  /** Commands that reported success (`commandSucceeded`). */
  commandsSucceeded: number;
  /** Commands that reported failure (`commandFailed`). */
  commandsFailed: number;
  /** Pool connections checked out (`connectionCheckedOut`). */
  connectionsCheckedOut: number;
  /** Pool connections checked in (`connectionCheckedIn`). */
  connectionsCheckedIn: number;
  /** Underlying TCP connections opened (`connectionCreated`). */
  connectionsCreated: number;
  /** Underlying TCP connections closed (`connectionClosed`). */
  connectionsClosed: number;
}

export interface DiagSnapshot extends DiagCounters {
  readonly poolMax: number;
  readonly timestampMs: number;
}

type DiagRegistry = Map<number, DiagCounters>;

const REGISTRY_KEY = Symbol.for('prisma-next.rsc-poc-mongo.diag');

interface GlobalWithDiag {
  [REGISTRY_KEY]?: DiagRegistry;
}

function getRegistry(): DiagRegistry {
  const g = globalThis as unknown as GlobalWithDiag;
  let registry = g[REGISTRY_KEY];
  if (!registry) {
    registry = new Map();
    g[REGISTRY_KEY] = registry;
  }
  return registry;
}

function getOrCreate(poolMax: number): DiagCounters {
  const registry = getRegistry();
  let counters = registry.get(poolMax);
  if (!counters) {
    counters = {
      commandsStarted: 0,
      commandsSucceeded: 0,
      commandsFailed: 0,
      connectionsCheckedOut: 0,
      connectionsCheckedIn: 0,
      connectionsCreated: 0,
      connectionsClosed: 0,
    };
    registry.set(poolMax, counters);
  }
  return counters;
}

export function recordCommandStarted(poolMax: number): void {
  getOrCreate(poolMax).commandsStarted += 1;
}

export function recordCommandSucceeded(poolMax: number): void {
  getOrCreate(poolMax).commandsSucceeded += 1;
}

export function recordCommandFailed(poolMax: number): void {
  getOrCreate(poolMax).commandsFailed += 1;
}

export function recordConnectionCheckedOut(poolMax: number): void {
  getOrCreate(poolMax).connectionsCheckedOut += 1;
}

export function recordConnectionCheckedIn(poolMax: number): void {
  getOrCreate(poolMax).connectionsCheckedIn += 1;
}

export function recordConnectionCreated(poolMax: number): void {
  getOrCreate(poolMax).connectionsCreated += 1;
}

export function recordConnectionClosed(poolMax: number): void {
  getOrCreate(poolMax).connectionsClosed += 1;
}

export function snapshot(poolMax: number): DiagSnapshot {
  const counters = getOrCreate(poolMax);
  return {
    poolMax,
    timestampMs: Date.now(),
    commandsStarted: counters.commandsStarted,
    commandsSucceeded: counters.commandsSucceeded,
    commandsFailed: counters.commandsFailed,
    connectionsCheckedOut: counters.connectionsCheckedOut,
    connectionsCheckedIn: counters.connectionsCheckedIn,
    connectionsCreated: counters.connectionsCreated,
    connectionsClosed: counters.connectionsClosed,
  };
}

export function snapshotAll(): readonly DiagSnapshot[] {
  const registry = getRegistry();
  return [...registry.keys()].map((poolMax) => snapshot(poolMax));
}

export function reset(poolMax?: number): void {
  const registry = getRegistry();
  if (poolMax === undefined) {
    registry.clear();
    return;
  }
  registry.delete(poolMax);
}
