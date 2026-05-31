import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { join } from 'pathe';
import { collectRun } from '../collect-run.ts';
import type { PreparedRun } from '../prepare-run.ts';

let runDir: string;
let prepareCommit: string;

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

// A minimal valid trace event line (DispatchStartEvent shape).
const VALID_TRACE_LINE = JSON.stringify({
  event_id: 'e1',
  schema_version: '1',
  ts: '2026-05-31T00:00:00.000Z',
  project_run_id: 'proj-1',
  orchestrator_agent_id: 'agent-abc',
  event_type: 'dispatch-start',
  dispatch_id: 'd1',
  dispatch_name: 'test',
  subagent_type: 'generalPurpose',
  model: null,
  parent_dispatch_id: null,
});

const JUNK_TRACE_LINE = JSON.stringify({ type: 'unknown-event', data: 'not a trace event' });

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), 'collect-run-'));
  gitIn(runDir, 'init', '-b', 'main');
  gitIn(runDir, 'config', 'user.email', 'test@example.com');
  gitIn(runDir, 'config', 'user.name', 'Test');
  gitIn(runDir, 'config', 'commit.gpgsign', 'false');

  // Baseline commit: includes skill bundle files + source files
  mkdirSync(join(runDir, 'src'));
  writeFileSync(join(runDir, 'src', 'foo.ts'), 'export const x = 1;\n');
  mkdirSync(join(runDir, 'skills-contrib'));
  writeFileSync(join(runDir, 'skills-contrib', 'skill.md'), '# Skill\n');
  writeFileSync(join(runDir, 'AGENTS.md'), '# Agents\n');
  gitIn(runDir, 'add', '-A');
  gitIn(runDir, 'commit', '-m', 'prepare-run baseline');
  prepareCommit = gitIn(runDir, 'rev-parse', 'HEAD');
});

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

function fakePrepared(overrides?: Partial<PreparedRun>): PreparedRun {
  return {
    runDir,
    baseRef: 'main',
    baseSha: 'baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    skillBundleSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    prepareCommit,
    materialized: true,
    preexistingTracePaths: [],
    ...overrides,
  };
}

describe('collectRun — trace collection', () => {
  it('finds and validates a schema-conforming jsonl file', () => {
    writeFileSync(join(runDir, 'run-trace.jsonl'), `${VALID_TRACE_LINE}\n`);

    const result = collectRun(fakePrepared());
    assert.equal(result.tracePaths.length, 1);
    assert.ok(result.tracePaths[0]?.endsWith('run-trace.jsonl'));
    assert.equal(result.untraced, false);
  });

  it('rejects a jsonl whose first line fails schema validation', () => {
    writeFileSync(join(runDir, 'junk.jsonl'), `${JUNK_TRACE_LINE}\n`);

    const result = collectRun(fakePrepared());
    assert.equal(result.tracePaths.length, 0);
    assert.equal(result.matchedTrace, null);
    assert.equal(result.untraced, true);
  });

  it('keeps the valid trace and rejects the junk trace', () => {
    writeFileSync(join(runDir, 'run-trace.jsonl'), `${VALID_TRACE_LINE}\n`);
    writeFileSync(join(runDir, 'junk.jsonl'), `${JUNK_TRACE_LINE}\n`);

    const result = collectRun(fakePrepared());
    assert.equal(result.tracePaths.length, 1);
    assert.ok(result.tracePaths[0]?.endsWith('run-trace.jsonl'));
  });

  it('matches by orchestrator_agent_id when provided', () => {
    const otherLine = JSON.stringify({
      event_id: 'e2',
      schema_version: '1',
      ts: '2026-05-31T00:00:00.000Z',
      project_run_id: 'proj-2',
      orchestrator_agent_id: 'agent-other',
      event_type: 'dispatch-start',
      dispatch_id: 'd2',
      dispatch_name: 'other',
      subagent_type: 'generalPurpose',
      model: null,
      parent_dispatch_id: null,
    });
    writeFileSync(join(runDir, 'trace-abc.jsonl'), `${VALID_TRACE_LINE}\n`);
    writeFileSync(join(runDir, 'trace-other.jsonl'), `${otherLine}\n`);

    const result = collectRun(fakePrepared(), { agentId: 'agent-abc' });
    assert.ok(result.matchedTrace?.endsWith('trace-abc.jsonl'));
  });

  it('falls back to newest trace when agentId does not match', () => {
    writeFileSync(join(runDir, 'run-trace.jsonl'), `${VALID_TRACE_LINE}\n`);

    const result = collectRun(fakePrepared(), { agentId: 'no-such-agent' });
    assert.ok(result.matchedTrace?.endsWith('run-trace.jsonl'));
  });

  it('untraced is true when no valid trace exists', () => {
    const result = collectRun(fakePrepared());
    assert.equal(result.untraced, true);
    assert.equal(result.matchedTrace, null);
  });
});

