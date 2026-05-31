import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { join } from 'pathe';
import { collectRun } from '../collect-run.ts';
import { type PrepareRunConfig, prepareRun } from '../prepare-run.ts';

let tmpDir: string;
let repoDir: string;
let runDir: string;
let baseRef: string;
let bundleRef: string;

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'prepare-run-'));
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
    // ignore — repo may already be removed
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

const mockMaterialize = (): { ok: boolean; log: string } => ({ ok: true, log: '' });

describe('prepareRun', () => {
  it('creates the runDir', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    prepareRun(config, { materialize: mockMaterialize });
    assert.ok(existsSync(runDir));
  });

  it('resolves baseSha and skillBundleSha to the correct commits', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });
    assert.equal(prepared.baseSha, baseRef);
    assert.equal(prepared.skillBundleSha, bundleRef);
  });

  it('overlays skill bundle files into the base checkout', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    prepareRun(config, { materialize: mockMaterialize });
    assert.ok(existsSync(join(runDir, 'skills-contrib', 'skill.md')));
    assert.ok(existsSync(join(runDir, '.agents', 'rules', 'example.mdc')));
    assert.ok(existsSync(join(runDir, 'AGENTS.md')));
    assert.ok(existsSync(join(runDir, 'CLAUDE.md')));
  });

  it('preserves base checkout files alongside the overlay', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    prepareRun(config, { materialize: mockMaterialize });
    assert.ok(existsSync(join(runDir, 'src', 'foo.ts')));
  });

  it('produces a 40-character prepareCommit SHA', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });
    assert.equal(prepared.prepareCommit.length, 40);
  });

  it('records materialized:true when materialize succeeds', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: () => ({ ok: true, log: '' }) });
    assert.equal(prepared.materialized, true);
  });

  it('records materialized:false when materialize fails', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, {
      materialize: () => ({ ok: false, log: 'toolchain mismatch' }),
    });
    assert.equal(prepared.materialized, false);
  });

  it('returns runDir and baseRef matching the config', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });
    assert.equal(prepared.runDir, runDir);
    assert.equal(prepared.baseRef, baseRef);
  });

  it('does not throw and yields a 40-char prepareCommit when the overlay stages nothing', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef: bundleRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });
    assert.equal(prepared.prepareCommit.length, 40);
  });

  it('preexistingTracePaths is empty when the base checkout has no .jsonl files', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });
    assert.ok(Array.isArray(prepared.preexistingTracePaths));
    assert.equal(prepared.preexistingTracePaths.length, 0);
  });

  it('preexistingTracePaths lists committed .jsonl files present at baseline', () => {
    // Add a .jsonl to the base checkout so it's in the worktree after prepare-run
    mkdirSync(join(repoDir, 'wip', 'drive-trace'), { recursive: true });
    writeFileSync(join(repoDir, 'wip', 'drive-trace', 'old-trace.jsonl'), '{"event_id":"e0"}\n');
    gitIn(repoDir, 'add', '-A');
    gitIn(repoDir, 'commit', '-m', 'add old trace');
    const baseRefWithTrace = gitIn(repoDir, 'rev-parse', 'HEAD');

    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef: baseRefWithTrace,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });
    assert.equal(prepared.preexistingTracePaths.length, 1);
    assert.ok(prepared.preexistingTracePaths[0]?.endsWith('old-trace.jsonl'));
  });
});

describe('prepareRun + collectRun — empty-overlay cut point', () => {
  it('collectRun reports no changes before agent work and picks up a post-baseline change', () => {
    const config: PrepareRunConfig = {
      repoUnderTestDir: repoDir,
      baseRef: bundleRef,
      skillBundle: { repoDir, ref: bundleRef },
      runDir,
    };
    const prepared = prepareRun(config, { materialize: mockMaterialize });

    const before = collectRun(prepared);
    assert.equal(before.diffStat.filesChanged, 0);
    assert.equal(before.diff.trim(), '');

    writeFileSync(join(runDir, 'src', 'bar.ts'), 'export const y = 2;\n');
    gitIn(runDir, 'add', '-A');
    gitIn(runDir, 'commit', '-m', 'agent: add bar.ts');

    const after = collectRun(prepared);
    assert.equal(after.diffStat.filesChanged, 1);
    assert.ok(after.diff.includes('bar.ts'));
  });
});
