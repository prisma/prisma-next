import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { type } from 'arktype';
import { join } from 'pathe';
import { emitEvent } from '../emit.ts';
import { Slice1TraceEvent } from '../schema.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drive-emit-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validTriagePayload = {
  verdict: 'in-project-slice',
  input_shape: 'linear-ticket',
  input_ref: 'TML-2721',
};

describe('emitEvent', () => {
  it('appends exactly one compact JSON line accepted by the canonical schema', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
    });

    assert.equal(result.ok, true);
    const content = readFileSync(traceFile, 'utf8');
    const lines = content.split('\n');
    assert.equal(lines.length, 2, 'one line plus trailing newline');
    assert.equal(lines[1], '', 'file ends with a single newline');
    assert.ok(!lines[0].includes('\n'), 'line is compact (no embedded newlines)');

    const parsed = JSON.parse(lines[0]);
    const validated = Slice1TraceEvent(parsed);
    assert.ok(!(validated instanceof type.errors), 'emitted line round-trips through the schema');
  });

  it('owns the envelope: stamps event_id, schema_version, ts, event_type', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const obj = JSON.parse(result.line);
    assert.equal(obj.schema_version, '1');
    assert.equal(obj.event_type, 'triage-verdict');
    assert.equal(obj.project_run_id, 'sample-project');
    assert.equal(obj.orchestrator_agent_id, null);
    assert.match(obj.event_id, /^[0-9a-f-]{36}$/);
    assert.equal(typeof obj.ts, 'string');
  });

  it('uses the provided orchestrator_agent_id when given', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
      orchestratorAgentId: 'agent-123',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(JSON.parse(result.line).orchestrator_agent_id, 'agent-123');
  });

  it('creates the parent directory on first append', () => {
    const traceFile = join(dir, 'nested', 'deeper', 'trace.jsonl');
    assert.equal(existsSync(traceFile), false);
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
    });
    assert.equal(result.ok, true);
    assert.equal(existsSync(traceFile), true);
  });

  it('appends successive events as separate lines', () => {
    const traceFile = join(dir, 'trace.jsonl');
    emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
    });
    emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
    });
    const lines = readFileSync(traceFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });

  it('rejects an unknown event type and writes nothing', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'not-a-real-event',
      payload: {},
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(traceFile), false);
  });

  it('rejects a known event with a wrong-typed field and writes nothing', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: { ...validTriagePayload, verdict: 123 },
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(traceFile), false);
  });

  it('rejects a payload carrying an envelope key and names the key', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: { ...validTriagePayload, event_id: 'forced' },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /event_id/);
    assert.equal(existsSync(traceFile), false);
  });

  it('leaves an existing trace file untouched when validation fails', () => {
    const traceFile = join(dir, 'trace.jsonl');
    emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: validTriagePayload,
    });
    const before = readFileSync(traceFile, 'utf8');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'triage-verdict',
      payload: { ...validTriagePayload, verdict: 123 },
    });
    assert.equal(result.ok, false);
    assert.equal(readFileSync(traceFile, 'utf8'), before);
  });
});

describe('emitEvent — tokens-recorded', () => {
  it('accepts a fully-populated token usage event', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'tokens-recorded',
      payload: {
        input_tokens: 1_900_000,
        output_tokens: 42_000,
        cache_read_tokens: 800_000,
        cache_write_tokens: 12_000,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const validated = Slice1TraceEvent(JSON.parse(result.line));
    assert.ok(!(validated instanceof type.errors));
  });

  it('accepts null for every token component (partial SDK report)', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'tokens-recorded',
      payload: {
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
      },
    });
    assert.equal(result.ok, true);
  });

  it('rejects a negative token count and writes nothing', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'tokens-recorded',
      payload: {
        input_tokens: -1,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(traceFile), false);
  });

  it('rejects a non-integer token count', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'tokens-recorded',
      payload: {
        input_tokens: 1.5,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
      },
    });
    assert.equal(result.ok, false);
  });

  it('rejects a missing token component', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'tokens-recorded',
      payload: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 1 },
    });
    assert.equal(result.ok, false);
  });
});

describe('emitEvent — correctness-recorded', () => {
  it('accepts an all-pass correctness verdict', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'correctness-recorded',
      payload: { mechanical: 'pass', qa: 'pass', intent: 'pass' },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const validated = Slice1TraceEvent(JSON.parse(result.line));
    assert.ok(!(validated instanceof type.errors));
  });

  it('accepts null components (feed not yet populated)', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'correctness-recorded',
      payload: { mechanical: 'pass', qa: null, intent: null },
    });
    assert.equal(result.ok, true);
  });

  it('rejects an unknown verdict value and writes nothing', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'correctness-recorded',
      payload: { mechanical: 'maybe', qa: 'pass', intent: 'pass' },
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(traceFile), false);
  });

  it('rejects a missing component', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const result = emitEvent({
      traceFile,
      projectRunId: 'sample-project',
      event: 'correctness-recorded',
      payload: { mechanical: 'pass', qa: 'pass' },
    });
    assert.equal(result.ok, false);
  });
});
