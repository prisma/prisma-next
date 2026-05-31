import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import { loadCase } from '../load-brief.ts';
import {
  assemblePrompt,
  type CreateAgent,
  type OrchestratorRun,
  type RunOutcome,
  type RunStreamEvent,
  runOneBrief,
} from '../run-one-brief.ts';
import type { TokenTotals } from '../usage.ts';

const GOLDEN_DIR = fileURLToPath(
  new URL('../../../projects/drive-judge-harness/assets/golden/', import.meta.url),
);
const CASE_DIR = join(GOLDEN_DIR, 'slice-dedupe-generated-imports');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'judge-run-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const FIXED_NOW = () => '2026-05-30T12:00:00.000Z';

const NULL_OUTCOME: RunOutcome = {
  status: 'finished',
  runId: null,
  agentId: null,
  durationMs: null,
  tokens: null,
  costUsd: null,
  numTurns: null,
};

/** A mock orchestrator run that yields synthetic stream events — no network. */
function mockRun(events: RunStreamEvent[], outcome: RunOutcome): OrchestratorRun {
  return {
    async *stream() {
      for (const e of events) yield e;
    },
    async wait() {
      return outcome;
    },
  };
}

describe('runOneBrief — dry-run gate', () => {
  it('does not call createAgent when live is false', async () => {
    let called = false;
    const createAgent: CreateAgent = async () => {
      called = true;
      return mockRun([], NULL_OUTCOME);
    };
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: false,
        apiKeyPresent: true,
        runtime: 'claude',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(called, false);
    assert.equal(result.createAgentCalled, false);
    assert.equal(result.status, 'dry-run');
    assert.equal(result.manifest.tokens, null);
    assert.equal(result.manifest.runtime, 'claude');
  });

  it('does not call createAgent when live is true but no API key (cursor runtime)', async () => {
    let called = false;
    const createAgent: CreateAgent = async () => {
      called = true;
      return mockRun([], NULL_OUTCOME);
    };
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: false,
        runtime: 'cursor',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(called, false);
    assert.equal(result.status, 'dry-run');
    assert.match(result.manifest.notes.join(' '), /CURSOR_API_KEY is absent/);
  });

  it('does not call createAgent when live is true but no API key (claude runtime)', async () => {
    let called = false;
    const createAgent: CreateAgent = async () => {
      called = true;
      return mockRun([], NULL_OUTCOME);
    };
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: false,
        runtime: 'claude',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(called, false);
    assert.equal(result.status, 'dry-run');
    assert.match(result.manifest.notes.join(' '), /ANTHROPIC_API_KEY is absent/);
  });

  it('writes a dry-run manifest to disk', async () => {
    const manifestFile = join(dir, 'run.json');
    await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile,
        model: 'pinned-model',
        runDir: dir,
        live: false,
        apiKeyPresent: false,
        runtime: 'claude',
      },
      { now: FIXED_NOW },
    );
    const parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(parsed.status, 'dry-run');
    assert.equal(parsed.case_slug, 'slice-dedupe-generated-imports');
    assert.equal(parsed.model, 'pinned-model');
    assert.equal(parsed.tokens, null);
    assert.equal(parsed.runtime, 'claude');
    assert.equal(parsed.cost_usd, null);
    assert.equal(parsed.num_turns, null);
  });
});

