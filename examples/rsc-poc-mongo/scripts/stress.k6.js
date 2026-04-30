/**
 * k6 stress script for the Mongo RSC concurrency PoC.
 *
 * Mongo counterpart to `examples/rsc-poc-postgres/scripts/stress.k6.js`,
 * trimmed to the two scenarios that apply on the Mongo side:
 *
 * - `baseline` — steady-state concurrent load against `/` with the
 *   default MongoClient pool. Establishes the "nothing is broken"
 *   baseline for H5 findings.
 *
 * - `pool_pressure` — ramping VUs against `/stress/pool-pressure`
 *   (which pins `maxPoolSize: 5` and `waitQueueTimeoutMS: 5000`).
 *   Characterizes H4 on the Mongo side: with a small pool and high
 *   enough concurrency, commands will eventually fail on queue
 *   timeout rather than queueing indefinitely.
 *
 * There is no `spike` / `/stress/always` scenario because
 * `MongoRuntimeImpl` has no verify-mode dimension — the Postgres-side
 * H3 invariant has no Mongo analogue. This is hypothesis H5 in the
 * project plan, and the asymmetry is the whole point of running the
 * Mongo app alongside the Postgres one.
 *
 * Run with (from the example's root):
 *
 *   pnpm stress:baseline
 *   pnpm stress:pool-pressure
 *
 * Or directly:
 *
 *   k6 run scripts/stress.k6.js -e SCENARIO=baseline
 *
 * Target defaults to `http://localhost:3000`. Override with
 * `-e BASE_URL=...` if you're running Next on a different port.
 *
 * ## What the script does NOT do
 *
 * - Does not warm the runtime before measuring. Cold-start behavior
 *   is part of what's interesting; the first VU of each scenario
 *   observes it.
 *
 * - Does not assert correctness in-script. This script collects
 *   evidence; invariants belong in vitest integration tests.
 *
 * - Does not write machine-readable summary artifacts. k6's default
 *   end-of-run summary goes to stdout; redirect with `--summary-export`
 *   if needed.
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
    description: 'baseline: / @ 10 VUs × 30s (default MongoClient pool)',
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
    description: 'pool_pressure: /stress/pool-pressure ramping 1 → 100 VUs (maxPoolSize=5)',
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
    // Soft thresholds — we report but don't fail the run on breach.
    // Failing here would make `pool_pressure` always "fail", which is
    // expected behavior (we're deliberately over-subscribing the pool).
    rsc_page_err: ['count<1000'],
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
};

/**
 * setup() runs once before the VU loop. Snapshots `/diag` so the
 * teardown phase can report the delta in commands, check-outs, and
 * TCP connections attributable to this scenario.
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
 * Default VU function. Each iteration fires one GET against the
 * scenario's target route. We intentionally do not sleep between
 * iterations: the point of the scenarios is to generate concurrent
 * pressure, not to model realistic think time.
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
    return payload.snapshots;
  };

  const beforeSnaps = snapshotForScenario(before) || [];
  const afterSnaps = snapshotForScenario(after) || [];

  // Align after-snaps to before-snaps by poolMax so we can compute
  // deltas even when `/diag` grows new entries mid-run (e.g. another
  // VU hits a different route). In practice each k6 run hits one
  // route, so there's typically one entry.
  const beforeByPool = Object.fromEntries(beforeSnaps.map((s) => [s.poolMax, s]));
  const deltas = afterSnaps.map((a) => {
    const b = beforeByPool[a.poolMax] || {
      commandsStarted: 0,
      commandsSucceeded: 0,
      commandsFailed: 0,
      connectionsCheckedOut: 0,
      connectionsCheckedIn: 0,
      connectionsCreated: 0,
      connectionsClosed: 0,
    };
    return {
      poolMax: a.poolMax,
      commandsStartedDelta: a.commandsStarted - b.commandsStarted,
      commandsSucceededDelta: a.commandsSucceeded - b.commandsSucceeded,
      commandsFailedDelta: a.commandsFailed - b.commandsFailed,
      checkOutsDelta: a.connectionsCheckedOut - b.connectionsCheckedOut,
      checkInsDelta: a.connectionsCheckedIn - b.connectionsCheckedIn,
      tcpCreatedDelta: a.connectionsCreated - b.connectionsCreated,
      tcpClosedDelta: a.connectionsClosed - b.connectionsClosed,
      clientFinal: a.client,
    };
  });

  console.log('');
  console.log(`== ${SCENARIO} /diag deltas (after - before):`);
  console.log(JSON.stringify(deltas, null, 2));
  console.log(`== started: ${data.startedAt}`);
  console.log(`== finished: ${new Date().toISOString()}`);
}
