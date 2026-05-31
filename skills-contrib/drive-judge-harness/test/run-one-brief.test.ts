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
  type RunStreamEvent,
  runOneBrief,
} from '../run-one-brief.ts';

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

/** A mock orchestrator run that yields synthetic stream events — no network. */
function mockRun(
  events: RunStreamEvent[],
  outcome: Awaited<ReturnType<OrchestratorRun['wait']>>,
): OrchestratorRun {
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
      return mockRun([], { status: 'finished', runId: null, agentId: null, durationMs: null });
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
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(called, false);
    assert.equal(result.createAgentCalled, false);
    assert.equal(result.status, 'dry-run');
    assert.equal(result.manifest.tokens, null);
  });

  it('does not call createAgent when live is true but no API key', async () => {
    let called = false;
    const createAgent: CreateAgent = async () => {
      called = true;
      return mockRun([], { status: 'finished', runId: null, agentId: null, durationMs: null });
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
      },
      { createAgent, now: FIXED_NOW },
    );
    assert.equal(called, false);
    assert.equal(result.status, 'dry-run');
    assert.match(result.manifest.notes.join(' '), /CURSOR_API_KEY is absent/);
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
      },
      { now: FIXED_NOW },
    );
    const parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(parsed.status, 'dry-run');
    assert.equal(parsed.case_slug, 'slice-dedupe-generated-imports');
    assert.equal(parsed.model, 'pinned-model');
    assert.equal(parsed.tokens, null);
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
      mockRun(events, { status: 'error', runId: 'run-err', agentId: null, durationMs: null });
    const result = await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir: dir,
        live: true,
        apiKeyPresent: true,
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
        return { status: 'finished', runId: 'unreached', agentId: null, durationMs: null };
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