describe('runOneBrief — live path with mock SDK', () => {
  it('accumulates tokens from turn-ended events and writes a finished manifest', async () => {
    const events: RunStreamEvent[] = [
      { kind: 'text', text: 'working...' },
      {
        kind: 'turn-ended',
        usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 5 },
      },
      { kind: 'other' },
      { kind: 'turn-ended', usage: { inputTokens: 50, outputTokens: 20 } },
    ];
    const createAgent: CreateAgent = async () =>
      mockRun(events, {
        status: 'finished',
        runId: 'run-42',
        agentId: 'agent-42',
        durationMs: null,
        tokens: null,
        costUsd: null,
        numTurns: null,
      });

    const manifestFile = join(dir, 'run.json');
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile,
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'cursor',
      },
      { createAgent, now: FIXED_NOW },
    );

    assert.equal(result.createAgentCalled, true);
    assert.equal(result.status, 'finished');
    assert.ok(result.manifest.tokens !== null);
    assert.equal(result.manifest.tokens?.inputTokens, 150);
    assert.equal(result.manifest.tokens?.outputTokens, 60);
    assert.equal(result.manifest.tokens?.totalTokens, 225);
    assert.equal(result.manifest.run_id, 'run-42');
    assert.equal(result.manifest.runtime, 'cursor');

    const parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(parsed.tokens.totalTokens, 225);
  });

  it('records a startup-failed manifest when createAgent throws', async () => {
    const createAgent: CreateAgent = async () => {
      throw new Error('auth failed');
    };
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'claude',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(result.status, 'startup-failed');
    assert.equal(result.manifest.tokens, null);
    assert.match(result.manifest.notes.join(' '), /auth failed/);
  });

  it('records an error manifest (with tokens) when the run ends in error', async () => {
    const events: RunStreamEvent[] = [
      { kind: 'turn-ended', usage: { inputTokens: 10, outputTokens: 2 } },
    ];
    const createAgent: CreateAgent = async () =>
      mockRun(events, {
        status: 'error',
        runId: 'run-err',
        agentId: null,
        durationMs: null,
        tokens: null,
        costUsd: null,
        numTurns: null,
      });
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'claude',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(result.status, 'error');
    assert.equal(result.manifest.tokens?.totalTokens, 12);
  });

  it('writes an error manifest (with tokens) when the stream throws mid-run', async () => {
    const createAgent: CreateAgent = async () => ({
      async *stream() {
        yield { kind: 'turn-ended', usage: { inputTokens: 7, outputTokens: 3 } };
        throw new Error('stream died');
      },
      async wait() {
        return {
          status: 'finished' as const,
          runId: 'unreached',
          agentId: null,
          durationMs: null,
          tokens: null,
          costUsd: null,
          numTurns: null,
        };
      },
    });
    const manifestFile = join(dir, 'run.json');
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile,
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'claude',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(result.status, 'error');
    assert.equal(result.manifest.tokens?.totalTokens, 10);
    assert.match(result.manifest.notes.join(' '), /stream died/);
    // The manifest is still written to disk despite the throw.
    const parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(parsed.status, 'error');
  });

  it('captures agent_id and wall_clock_ms from the outcome, and notes null tokens', async () => {
    const createAgent: CreateAgent = async () =>
      mockRun([], {
        status: 'finished',
        runId: 'run-live-1',
        agentId: 'agent-live-1',
        durationMs: 87654,
        tokens: null,
        costUsd: null,
        numTurns: null,
      });

    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'cursor',
      },
      { createAgent, now: FIXED_NOW },
    );

    assert.equal(result.status, 'finished');
    assert.equal(result.manifest.agent_id, 'agent-live-1');
    assert.equal(result.manifest.wall_clock_ms, 87654);
    assert.equal(result.manifest.tokens, null);
    assert.ok(
      result.manifest.notes.some((n) =>
        n.includes('tokens unavailable: @cursor/sdk local runtime emits no usage events'),
      ),
    );
  });

  it('prefers outcome.tokens over per-turn accumulation when the runtime provides them', async () => {
    const runtimeTokens: TokenTotals = {
      inputTokens: 33,
      outputTokens: 904,
      cacheReadTokens: 230827,
      cacheWriteTokens: 53995,
      totalTokens: 285759,
    };
    // Also emit a per-turn event with different values to confirm outcome wins.
    const events: RunStreamEvent[] = [
      { kind: 'turn-ended', usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const createAgent: CreateAgent = async () =>
      mockRun(events, {
        status: 'finished',
        runId: 'sess-abc',
        agentId: null,
        durationMs: 16025,
        tokens: runtimeTokens,
        costUsd: 0.1839242,
        numTurns: 9,
      });

    const manifestFile = join(dir, 'run.json');
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile,
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'claude',
      },
      { createAgent, now: FIXED_NOW },
    );

    assert.equal(result.status, 'finished');
    assert.equal(result.manifest.runtime, 'claude');
    // outcome.tokens takes priority over accumulated per-turn totals
    assert.equal(result.manifest.tokens?.inputTokens, 33);
    assert.equal(result.manifest.tokens?.outputTokens, 904);
    assert.equal(result.manifest.tokens?.totalTokens, 285759);
    assert.equal(result.manifest.cost_usd, 0.1839242);
    assert.equal(result.manifest.num_turns, 9);
    assert.equal(result.manifest.wall_clock_ms, 16025);
    assert.equal(result.manifest.notes.length, 0, 'no notes when tokens are present');

    const parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(parsed.runtime, 'claude');
    assert.equal(parsed.tokens.totalTokens, 285759);
    assert.equal(parsed.cost_usd, 0.1839242);
    assert.equal(parsed.num_turns, 9);
    assert.equal(parsed.wall_clock_ms, 16025);
  });

  it('runtime:cursor produces runtime:cursor in the manifest', async () => {
    const createAgent: CreateAgent = async () => mockRun([], NULL_OUTCOME);
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
        runtime: 'cursor',
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(result.manifest.runtime, 'cursor');
  });
});

describe('assemblePrompt', () => {
  it('embeds the brief text and the Drive framing', () => {
    const golden = loadCase(CASE_DIR);
    const prompt = assemblePrompt(golden);
    assert.match(prompt, /Drive orchestrator/);
    assert.ok(prompt.includes(golden.briefText));
    assert.match(prompt, /slice-dedupe-generated-imports/);
  });
});