describe('collectRun — preexistingTracePaths exclusion', () => {
  it('returns only the run-emitted trace, not the pre-existing baseline trace', () => {
    const baselinePath = join(runDir, 'baseline-trace.jsonl');
    const runEmittedPath = join(runDir, 'run-emitted-trace.jsonl');

    writeFileSync(baselinePath, `${VALID_TRACE_LINE}\n`);
    writeFileSync(runEmittedPath, `${VALID_TRACE_LINE}\n`);

    // Simulate: baseline-trace was present before the run started
    const result = collectRun(fakePrepared({ preexistingTracePaths: [baselinePath] }));

    assert.equal(result.tracePaths.length, 1, 'only one trace should be returned');
    assert.ok(
      result.tracePaths[0]?.endsWith('run-emitted-trace.jsonl'),
      'the returned trace must be the run-emitted one',
    );
    assert.ok(
      !result.tracePaths.some((p) => p.endsWith('baseline-trace.jsonl')),
      'the baseline-committed trace must not appear in results',
    );
    assert.equal(result.untraced, false);
  });

  it('returns no traces when every valid jsonl is listed in preexistingTracePaths', () => {
    const baselinePath = join(runDir, 'old-trace.jsonl');
    writeFileSync(baselinePath, `${VALID_TRACE_LINE}\n`);

    const result = collectRun(fakePrepared({ preexistingTracePaths: [baselinePath] }));

    assert.equal(result.tracePaths.length, 0);
    assert.equal(result.matchedTrace, null);
    assert.equal(result.untraced, true);
  });

  it('agent_id matching runs over the run-emitted set only', () => {
    const baselinePath = join(runDir, 'baseline-trace.jsonl');
    const runEmittedPath = join(runDir, 'run-trace.jsonl');

    // Both are valid traces but with different agent IDs.
    const baselineLine = JSON.stringify({
      event_id: 'e1',
      schema_version: '1',
      ts: '2026-05-31T00:00:00.000Z',
      project_run_id: 'proj-base',
      orchestrator_agent_id: 'agent-baseline',
      event_type: 'dispatch-start',
      dispatch_id: 'd1',
      dispatch_name: 'baseline',
      subagent_type: 'generalPurpose',
      model: null,
      parent_dispatch_id: null,
    });
    const runLine = JSON.stringify({
      event_id: 'e2',
      schema_version: '1',
      ts: '2026-05-31T00:00:00.000Z',
      project_run_id: 'proj-run',
      orchestrator_agent_id: 'agent-run',
      event_type: 'dispatch-start',
      dispatch_id: 'd2',
      dispatch_name: 'run',
      subagent_type: 'generalPurpose',
      model: null,
      parent_dispatch_id: null,
    });

    writeFileSync(baselinePath, `${baselineLine}\n`);
    writeFileSync(runEmittedPath, `${runLine}\n`);

    const result = collectRun(fakePrepared({ preexistingTracePaths: [baselinePath] }), {
      agentId: 'agent-baseline',
    });

    // 'agent-baseline' is only in the preexisting trace; the run-emitted set has
    // only 'agent-run'. The exclusion must happen before matching.
    assert.equal(result.tracePaths.length, 1);
    assert.ok(result.tracePaths[0]?.endsWith('run-trace.jsonl'));
    assert.ok(result.matchedTrace?.endsWith('run-trace.jsonl'));
  });
});

describe('collectRun — diff excludes injected skill files (baseline-commit cut point)', () => {
  it('diff against prepareCommit omits skill bundle files committed at baseline', () => {
    // Agent changes: only a source file — not the skill files
    writeFileSync(join(runDir, 'src', 'bar.ts'), 'export const y = 2;\n');
    gitIn(runDir, 'add', '-A');
    gitIn(runDir, 'commit', '-m', 'agent: add bar.ts');

    const result = collectRun(fakePrepared());

    assert.ok(result.diff.includes('bar.ts'), 'diff must mention agent-added bar.ts');
    assert.ok(!result.diff.includes('skill.md'), 'diff must not mention injected skill.md');
    assert.ok(!result.diff.includes('AGENTS.md'), 'diff must not mention injected AGENTS.md');
  });

  it('diffStat counts only agent-changed files', () => {
    writeFileSync(join(runDir, 'src', 'bar.ts'), 'export const y = 2;\n');
    gitIn(runDir, 'add', '-A');
    gitIn(runDir, 'commit', '-m', 'agent: add bar.ts');

    const result = collectRun(fakePrepared());

    assert.equal(result.diffStat.filesChanged, 1);
    assert.ok(result.diffStat.insertions > 0);
  });

  it('diff is empty when nothing changed after the baseline commit', () => {
    const result = collectRun(fakePrepared());
    assert.equal(result.diff.trim(), '');
    assert.equal(result.diffStat.filesChanged, 0);
  });
});
