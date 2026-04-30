/**
 * k6 stress script for the RSC concurrency PoC.
 *
 * One script, three scenarios, selected via the `SCENARIO` env var. This
 * keeps the `package.json` entries simple (`pnpm stress:baseline`, etc.)
 * and lets the scenarios share the same setup/teardown.
 *
 * Run with (from the example's root):
 *
 *   pnpm stress:baseline
 *   pnpm stress:spike
 *   pnpm stress:pool-pressure
 *
 * Or directly:
 *
 *   k6 run scripts/stress.k6.js -e SCENARIO=baseline
 *
 * Target defaults to `http://localhost:3000`. Override with `-e BASE_URL=...`
 * if you're running Next on a different port.
 *
 * ## Scenarios
 *
 * - `baseline` — 10 VUs × 30s against `/`. Measures steady-state behavior
 *   of the default `onFirstUse` route under moderate concurrent load.
 *   Establishes the "nothing is broken" baseline for H1/H2 findings.
 *
 * - `spike` — 50 VUs × 30s against `/stress/always`. Designed to make H3
 *   visible (or, per the revised plan, to confirm the invariant
 *   `markerReads === queryCount`). Pre- and post-run `/diag` snapshots
 *   are captured so the ratio can be computed.
 *
 * - `pool_pressure` — ramp 1 → 100 VUs against `/stress/pool-pressure`
 *   (which pins `poolMax: 5`). Characterizes H4: each page render borrows
 *   5 connections, so contention and waiting begin at 2 concurrent
 *   requests. Captures p95 latency and final pool snapshot.
 *
 * ## What the script does NOT do
 *
 * - Does not warm the runtime before measuring. Cold-start marker-read
 *   behavior (H2) is part of what we want to see; the first VU of each
 *   scenario observes it.
 *
 * - Does not assert correctness in-script. Pass/fail conditions live in
 *   the vitest integration test (step 5 of the plan). This script
 *   collects evidence; the test pins invariants.
 *
 * - Does not write machine-readable summary artifacts. k6's default
 *   end-of-run summary goes to stdout; save it with shell redirection if
 *   needed. (`k6 run --summary-export=...` is available but optional.)
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SCENARIO = __ENV.SCENARIO || 'baseline';

// Custom metrics so the end-of-run summary is legible at a glance.
const pageOkCount = new Counter('rsc_page_ok');
const pageErrCount = new Counter('rsc_page_err');
const pageLatency = new Trend('rsc_page_latency_ms', true);

const SCENARIO_CONFIG = {
  baseline: {
    path: '/',
    executor: 'constant-vus',
    vus: 10,
    duration: '30s',
    description: 'baseline: / @ 10 VUs × 30s (onFirstUse, default pool)',
  },
  spike: {
    path: '/stress/always',
    executor: 'constant-vus',
    vus: 50,
    duration: '30s',
    description: 'spike: /stress/always @ 50 VUs × 30s (verify=always)',
  },
  pool_pressure: {
    path: '/stress/pool-pressure',
    executor: 'ramping-vus',
    stages: [
      { duration: '10s', target: 10 },
      { duration: '10s', target: 30 },
      { duration: '10s', target: 60 },
      { duration: '10s', target: 100 },
      { duration: '10s', target: 100 },
    ],
    description: 'pool_pressure: /stress/pool-pressure ramping 1 → 100 VUs (poolMax=5)',
  },
};

const cfg = SCENARIO_CONFIG[SCENARIO];
if (!cfg) {
  throw new Error(
    `Unknown SCENARIO '${SCENARIO}'. Set SCENARIO to one of: ${Object.keys(SCENARIO_CONFIG).join(', ')}`,
  );
}

export const options = {
  scenarios: {
    [SCENARIO]:
      cfg.executor === 'constant-vus'
        ? {
            executor: 'constant-vus',
            vus: cfg.vus,
            duration: cfg.duration,
            gracefulStop: '5s',
          }
        : {
            executor: 'ramping-vus',
            startVUs: 1,
            stages: cfg.stages,
            gracefulRampDown: '5s',
            gracefulStop: '5s',
          },
  },
  thresholds: {
    // Soft thresholds — we report but don't fail the run on breach. Failing
    // here would make `pool_pressure` always "fail", which is expected
    // behavior (we're deliberately over-subscribing the pool).
    rsc_page_err: ['count<1000'],
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
};

/**
 * setup() runs once before the VU loop. We snapshot `/diag` so the
 * teardown phase can report the delta in marker reads, acquires, and
 * releases attributable to this scenario.
 */
export function setup() {
  console.log(`== ${cfg.description}`);
  console.log(`== target: ${BASE_URL}${cfg.path}`);

  const diagRes = http.get(`${BASE_URL}/diag`);
  const before = diagRes.status === 200 ? diagRes.json() : null;

  return {
    startedAt: new Date().toISOString(),
    diagBefore: before,
  };
}

/**
 * Default VU function. Each iteration fires one GET against the scenario's
 * target route. We intentionally do not sleep between iterations: the
 * point of the scenarios is to generate concurrent pressure, not to model
 * realistic think time.
 */
export default function vuIteration() {
  const res = http.get(`${BASE_URL}${cfg.path}`, {
    tags: { scenario: SCENARIO },
    timeout: '30s',
  });
  pageLatency.add(res.timings.duration);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body is not empty': (r) => typeof r.body === 'string' && r.body.length > 0,
  });

  if (ok) {
    pageOkCount.add(1);
  } else {
    pageErrCount.add(1);
  }

  // No sleep(); generate continuous pressure.
  sleep(0);
}

/**
 * teardown() runs once after the VU loop. Reads `/diag` again and logs
 * the deltas. These numbers are the core evidence for the findings doc.
 */
export function teardown(data) {
  const diagRes = http.get(`${BASE_URL}/diag`);
  const after = diagRes.status === 200 ? diagRes.json() : null;

  const before = data.diagBefore;
  const snapshotForScenario = (payload) => {
    if (!payload || !Array.isArray(payload.snapshots)) return null;
    // Each scenario writes to exactly one (verifyMode, poolMax) registry
    // entry, but we don't know which without parsing; report all of them
    // and let the reader correlate with the scenario description.
    return payload.snapshots;
  };

  const beforeSnaps = snapshotForScenario(before) || [];
  const afterSnaps = snapshotForScenario(after) || [];

  // Align after-snaps to before-snaps by verifyMode so we can compute
  // deltas even when `/diag` grows new entries mid-run (e.g. another VU
  // hits a different route). In practice each k6 run hits one route, so
  // there's typically one entry.
  const beforeByMode = Object.fromEntries(beforeSnaps.map((s) => [s.verifyMode, s]));
  const deltas = afterSnaps.map((a) => {
    const b = beforeByMode[a.verifyMode] || {
      markerReads: 0,
      connectionAcquires: 0,
      connectionReleases: 0,
    };
    return {
      verifyMode: a.verifyMode,
      markerReadsDelta: a.markerReads - b.markerReads,
      acquiresDelta: a.connectionAcquires - b.connectionAcquires,
      releasesDelta: a.connectionReleases - b.connectionReleases,
      poolFinal: a.pool,
    };
  });

  console.log('');
  console.log(`== ${SCENARIO} /diag deltas (after - before):`);
  console.log(JSON.stringify(deltas, null, 2));
  console.log(`== started: ${data.startedAt}`);
  console.log(`== finished: ${new Date().toISOString()}`);
}
