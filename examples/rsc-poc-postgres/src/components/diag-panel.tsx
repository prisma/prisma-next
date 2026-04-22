import type { VerifyMode } from '../lib/db';
import { getPool } from '../lib/db';
import { snapshot } from '../lib/diag';

/**
 * Dev-only diagnostics panel, rendered at the bottom of a Server Component
 * page to surface the counters that back hypotheses H2–H4.
 *
 * This is a Server Component itself — it reads the in-process diagnostic
 * snapshot at render time. Because the snapshot is updated by
 * `InstrumentedPool` as the page's other Server Components execute their
 * queries in parallel, the values reflect the state **at the moment this
 * component is rendered**, which in RSC may be partially or fully after the
 * parallel siblings have finished.
 *
 * The panel does not cause its own query, so it won't perturb the counters
 * it's reporting. Numbers are cumulative since process start (not
 * per-request); a page reload shows monotonically increasing values.
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
        <span className="muted">cumulative since process start</span>
      </div>
    </aside>
  );
}
