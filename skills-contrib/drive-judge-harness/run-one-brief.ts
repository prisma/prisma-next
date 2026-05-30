import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import { type GoldenCase, loadCase } from './load-brief.ts';
import { type RunManifest, type RunStatus, writeManifest } from './manifest.ts';
import { accumulateUsage, type TokenTotals, type TurnUsage } from './usage.ts';

// run-one-brief: spawn ONE orchestrator run on a golden brief with a pinned
// model, accumulate per-run token usage, and write a run manifest.
//
// Live-execution gate (the central safety property): a live run requires BOTH
// `live: true` AND a present API key. Otherwise the harness takes the dry-run
// path, which never touches the SDK, never makes a network call, and records a
// manifest with `status: "dry-run"`, `tokens: null`. The SDK is reached only
// through `sdk-adapter.ts`'s dynamic import, invoked solely on the live path
// when no `createAgent` is injected — so module evaluation, typecheck, tests,
// and lint never require `@cursor/sdk` to be installed. Tests inject a mock
// `createAgent`; nothing here makes a live call under test.

/** A normalized stream event the harness consumes from an orchestrator run,
 *  decoupled from the concrete `@cursor/sdk` message shapes (the adapter maps
 *  SDK messages onto this). */
export type RunStreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'turn-ended'; usage: TurnUsage }
  | { kind: 'other' };

export type RunOutcome = {
  status: 'finished' | 'error';
  runId: string | null;
  agentId: string | null;
};

/** A started orchestrator run the harness observes. */
export type OrchestratorRun = {
  stream(): AsyncIterable<RunStreamEvent>;
  wait(): Promise<RunOutcome>;
};

/** Spawns an orchestrator run for a pinned model + prompt. Injected in tests;
 *  the live default is loaded lazily from `sdk-adapter.ts`. */
export type CreateAgent = (opts: { model: string; prompt: string }) => Promise<OrchestratorRun>;

export type RunOneBriefConfig = {
  caseDir: string;
  traceFile: string;
  manifestFile: string;
  model: string;
  /** Caller asked for a live run. */
  live: boolean;
  /** Whether a Cursor API key is present in the environment. */
  apiKeyPresent: boolean;
};

export type RunOneBriefDeps = {
  /** Injected in tests; when omitted on the live path, the real SDK adapter is
   *  loaded lazily via dynamic import. */
  createAgent?: CreateAgent;
  /** Injectable clock for deterministic timestamps in tests. */
  now?: () => string;
};

export type RunOneBriefResult = {
  status: RunStatus;
  manifest: RunManifest;
  manifestContent: string;
  createAgentCalled: boolean;
};

const DRIVE_FRAMING =
  'You are a Drive orchestrator. Triage and deliver the following entry-point per the drive-* ' +
  'skills (triage → spec/plan as warranted → build loop), staying within its scope.\n\n';

export function assemblePrompt(golden: GoldenCase): string {
  return `${DRIVE_FRAMING}--- BRIEF (${golden.meta.slug}) ---\n${golden.briefText}`;
}

function gateSatisfied(config: RunOneBriefConfig): boolean {
  return config.live && config.apiKeyPresent;
}

async function defaultCreateAgent(): Promise<CreateAgent> {
  // Lazy import so `@cursor/sdk` is only required when a live run is actually
  // requested without an injected agent. Never reached under test.
  const adapter = await import('./sdk-adapter.ts');
  return adapter.createCursorAgent;
}

