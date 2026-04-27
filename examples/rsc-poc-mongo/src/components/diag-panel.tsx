import { getClient } from '../lib/db';
import { snapshot } from '../lib/diag';

/**
 * Dev-only diagnostics panel, rendered at the bottom of a Server Component
 * page to surface the counters that back hypothesis H5 (Mongo's
 * runtime/ORM have no analogue of H2/H3; the app still runs and the
 * pool behaves predictably under concurrent rendering).
 *
 * ## Staleness caveat
 *
 * Same caveat as the Postgres app's panel: this is a Server Component
 * that reads the in-process diagnostic snapshot at render time. React
 * renders siblings concurrently but does **not** guarantee an ordering
 * among siblings wrapped in separate `<Suspense>` boundaries, so the
 * numbers printed on the **first** load after process start reflect
 * "what had finished before the panel was scheduled" — often zero or
 * very few commands.
 *
 * Workaround: reload the page. Counters are cumulative since process
 * start, so the second page render reads the post-work snapshot from
 * the first render and the numbers settle into their intended meaning.
 *
 * For values that are always current (e.g. for k6 post-run inspection),
 * prefer the `/diag` JSON route handler — it's read **after** any page
 * render completes and has no ordering relationship to sibling Suspense
 * boundaries.
 *
 * The panel does not issue its own query, so reading it doesn't perturb
 * the counters it reports.
 */
export interface DiagPanelProps {
  readonly poolMax?: number | undefined;
}

export function DiagPanel({ poolMax }: DiagPanelProps) {
  const effectivePoolMax = poolMax ?? 100;
  const snap = snapshot(effectivePoolMax);
  const client = getClient({ poolMax });

  const commandsOk = snap.commandsStarted === snap.commandsSucceeded + snap.commandsFailed;
  const poolBalanced = snap.connectionsCheckedOut === snap.connectionsCheckedIn;
  const tcpBalanced = snap.connectionsCreated === snap.connectionsClosed;

  return (
    <aside className="diag-panel" aria-label="Diagnostics panel">
      <div className="row">
        <span>
          <span className="label">poolMax:</span>
          <span className="value">{effectivePoolMax}</span>
        </span>
        <span>
          <span className="label">client:</span>
          <span className="value">{client ? 'connected' : 'not constructed yet'}</span>
        </span>
        <span>
          <span className="label">commands:</span>
          <span className={commandsOk ? 'value' : 'value badge warn'}>
            {snap.commandsStarted} started / {snap.commandsSucceeded} ok / {snap.commandsFailed} err
          </span>
        </span>
        <span>
          <span className="label">checkouts:</span>
          <span className={poolBalanced ? 'value' : 'value badge warn'}>
            {snap.connectionsCheckedOut} out / {snap.connectionsCheckedIn} in
          </span>
        </span>
        <span>
          <span className="label">tcp:</span>
          <span className={tcpBalanced ? 'value' : 'value'}>
            {snap.connectionsCreated} created / {snap.connectionsClosed} closed
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
