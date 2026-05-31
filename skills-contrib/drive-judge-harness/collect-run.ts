import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { type } from 'arktype';
import { Slice1TraceEvent } from '../drive-record-traces/schema.ts';
import type { PreparedRun } from './prepare-run.ts';
import { findJsonlFiles } from './trace-files.ts';

export type CollectedRun = {
  tracePaths: string[];
  matchedTrace: string | null;
  diff: string;
  diffStat: { filesChanged: number; insertions: number; deletions: number };
  untraced: boolean;
};

function firstLineOf(filePath: string): string | null {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const line = content.split('\n')[0];
  return line && line.trim().length > 0 ? line : null;
}

function parseFirstLine(filePath: string): unknown | null {
  const line = firstLineOf(filePath);
  if (line === null) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isValidTrace(filePath: string): boolean {
  const parsed = parseFirstLine(filePath);
  if (parsed === null) return false;
  const result = Slice1TraceEvent(parsed);
  return !(result instanceof type.errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function orchestratorAgentId(filePath: string): string | null {
  const parsed = parseFirstLine(filePath);
  if (!isRecord(parsed)) return null;
  return typeof parsed.orchestrator_agent_id === 'string' ? parsed.orchestrator_agent_id : null;
}

function parseDiffStat(numstat: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split('\n')) {
    if (line.trim().length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const added = Number.parseInt(parts[0], 10);
    const removed = Number.parseInt(parts[1], 10);
    if (!Number.isNaN(added)) insertions += added;
    if (!Number.isNaN(removed)) deletions += removed;
    filesChanged++;
  }
  return { filesChanged, insertions, deletions };
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) {
    throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return result.stdout ?? '';
}

export function collectRun(
  prepared: PreparedRun,
  opts?: { agentId?: string | null },
): CollectedRun {
  const { runDir, prepareCommit, preexistingTracePaths } = prepared;

  const preexistingSet = new Set(preexistingTracePaths);
  const allJsonl = findJsonlFiles(runDir).filter((p) => !preexistingSet.has(p));
  const tracePaths = allJsonl.filter(isValidTrace);

  let matchedTrace: string | null = null;
  if (tracePaths.length > 0) {
    const agentId = opts?.agentId ?? null;
    if (agentId !== null) {
      const byId = tracePaths.find((p) => orchestratorAgentId(p) === agentId);
      if (byId !== undefined) {
        matchedTrace = byId;
      }
    }
    if (matchedTrace === null) {
      const sorted = tracePaths
        .map((p) => ({ path: p, mtime: statSync(p).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      matchedTrace = sorted[0]?.path ?? null;
    }
  }

  const diff = runGit(['diff', prepareCommit], runDir);
  const numstat = runGit(['diff', '--numstat', prepareCommit], runDir);
  const diffStat = parseDiffStat(numstat);

  return {
    tracePaths,
    matchedTrace,
    diff,
    diffStat,
    untraced: tracePaths.length === 0,
  };
}
