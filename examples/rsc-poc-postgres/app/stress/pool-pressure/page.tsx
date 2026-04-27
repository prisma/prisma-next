import { ParallelReadsPage } from '../../../src/components/parallel-reads-page';

export const dynamic = 'force-dynamic';

/**
 * `/stress/pool-pressure` — same page body as `/`, but with a deliberately
 * small pg pool (`max: 5`).
 *
 * Purpose: characterize hypothesis H4 — what happens when the number of
 * concurrent connection borrowers (5 Server Components × N concurrent
 * requests) meets or exceeds pool capacity. Each of the five components
 * borrows a connection for the duration of its render, so a single page
 * render already saturates a 5-slot pool. A second concurrent request
 * has zero headroom and must wait.
 *
 * Expected observations under load (measured by the k6 `pool_pressure`
 * scenario):
 *
 * - `pool.waitingCount` becomes nonzero as soon as concurrent requests
 *   exceed `ceil(pool.max / components_per_page)` — roughly 1 concurrent
 *   request at `max: 5`.
 * - p50/p95 latency grows with the queue depth.
 * - `connectionTimeoutMillis` (5s in `lib/db`) bounds the worst case; at
 *   high enough contention, requests fail with the pg `timeout exceeded`
 *   error rather than hanging forever.
 *
 * This is a **sizing/liveness** observation, not a safety bug. The PoC's
 * stop condition doesn't require us to fix pool sizing — that's May
 * (pool-sizing guidance as an explicit non-goal per the plan).
 *
 * ## Why a separate runtime
 *
 * Registry keys by `(verifyMode, poolMax)`, so this route's `poolMax: 5`
 * singleton is distinct from the default `poolMax: 10` used by `/` and
 * `/stress/always`. They never share a pg pool; counters remain
 * apples-to-apples when the findings doc compares them.
 *
 * ## Why `onFirstUse` here (not `always`)
 *
 * The `poolMax` dimension is orthogonal to the verify-mode dimension. We
 * pin verify to `onFirstUse` to match the default production shape; the
 * k6 scenario measures pool contention under the same verify semantics
 * users will actually run.
 */
const POOL_MAX = 5;

export default function StressPoolPressurePage() {
  return (
    <ParallelReadsPage
      verifyMode="onFirstUse"
      poolMax={POOL_MAX}
      heading="RSC Concurrency PoC — /stress/pool-pressure"
      subtitle={
        <>
          Same five parallel Server Components as <code>/</code>, but the shared pg pool is pinned
          to <code>max: {POOL_MAX}</code>. One render already saturates the pool; concurrent renders
          queue for connections. This is the route that probes hypothesis <strong>H4</strong> (pool
          pressure — sizing concern, not a safety bug).
        </>
      }
    />
  );
}
