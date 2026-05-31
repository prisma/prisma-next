import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import type { CollectedRun } from './collect-run.ts';
import { collectRun } from './collect-run.ts';
import type { RunManifest } from './manifest.ts';
import { writeManifest } from './manifest.ts';
import {
  type PreparedRun,
  type PrepareRunConfig,
  prepareRun,
  type SkillBundleRef,
} from './prepare-run.ts';
import { type CreateAgent, type RunOneBriefResult, runOneBrief } from './run-one-brief.ts';

export type RunArmConfig = {
  repoUnderTestDir: string;
  baseRef: string;
  skillBundle: SkillBundleRef;
  runDir: string;
  caseDir: string;
  model: string;
  traceFile: string;
  manifestFile: string;
  live: boolean;
  apiKeyPresent: boolean;
};

export type RunArmDeps = {
  createAgent?: CreateAgent;
  materialize?: (runDir: string) => { ok: boolean; log: string };
  now?: () => string;
};

export type RunArmResult = {
  prepared: PreparedRun;
  runResult: RunOneBriefResult;
  collected: CollectedRun;
  manifest: RunManifest;
  manifestContent: string;
};

export async function runArm(config: RunArmConfig, deps?: RunArmDeps): Promise<RunArmResult> {
  const prepareConfig: PrepareRunConfig = {
    repoUnderTestDir: config.repoUnderTestDir,
    baseRef: config.baseRef,
    skillBundle: config.skillBundle,
    runDir: config.runDir,
  };
  const prepared = prepareRun(prepareConfig, { materialize: deps?.materialize });

  const runResult = await runOneBrief(
    {
      caseDir: config.caseDir,
      traceFile: config.traceFile,
      manifestFile: config.manifestFile,
      model: config.model,
      runDir: prepared.runDir,
      live: config.live,
      apiKeyPresent: config.apiKeyPresent,
    },
    { createAgent: deps?.createAgent, now: deps?.now },
  );

  const collected = collectRun(prepared, { agentId: runResult.manifest.agent_id });

  const manifest: RunManifest = {
    ...runResult.manifest,
    base_ref: config.baseRef,
    base_sha: prepared.baseSha,
    skill_bundle_ref: config.skillBundle.ref,
    skill_bundle_sha: prepared.skillBundleSha,
    run_dir: prepared.runDir,
    collected_trace_paths: collected.tracePaths,
    diff_stat: collected.diffStat,
    materialized: prepared.materialized,
  };

  const manifestContent = writeManifest(config.manifestFile, manifest);

  return { prepared, runResult, collected, manifest, manifestContent };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  'Usage: node skills-contrib/drive-judge-harness/run-arm.ts ' +
  '--repo <repo-dir> --base-ref <ref> --bundle-ref <ref> --run-dir <dir> ' +
  '--case <golden-case-dir> --model <model-id> ' +
  '[--bundle-repo <dir>] [--manifest-file <path>] [--live]\n' +
  'Live execution requires both --live and CURSOR_API_KEY.';

function parseArgs(argv: string[]): {
  repo?: string;
  baseRef?: string;
  bundleRef?: string;
  bundleRepo?: string;
  runDir?: string;
  caseDir?: string;
  model?: string;
  manifestFile?: string;
  live: boolean;
} {
  let repo: string | undefined;
  let baseRef: string | undefined;
  let bundleRef: string | undefined;
  let bundleRepo: string | undefined;
  let runDir: string | undefined;
  let caseDir: string | undefined;
  let model: string | undefined;
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
        break;
      case '--repo':
        repo = takeValue();
        break;
      case '--base-ref':
        baseRef = takeValue();
        break;
      case '--bundle-ref':
        bundleRef = takeValue();
        break;
      case '--bundle-repo':
        bundleRepo = takeValue();
        break;
      case '--run-dir':
        runDir = takeValue();
        break;
      case '--case':
        caseDir = takeValue();
        break;
      case '--model':
        model = takeValue();
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
  return { repo, baseRef, bundleRef, bundleRepo, runDir, caseDir, model, manifestFile, live };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (
    parsed.repo === undefined ||
    parsed.baseRef === undefined ||
    parsed.bundleRef === undefined ||
    parsed.runDir === undefined ||
    parsed.caseDir === undefined ||
    parsed.model === undefined
  ) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }

  const repoUnderTestDir = parsed.repo;
  const bundleRepoDir = parsed.bundleRepo ?? repoUnderTestDir;
  const manifestFile = parsed.manifestFile ?? join(parsed.runDir, 'run-manifest.json');
  const traceFile = join(parsed.runDir, 'run-trace.jsonl');

  const result = await runArm({
    repoUnderTestDir,
    baseRef: parsed.baseRef,
    skillBundle: { repoDir: bundleRepoDir, ref: parsed.bundleRef },
    runDir: parsed.runDir,
    caseDir: parsed.caseDir,
    model: parsed.model,
    traceFile,
    manifestFile,
    live: parsed.live,
    apiKeyPresent:
      typeof process.env.CURSOR_API_KEY === 'string' && process.env.CURSOR_API_KEY.length > 0,
  });

  process.stdout.write(`${result.manifestContent}\n`);
  const status = result.runResult.status;
  process.exit(status === 'error' || status === 'startup-failed' ? 2 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
