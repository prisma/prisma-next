import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAssertions } from './assertions/index.ts';
import { loadTrace } from './load.ts';
import { computeMetrics } from './metrics.ts';
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
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' && i + 1 < args.length) {
      i++;
      outPath = args[i];
    } else if (arg === '--posthoc') {
      if (i + 1 < args.length) i++;
      // TODO: D6 will implement post-hoc transcript loading
    } else if (!arg.startsWith('--')) {
      tracePath = arg;
    }
  }

  if (tracePath === undefined) {
    process.stderr.write(
      'Usage: node scripts/drive-diagnostics/cli.ts <trace.jsonl> [--out <path>]\n',
    );
    process.exit(1);
  }

  const { events, errors, unknown } = loadTrace(tracePath);
  const metrics = computeMetrics(events);
  const assertions = runAssertions(events);
  const projectRunIds = getProjectRunIds(events);

  const report = renderReport({
    metrics,
    assertions,
    loadErrors: errors,
    unknown,
    runMeta: {
      tracePath,
      eventCount: events.length,
      projectRunIds,
      origin: 'native',
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
