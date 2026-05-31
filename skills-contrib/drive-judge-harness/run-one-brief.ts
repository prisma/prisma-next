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
  durationMs: number | null;
  tokens: TokenTotals | null;
  costUsd: number | null;
  numTurns: number | null;
};

/** A started orchestrator run the harness observes. */
export type OrchestratorRun = {
  stream(): AsyncIterable<RunStreamEvent>;
  wait(): Promise<RunOutcome>;
};

/** Spawns an orchestrator run for a pinned model + prompt. Injected in tests;
 *  the live default is loaded lazily from the matching adapter module. */
export type CreateAgent = (opts: {
  model: string;
  prompt: string;
  cwd: string;
  maxBudgetUsd?: number;
}) => Promise<OrchestratorRun>;

export type RunOneBriefConfig = {
  caseDir: string;
  traceFile: string;
  manifestFile: string;
  model: string;
  /** Working directory for the spawned orchestrator run. Defaults to
   *  `process.cwd()` in the CLI so dry-run behaviour is unchanged. */
  runDir: string;
  /** Caller asked for a live run. */
  live: boolean;
  /** Whether the runtime's API key is present in the environment. */
  apiKeyPresent: boolean;
  /** The adapter runtime to use. Defaults to `'claude'` in the CLI. */
  runtime: 'claude' | 'cursor';
  /** Optional hard per-run USD budget cap (Claude adapter only). */
  maxBudgetUsd?: number;
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

async function defaultCreateAgent(runtime: 'claude' | 'cursor'): Promise<CreateAgent> {
  // Lazy import so the SDK is only required when a live run is actually
  // requested without an injected agent. Never reached under test.
  if (runtime === 'cursor') {
    const adapter = await import('./sdk-adapter.ts');
    return adapter.createCursorAgent;
  }
  const adapter = await import('./claude-adapter.ts');
  return adapter.createClaudeAgent;
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
    runtime: config.runtime,
  } as const;

  if (!gateSatisfied(config)) {
    const keyName = config.runtime === 'cursor' ? 'CURSOR_API_KEY' : 'ANTHROPIC_API_KEY';
    const reason = !config.live
      ? `dry-run: live execution not requested (pass --live and set ${keyName} to run live)`
      : `dry-run: live requested but ${keyName} is absent`;
    const manifest: RunManifest = {
      ...baseManifest,
      status: 'dry-run',
      run_id: null,
      agent_id: null,
      tokens: null,
      wall_clock_ms: null,
      cost_usd: null,
      num_turns: null,
      finished_at: now(),
      notes: [reason, 'no SDK call was made; no orchestrator run was spawned'],
    };
    const manifestContent = writeManifest(config.manifestFile, manifest);
    return { status: 'dry-run', manifest, manifestContent, createAgentCalled: false };
  }

  const createAgent = deps.createAgent ?? (await defaultCreateAgent(config.runtime));
  const prompt = assemblePrompt(golden);

  let run: OrchestratorRun;
  try {
    run = await createAgent({
      model: config.model,
      prompt,
      cwd: config.runDir,
      maxBudgetUsd: config.maxBudgetUsd,
    });
  } catch (err) {
    const manifest: RunManifest = {
      ...baseManifest,
      status: 'startup-failed',
      run_id: null,
      agent_id: null,
      tokens: null,
      wall_clock_ms: null,
      cost_usd: null,
      num_turns: null,
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
    const accumulatedTokens: TokenTotals | null =
      usageUpdates.length > 0 ? accumulateUsage(usageUpdates) : null;
    const tokens: TokenTotals | null = outcome.tokens ?? accumulatedTokens;

    const notes: string[] = [];
    if (outcome.status === 'finished' && tokens === null) {
      notes.push(
        'tokens unavailable: @cursor/sdk local runtime emits no usage events (see spike 2026-05-31)',
      );
    }

    const manifest: RunManifest = {
      ...baseManifest,
      status: outcome.status,
      run_id: outcome.runId,
      agent_id: outcome.agentId,
      tokens,
      wall_clock_ms: outcome.durationMs,
      cost_usd: outcome.costUsd,
      num_turns: outcome.numTurns,
      finished_at: now(),
      notes,
    };
    const manifestContent = writeManifest(config.manifestFile, manifest);
    return { status: outcome.status, manifest, manifestContent, createAgentCalled: true };
  } catch (err) {
    // A live stream/wait can throw mid-run; write an error manifest with the
    // usage gathered so far so the token signal and the failure survive rather
    // than escaping as an unhandled rejection out of `void main()`.
    const tokens: TokenTotals | null =
      usageUpdates.length > 0 ? accumulateUsage(usageUpdates) : null;
    const manifest: RunManifest = {
      ...baseManifest,
      status: 'error',
      run_id: null,
      agent_id: null,
      tokens,
      wall_clock_ms: null,
      cost_usd: null,
      num_turns: null,
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
  '[--manifest-file <path>] [--live] [--runtime <claude|cursor>] [--max-budget-usd <n>]\n' +
  'Live execution requires both --live and the runtime API key. Default runtime is claude.';

function parseArgs(argv: string[]): {
  caseDir?: string;
  model?: string;
  traceFile?: string;
  manifestFile?: string;
  live: boolean;
  runtime: 'claude' | 'cursor';
  maxBudgetUsd?: number;
} {
  let caseDir: string | undefined;
  let model: string | undefined;
  let traceFile: string | undefined;
  let manifestFile: string | undefined;
  let live = false;
  let runtime: 'claude' | 'cursor' = 'claude';
  let maxBudgetUsd: number | undefined;
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
      case '--runtime': {
        const val = takeValue();
        if (val !== 'claude' && val !== 'cursor') {
          process.stderr.write(`--runtime must be "claude" or "cursor"\n${USAGE}\n`);
          process.exit(1);
        }
        runtime = val;
        break;
      }
      case '--max-budget-usd': {
        const val = Number(takeValue());
        if (!Number.isFinite(val) || val <= 0) {
          process.stderr.write(`--max-budget-usd must be a positive number\n${USAGE}\n`);
          process.exit(1);
        }
        maxBudgetUsd = val;
        break;
      }
      default:
        process.stderr.write(`Unknown argument: ${arg}\n${USAGE}\n`);
        process.exit(1);
    }
  }
  return { caseDir, model, traceFile, manifestFile, live, runtime, maxBudgetUsd };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.caseDir === undefined || parsed.model === undefined) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }
  const traceFile = parsed.traceFile ?? join(parsed.caseDir, 'run-trace.jsonl');
  const manifestFile = parsed.manifestFile ?? join(parsed.caseDir, 'run-manifest.json');
  const runtime = parsed.runtime;
  const apiKeyEnvVar = runtime === 'cursor' ? 'CURSOR_API_KEY' : 'ANTHROPIC_API_KEY';
  const apiKeyValue = process.env[apiKeyEnvVar];

  const result = await runOneBrief({
    caseDir: parsed.caseDir,
    model: parsed.model,
    traceFile,
    manifestFile,
    runDir: process.cwd(),
    live: parsed.live,
    apiKeyPresent: typeof apiKeyValue === 'string' && apiKeyValue.length > 0,
    runtime,
    maxBudgetUsd: parsed.maxBudgetUsd,
  });

  process.stdout.write(`${result.manifestContent}\n`);
  process.exit(result.status === 'error' || result.status === 'startup-failed' ? 2 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