/** Run one brief end-to-end (or dry-run) and write the manifest. */
export async function runOneBrief(
  config: RunOneBriefConfig,
  deps: RunOneBriefDeps = {},
): Promise<RunOneBriefResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const golden = loadCase(config.caseDir);
  const startedAt = now();

  const baseManifest = {
    schema_version: '1',
    case_slug: golden.meta.slug,
    model: config.model,
    trace_file: config.traceFile,
    started_at: startedAt,
  } as const;

  if (!gateSatisfied(config)) {
    const reason = !config.live
      ? 'dry-run: live execution not requested (pass --live and set CURSOR_API_KEY to run live)'
      : 'dry-run: live requested but CURSOR_API_KEY is absent';
    const manifest: RunManifest = {
      ...baseManifest,
      status: 'dry-run',
      run_id: null,
      agent_id: null,
      tokens: null,
      finished_at: now(),
      notes: [reason, 'no SDK call was made; no orchestrator run was spawned'],
    };
    const manifestContent = writeManifest(config.manifestFile, manifest);
    return { status: 'dry-run', manifest, manifestContent, createAgentCalled: false };
  }

  const createAgent = deps.createAgent ?? (await defaultCreateAgent());
  const prompt = assemblePrompt(golden);

  let run: OrchestratorRun;
  try {
    run = await createAgent({ model: config.model, prompt });
  } catch (err) {
    const manifest: RunManifest = {
      ...baseManifest,
      status: 'startup-failed',
      run_id: null,
      agent_id: null,
      tokens: null,
      finished_at: now(),
      notes: [`startup-failed: ${err instanceof Error ? err.message : String(err)}`],
    };
    const manifestContent = writeManifest(config.manifestFile, manifest);
    return { status: 'startup-failed', manifest, manifestContent, createAgentCalled: true };
  }

  const usageUpdates: TurnUsage[] = [];
  try {
    for await (const event of run.stream()) {
      if (event.kind === 'turn-ended') {
        usageUpdates.push(event.usage);
      }
    }
    const outcome = await run.wait();
    const tokens: TokenTotals = accumulateUsage(usageUpdates);

    const manifest: RunManifest = {
      ...baseManifest,
      status: outcome.status,
      run_id: outcome.runId,
      agent_id: outcome.agentId,
      tokens,
      finished_at: now(),
      notes: [],
    };
    const manifestContent = writeManifest(config.manifestFile, manifest);
    return { status: outcome.status, manifest, manifestContent, createAgentCalled: true };
  } catch (err) {
    // A live stream/wait can throw mid-run; write an error manifest with the
    // usage gathered so far so the token signal and the failure survive rather
    // than escaping as an unhandled rejection out of `void main()`.
    const tokens: TokenTotals = accumulateUsage(usageUpdates);
    const manifest: RunManifest = {
      ...baseManifest,
      status: 'error',
      run_id: null,
      agent_id: null,
      tokens,
      finished_at: now(),
      notes: [`error: ${err instanceof Error ? err.message : String(err)}`],
    };
    const manifestContent = writeManifest(config.manifestFile, manifest);
    return { status: 'error', manifest, manifestContent, createAgentCalled: true };
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  'Usage: node skills-contrib/drive-judge-harness/run-one-brief.ts ' +
  '--case <golden-case-dir> --model <model-id> [--trace-file <path>] ' +
  '[--manifest-file <path>] [--live]\n' +
  'Live execution requires both --live and CURSOR_API_KEY. Default is dry-run.';

function parseArgs(argv: string[]): {
  caseDir?: string;
  model?: string;
  traceFile?: string;
  manifestFile?: string;
  live: boolean;
} {
  let caseDir: string | undefined;
  let model: string | undefined;
  let traceFile: string | undefined;
  let manifestFile: string | undefined;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (): string => {
      const next = argv[i + 1];
      if (next === undefined) {
        process.stderr.write(`Missing value for ${arg}\n${USAGE}\n`);
        process.exit(1);
      }
      i++;
      return next;
    };
    switch (arg) {
      case '--':
        // pnpm forwards its argument separator through to the script; ignore it.
        break;
      case '--case':
        caseDir = takeValue();
        break;
      case '--model':
        model = takeValue();
        break;
      case '--trace-file':
        traceFile = takeValue();
        break;
      case '--manifest-file':
        manifestFile = takeValue();
        break;
      case '--live':
        live = true;
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n${USAGE}\n`);
        process.exit(1);
    }
  }
  return { caseDir, model, traceFile, manifestFile, live };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.caseDir === undefined || parsed.model === undefined) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }
  const traceFile = parsed.traceFile ?? join(parsed.caseDir, 'run-trace.jsonl');
  const manifestFile = parsed.manifestFile ?? join(parsed.caseDir, 'run-manifest.json');

  const result = await runOneBrief({
    caseDir: parsed.caseDir,
    model: parsed.model,
    traceFile,
    manifestFile,
    live: parsed.live,
    apiKeyPresent:
      typeof process.env.CURSOR_API_KEY === 'string' && process.env.CURSOR_API_KEY.length > 0,
  });

  process.stdout.write(`${result.manifestContent}\n`);
  process.exit(result.status === 'error' || result.status === 'startup-failed' ? 2 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
