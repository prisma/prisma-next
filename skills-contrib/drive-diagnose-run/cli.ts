import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TraceEvent } from '../drive-record-traces/schema.ts';
import { runAssertions } from './assertions/index.ts';
import { loadTrace } from './load.ts';
import { computeMetrics } from './metrics.ts';
import { parseTranscript } from './posthoc.ts';
import { renderReport } from './report.ts';
import { computeScorecard } from './scorecard.ts';

function getProjectRunIds(events: TraceEvent[]): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    ids.add(e.project_run_id);
  }
  return [...ids].sort();
}

function main(): void {
  try {
    run();
  } catch (err) {
    process.stderr.write(
      `drive:diagnose failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

function run(): void {
  const args = process.argv.slice(2);

  let tracePath: string | undefined;
  let posthocPath: string | undefined;
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg === '--posthoc') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        process.stderr.write(`Missing value for ${arg}\n`);
        process.exit(1);
      }
      i++;
      if (arg === '--out') outPath = next;
      else posthocPath = next;
    } else if (!arg.startsWith('--')) {
      tracePath = arg;
    }
  }

  if (tracePath === undefined && posthocPath === undefined) {
    process.stderr.write(
      'Usage: node skills-contrib/drive-diagnose-run/cli.ts <trace.jsonl> [--posthoc <transcript.jsonl>] [--out <path>]\n',
    );
    process.exit(1);
  }

  const nativeEvents: TraceEvent[] = [];
  const nativeErrors: ReturnType<typeof loadTrace>['errors'] = [];
  const nativeUnknown: ReturnType<typeof loadTrace>['unknown'] = [];

  if (tracePath !== undefined) {
    const loaded = loadTrace(tracePath);
    nativeEvents.push(...loaded.events);
    nativeErrors.push(...loaded.errors);
    nativeUnknown.push(...loaded.unknown);
  }

  const posthocResult = posthocPath !== undefined ? parseTranscript(posthocPath) : undefined;

  const origin: 'native' | 'post-hoc' | 'mixed' =
    tracePath !== undefined && posthocPath !== undefined
      ? 'mixed'
      : posthocPath !== undefined
        ? 'post-hoc'
        : 'native';

  const metrics = computeMetrics(nativeEvents);
  const scorecard = computeScorecard(nativeEvents);
  const assertions = runAssertions(nativeEvents);
  const projectRunIds = getProjectRunIds(nativeEvents);
  const reportTracePath = tracePath ?? posthocPath ?? '(unknown)';

  const report = renderReport({
    metrics,
    scorecard,
    assertions,
    loadErrors: nativeErrors,
    unknown: nativeUnknown,
    runMeta: {
      tracePath: reportTracePath,
      eventCount: nativeEvents.length,
      projectRunIds,
      origin,
      operatorTurnCount: posthocResult?.operatorTurnCount,
    },
  });

  if (outPath !== undefined) {
    writeFileSync(outPath, report, 'utf-8');
  } else {
    process.stdout.write(report);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
