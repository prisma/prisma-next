import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { join } from 'pathe';
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
});
