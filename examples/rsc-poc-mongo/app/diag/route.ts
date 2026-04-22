import { NextResponse } from 'next/server';
import { getClient } from '../../src/lib/db';
import { snapshotAll } from '../../src/lib/diag';

/**
 * `/diag` — JSON snapshot of in-process diagnostic counters for the
 * Mongo RSC concurrency PoC.
 *
 * Mongo counterpart to the Postgres app's `/diag`. Unlike the
 * `<DiagPanel />` Server Component (which races sibling Suspense
 * boundaries on the home page and may report stale numbers within a
 * single render), this endpoint is read *after* any page render is
 * complete, so its values are always current relative to the request
 * that precedes it.
 *
 * Used by:
 *
 * - k6 stress scripts — called after a scenario finishes to record
 *   final counter values for the findings write-up.
 * - Manual inspection — `curl http://localhost:3000/diag | jq`.
 *
 * Counters are cumulative since process start. To compare two points
 * in time, read `/diag`, do some work, read `/diag` again, and
 * subtract.
 *
 * Per-snapshot shape differs from the Postgres app: there's no
 * `markerReads` field (the Mongo runtime doesn't verify), no
 * `verifyMode` key (there's nothing to toggle). Instead we report
 * command counts, connection check-out/in counts, and TCP
 * create/close counts — the observables the `MongoClient` emits via
 * its CMAP and APM event listeners (wired up in `lib/db.ts`).
 */
export const dynamic = 'force-dynamic';

interface DiagPayload {
  readonly timestampMs: number;
  readonly snapshots: ReadonlyArray<{
    readonly poolMax: number;
    readonly commandsStarted: number;
    readonly commandsSucceeded: number;
    readonly commandsFailed: number;
    readonly connectionsCheckedOut: number;
    readonly connectionsCheckedIn: number;
    readonly connectionsCreated: number;
    readonly connectionsClosed: number;
    readonly client: 'connected' | 'not-constructed';
  }>;
}

export function GET(): Response {
  const snapshots = snapshotAll().map((snap) => {
    const client = getClient({ poolMax: snap.poolMax });
    return {
      poolMax: snap.poolMax,
      commandsStarted: snap.commandsStarted,
      commandsSucceeded: snap.commandsSucceeded,
      commandsFailed: snap.commandsFailed,
      connectionsCheckedOut: snap.connectionsCheckedOut,
      connectionsCheckedIn: snap.connectionsCheckedIn,
      connectionsCreated: snap.connectionsCreated,
      connectionsClosed: snap.connectionsClosed,
      client: (client === undefined ? 'not-constructed' : 'connected') as
        | 'connected'
        | 'not-constructed',
    };
  });

  const payload: DiagPayload = {
    timestampMs: Date.now(),
    snapshots,
  };

  return NextResponse.json(payload);
}
