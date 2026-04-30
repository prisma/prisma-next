import { ParallelReadsPage } from '../../../src/components/parallel-reads-page';

export const dynamic = 'force-dynamic';

/**
 * `/stress/pool-pressure` — same page body as `/`, but with a
 * deliberately small Mongo driver pool (`maxPoolSize: 5`).
 *
 * Mongo counterpart to the Postgres app's `/stress/pool-pressure`.
 * Purpose: characterize hypothesis H4 — what happens when the number
 * of concurrent command issuers (5 Server Components × N concurrent
 * requests) meets or exceeds pool capacity.
 *
 * Unlike the pg pool, MongoClient's internal pool doesn't require a
 * `connect()`-style borrow for every command — the driver multiplexes
 * commands over a smaller number of wire connections. But under
 * sustained concurrent load, the `waitQueueTimeoutMS` (set to 5s in
 * `lib/db.ts`) bounds how long a command will wait for a pooled
 * connection before failing. That's the knob this route is set up to
 * exercise.
 *
 * Expected observations under load (measured by the k6
 * `pool_pressure` scenario):
 *
 * - `connectionsCheckedOut` and `connectionsCheckedIn` stay balanced
 *   under moderate load.
 * - Under high enough load, `commandsFailed` grows as waits exceed
 *   `waitQueueTimeoutMS`. `commandsStarted` still counts those
 *   attempts; the failed/succeeded split is the visible symptom.
 * - `connectionsCreated` climbs to (and stays bounded by) the pool
 *   max, then plateaus — Mongo grows its pool up to the configured
 *   ceiling on demand.
 *
 * This is a **sizing/liveness** observation, not a safety bug. The
 * PoC's stop condition doesn't require fixing pool sizing — that's
 * May (pool-sizing guidance is an explicit non-goal per the plan).
 *
 * ## Why a separate runtime
 *
 * The `lib/db` registry keys by `poolMax`, so this route's
 * `poolMax: 5` singleton is distinct from the default `poolMax: 100`
 * used by `/`. They never share a MongoClient; counters remain
 * apples-to-apples when the findings doc compares them.
 */
const POOL_MAX = 5;

export default function StressPoolPressurePage() {
  return (
    <ParallelReadsPage
      poolMax={POOL_MAX}
      heading="RSC Concurrency PoC — Mongo — /stress/pool-pressure"
      subtitle={
        <>
          Same five parallel Server Components as <code>/</code>, but the shared Mongo driver pool
          is pinned to <code>maxPoolSize: {POOL_MAX}</code>. One render already consumes most of the
          pool; concurrent renders queue for connections and may fail on{' '}
          <code>waitQueueTimeoutMS</code> under sustained load. This is the route that probes
          hypothesis <strong>H4</strong> (pool pressure — sizing concern, not a safety bug).
        </>
      }
    />
  );
}
