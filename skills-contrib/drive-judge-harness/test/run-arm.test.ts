import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import { type RunArmConfig, runArm } from '../run-arm.ts';
import type { CreateAgent, OrchestratorRun } from '../run-one-brief.ts';

const GOLDEN_DIR = fileURLToPath(
  new URL('../../../projects/drive-judge-harness/assets/golden/', import.meta.url),
);
const CASE_DIR = join(GOLDEN_DIR, 'slice-dedupe-generated-imports');

let tmpDir: string;
let repoDir: string;
let runDir: string;
let baseRef: string;
let bundleRef: string;

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-arm-'));
  repoDir = join(tmpDir, 'repo');
  runDir = join(tmpDir, 'run');

  mkdirSync(repoDir, { recursive: true });
  gitIn(repoDir, 'init', '-b', 'main');
  gitIn(repoDir, 'config', 'user.email', 'test@example.com');
  gitIn(repoDir, 'config', 'user.name', 'Test');
  gitIn(repoDir, 'config', 'commit.gpgsign', 'false');

  mkdirSync(join(repoDir, 'src'));
  writeFileSync(join(repoDir, 'src', 'foo.ts'), 'export const x = 1;\n');
  gitIn(repoDir, 'add', '-A');
  gitIn(repoDir, 'commit', '-m', 'initial');
  baseRef = gitIn(repoDir, 'rev-parse', 'HEAD');

  mkdirSync(join(repoDir, 'skills-contrib'));
  writeFileSync(join(repoDir, 'skills-contrib', 'skill.md'), '# Skill\n');
  mkdirSync(join(repoDir, '.agents', 'rules'), { recursive: true });
  writeFileSync(join(repoDir, '.agents', 'rules', 'example.mdc'), '# Rule\n');
  writeFileSync(join(repoDir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(repoDir, 'CLAUDE.md'), '# Claude\n');
  gitIn(repoDir, 'add', '-A');
  gitIn(repoDir, 'commit', '-m', 'add bundle');
  bundleRef = gitIn(repoDir, 'rev-parse', 'HEAD');
});

afterEach(() => {
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repoDir, encoding: 'utf-8' });
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

const FIXED_NOW = () => '2026-05-31T00:00:00.000Z';

function mockRun(): OrchestratorRun {
  return {
    async *stream() {},
    async wait() {
      return { status: 'finished', runId: 'run-1', agentId: 'agent-1' };
    },
  };
}

const mockMaterialize = (): { ok: boolean; log: string } => ({ ok: true, log: '' });

function baseConfig(): RunArmConfig {
  return {
    repoUnderTestDir: repoDir,
    baseRef,
    skillBundle: { repoDir, ref: bundleRef },
    runDir,
    caseDir: CASE_DIR,
    model: 'pinned-model',
    traceFile: join(tmpDir, 'trace.jsonl'),
    manifestFile: join(tmpDir, 'run.json'),
    live: true,
    apiKeyPresent: true,
  };
}

describe('runArm — enriched manifest', () => {
  it('writes a manifest with all pinned-input fields', async () => {
    const createAgent: CreateAgent = async () => mockRun();

    const result = await runArm(baseConfig(), {
      createAgent,
      materialize: mockMaterialize,
      now: FIXED_NOW,
    });

    assert.equal(result.manifest.base_ref, baseRef);
    assert.equal(result.manifest.base_sha, baseRef);
    assert.equal(result.manifest.skill_bundle_ref, bundleRef);
    assert.equal(result.manifest.skill_bundle_sha, bundleRef);
    assert.ok(typeof result.manifest.run_dir === 'string');
    assert.ok(Array.isArray(result.manifest.collected_trace_paths));
    assert.ok(result.manifest.diff_stat !== undefined);
    assert.equal(result.manifest.materialized, true);
  });

  it('manifest round-trips through disk', async () => {
    const createAgent: CreateAgent = async () => mockRun();

    const config = baseConfig();
    await runArm(config, { createAgent, materialize: mockMaterialize, now: FIXED_NOW });

    const parsed = JSON.parse(readFileSync(config.manifestFile, 'utf-8'));
    assert.equal(parsed.base_ref, baseRef);
    assert.equal(parsed.skill_bundle_ref, bundleRef);
    assert.ok(typeof parsed.run_dir === 'string');
    assert.ok(Array.isArray(parsed.collected_trace_paths));
    assert.ok(typeof parsed.materialized === 'boolean');
  });

  it('records materialized:false when materialize fails', async () => {
    const createAgent: CreateAgent = async () => mockRun();

    const result = await runArm(baseConfig(), {
      createAgent,
      materialize: () => ({ ok: false, log: 'old toolchain' }),
      now: FIXED_NOW,
    });

    assert.equal(result.manifest.materialized, false);
  });

  it('dry-run still writes an enriched manifest', async () => {
    const config = { ...baseConfig(), live: false };

    const result = await runArm(config, { materialize: mockMaterialize, now: FIXED_NOW });

    assert.equal(result.manifest.status, 'dry-run');
    assert.equal(result.manifest.base_ref, baseRef);
    assert.ok(result.manifest.diff_stat !== undefined);
  });
});
