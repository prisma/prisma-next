import type { VerifyMode } from '../lib/db';
import { getPool } from '../lib/db';
import { snapshot } from '../lib/diag';

/**
 * Dev-only diagnostics panel, rendered at the bottom of a Server Component
 * page to surface the counters that back hypotheses H2–H4.
 *
 * ## Staleness caveat
 *
 * This is a Server Component that reads the in-process diagnostic snapshot
 * at render time. React renders siblings concurrently but does **not**
 * guarantee an ordering among siblings wrapped in separate `<Suspense>`
 * boundaries. In practice this means `<DiagPanel />` usually resolves
 * *before* its Suspense-wrapped siblings (none of its rendering is async),
 * so the numbers it prints on the **first** load after process start
 * reflect "what had finished before the panel was scheduled" — often zero
 * or very few queries.
 *
 * Workaround: reload the page. Counters are cumulative since process
 * start, so the second page render reads the post-work snapshot from the
 * first render and the numbers settle into their intended meaning.
 *
 * For values that are always current (e.g. for the H3 integration test or
 * k6 post-run inspection), prefer the `/diag` JSON route handler — it's
 * read **after** any page render completes and has no ordering
 * relationship to sibling Suspense boundaries.
 *
 * The panel does not issue its own query, so reading it doesn't perturb
 * the counters it reports.
 */
export interface DiagPanelProps {
  readonly verifyMode: VerifyMode;
  readonly poolMax?: number;
}

export function DiagPanel({ verifyMode, poolMax }: DiagPanelProps) {
  const snap = snapshot(verifyMode);
  const pool = getPool({ verifyMode, ...(poolMax !== undefined ? { poolMax } : {}) });

  const totalCount = pool?.totalCount ?? 0;
  const idleCount = pool?.idleCount ?? 0;
  const waitingCount = pool?.waitingCount ?? 0;
  const unbalanced = snap.connectionAcquires !== snap.connectionReleases;

  return (
    <aside className="diag-panel" aria-label="Diagnostics panel">
      <div className="row">
        <span>
          <span className="label">verify:</span>
          <span className="value">{verifyMode}</span>
        </span>
        <span>
          <span className="label">marker reads:</span>
          <span className="value">{snap.markerReads}</span>
        </span>
        <span>
          <span className="label">conn acquires:</span>
          <span className="value">{snap.connectionAcquires}</span>
        </span>
        <span>
          <span className="label">conn releases:</span>
          <span className={unbalanced ? 'value badge warn' : 'value'}>
            {snap.connectionReleases}
          </span>
        </span>
        <span>
          <span className="label">pool:</span>
          <span className="value">
            {totalCount} total / {idleCount} idle / {waitingCount} waiting
          </span>
        </span>
        <span className="muted">
          cumulative since process start · reload for accurate snapshot · see{' '}
          <a href="/diag">/diag</a>
        </span>
      </div>
    </aside>
  );
}
