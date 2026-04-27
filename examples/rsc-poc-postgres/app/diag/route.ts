import { NextResponse } from 'next/server';
import type { VerifyMode } from '../../src/lib/db';
import { getPool } from '../../src/lib/db';
import { snapshotAll } from '../../src/lib/diag';

/**
 * `/diag` — JSON snapshot of in-process diagnostic counters.
 *
 * Unlike the `<DiagPanel />` Server Component (which races sibling Suspense
 * boundaries on the home page and may report stale numbers within a single
 * render), this endpoint is read *after* any page render is complete, so its
 * values are always current relative to the request that precedes it.
 *
 * Used by:
 *
 * - k6 stress scripts — called after a scenario finishes to record final
 *   counter values for the findings write-up.
 * - The H3 integration test — asserts
 *   `markerReads === queryCount` under `always` mode.
 * - Manual inspection — `curl http://localhost:3000/diag | jq`.
 *
 * Counters are cumulative since process start. To compare two points in
 * time, read `/diag`, do some work, read `/diag` again, and subtract.
 */
export const dynamic = 'force-dynamic';

interface DiagPayload {
  readonly timestampMs: number;
  readonly snapshots: ReadonlyArray<{
    readonly verifyMode: VerifyMode;
    readonly markerReads: number;
    readonly connectionAcquires: number;
    readonly connectionReleases: number;
    readonly pool: {
      readonly totalCount: number;
      readonly idleCount: number;
      readonly waitingCount: number;
    } | null;
  }>;
}

export function GET(): Response {
  const snapshots = snapshotAll().map((snap) => {
    const pool = getPool({ verifyMode: snap.verifyMode });
    return {
      verifyMode: snap.verifyMode,
      markerReads: snap.markerReads,
      connectionAcquires: snap.connectionAcquires,
      connectionReleases: snap.connectionReleases,
      pool:
        pool === undefined
          ? null
          : {
              totalCount: pool.totalCount,
              idleCount: pool.idleCount,
              waitingCount: pool.waitingCount,
            },
    };
  });

  const payload: DiagPayload = {
    timestampMs: Date.now(),
    snapshots,
  };

  return NextResponse.json(payload);
}
