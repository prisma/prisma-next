import { spawnSync } from 'node:child_process';
import { findJsonlFiles } from './trace-files.ts';

export type SkillBundleRef = {
  repoDir: string;
  ref: string;
};

export type PrepareRunConfig = {
  repoUnderTestDir: string;
  baseRef: string;
  skillBundle: SkillBundleRef;
  runDir: string;
};

export type PreparedRun = {
  runDir: string;
  baseRef: string;
  baseSha: string;
  skillBundleSha: string;
  prepareCommit: string;
  materialized: boolean;
  /** Paths of all `.jsonl` files present under `runDir` immediately after the
   *  baseline commit — i.e. traces committed in the base checkout before the
   *  agent run starts. `collectRun` excludes these so only run-emitted traces
   *  are collected. Deterministic snapshot (no mtime reliance). */
  preexistingTracePaths: string[];
};

export type PrepareRunDeps = {
  git?: (args: string[], cwd: string) => { stdout: string };
  materialize?: (runDir: string) => { ok: boolean; log: string };
};

function defaultGit(args: string[], cwd: string): { stdout: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) {
    throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return { stdout: (result.stdout ?? '').trim() };
}

function defaultMaterialize(runDir: string): { ok: boolean; log: string } {
  const result = spawnSync('pnpm', ['install'], {
    cwd: runDir,
    encoding: 'utf-8',
    timeout: 120_000,
  });
  if (result.error) {
    return { ok: false, log: result.error.message };
  }
  return {
    ok: result.status === 0,
    log: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

const BUNDLE_PATHS = ['skills-contrib', '.agents/rules', 'AGENTS.md', 'CLAUDE.md'];

export function prepareRun(config: PrepareRunConfig, deps?: PrepareRunDeps): PreparedRun {
  const git = deps?.git ?? defaultGit;
  const materialize = deps?.materialize ?? defaultMaterialize;

  const baseSha = git(['rev-parse', config.baseRef], config.repoUnderTestDir).stdout;
  const skillBundleSha = git(
    ['rev-parse', config.skillBundle.ref],
    config.skillBundle.repoDir,
  ).stdout;

  git(['worktree', 'add', '--detach', config.runDir, config.baseRef], config.repoUnderTestDir);

  const archiveResult = spawnSync(
    'git',
    ['archive', config.skillBundle.ref, '--', ...BUNDLE_PATHS],
    { cwd: config.skillBundle.repoDir, encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 },
  );
  if (archiveResult.error) {
    throw new Error(`git archive: ${archiveResult.error.message}`);
  }
  if (archiveResult.status !== 0) {
    throw new Error(`git archive: ${archiveResult.stderr.toString()}`);
  }
  if (archiveResult.stdout.length > 0) {
    const tarResult = spawnSync('tar', ['-x', '-C', config.runDir], {
      input: archiveResult.stdout,
      encoding: 'buffer',
      maxBuffer: 100 * 1024 * 1024,
    });
    if (tarResult.error) {
      throw new Error(`tar extract: ${tarResult.error.message}`);
    }
    if (tarResult.status !== 0) {
      throw new Error(`tar extract: ${tarResult.stderr.toString()}`);
    }
  }

  const matResult = materialize(config.runDir);

  git(['add', '-A'], config.runDir);
  git(['commit', '--allow-empty', '-m', 'prepare-run baseline'], config.runDir);
  const prepareCommit = git(['rev-parse', 'HEAD'], config.runDir).stdout;

  const preexistingTracePaths = findJsonlFiles(config.runDir);

  return {
    runDir: config.runDir,
    baseRef: config.baseRef,
    baseSha,
    skillBundleSha,
    prepareCommit,
    materialized: matResult.ok,
    preexistingTracePaths,
  };
}
