import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAssertions } from './assertions/index.ts';
import { loadTrace } from './load.ts';
import { computeMetrics } from './metrics.ts';
import { parseTranscript } from './posthoc.ts';
import { renderReport } from './report.ts';
import type { TraceEvent } from './schema.ts';

function getProjectRunIds(events: TraceEvent[]): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    ids.add(e.project_run_id);
  }
  return [...ids].sort();
}

function main(): void {
  const args = process.argv.slice(2);

  let tracePath: string | undefined;
  let posthocPath: string | undefined;
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' && i + 1 < args.length) {
      i++;
      outPath = args[i];
    } else if (arg === '--posthoc' && i + 1 < args.length) {
      i++;
      posthocPath = args[i];
    } else if (!arg.startsWith('--')) {
      tracePath = arg;
    }
  }

  if (tracePath === undefined && posthocPath === undefined) {
    process.stderr.write(
      'Usage: node skills-contrib/drive-diagnostics/cli.ts <trace.jsonl> [--posthoc <transcript.jsonl>] [--out <path>]\n',
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
  const assertions = runAssertions(nativeEvents);
  const projectRunIds = getProjectRunIds(nativeEvents);
  const reportTracePath = tracePath ?? posthocPath ?? '(unknown)';

  const report = renderReport({
    metrics,
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
