import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TraceEvent } from '../../drive-record-traces/schema.ts';
import { computeScorecard } from '../scorecard.ts';

const ENV = {
  event_id: 'aabbccdd-1234-4567-8901-abcdef000000',
  schema_version: '1' as const,
  ts: '2026-01-01T00:00:00.000Z',
  orchestrator_agent_id: null,
};

function mkCorrectness(
  project_run_id: string,
  mechanical: 'pass' | 'fail' | null,
  qa: 'pass' | 'fail' | null,
  intent: 'pass' | 'fail' | null,
): TraceEvent {
  return { ...ENV, project_run_id, event_type: 'correctness-recorded', mechanical, qa, intent };
}

function mkTokens(
  project_run_id: string,
  input_tokens: number | null,
  output_tokens: number | null,
  cache_read_tokens: number | null,
  cache_write_tokens: number | null,
): TraceEvent {
  return {
    ...ENV,
    project_run_id,
    event_type: 'tokens-recorded',
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_write_tokens,
  };
}

function mkSliceStarted(project_run_id: string): TraceEvent {
  return {
    ...ENV,
    project_run_id,
    event_type: 'slice-started',
    slice_slug: 'a-slice',
    slice_index: 1,
    linear_ref: null,
  };
}

describe('computeScorecard — no correctness signal', () => {
  const sc = computeScorecard([mkSliceStarted('run-1')]);

  it('marks the run not-computable', () => {
    assert.equal(sc.runs.length, 1);
    assert.equal(sc.runs[0].verdict, 'not-computable');
  });

  it('names the external correctness signal as the missing input', () => {
    assert.match(sc.runs[0].missing_inputs.join(' '), /correctness signal/i);
  });

  it('reports no correctness signal present', () => {
    assert.equal(sc.has_any_correctness_signal, false);
  });

  it('yields no CORRECT runs', () => {
    assert.deepEqual(sc.correct_run_ids, []);
  });
});

describe('computeScorecard — all-pass correctness', () => {
  const sc = computeScorecard([
    mkCorrectness('run-1', 'pass', 'pass', 'pass'),
    mkTokens('run-1', 1900000, 42000, 800000, 12000),
  ]);

  it('marks the run correct', () => {
    assert.equal(sc.runs[0].verdict, 'correct');
  });

  it('lists the run as CORRECT', () => {
    assert.deepEqual(sc.correct_run_ids, ['run-1']);
  });

  it('aggregates token totals over correct runs', () => {
    assert.equal(sc.correct_tokens.input_tokens, 1900000);
    assert.equal(sc.correct_tokens.output_tokens, 42000);
  });

  it('records a correctness signal present', () => {
    assert.equal(sc.has_any_correctness_signal, true);
  });
});

describe('computeScorecard — partial correctness signal', () => {
  const sc = computeScorecard([mkCorrectness('run-1', 'pass', null, null)]);

  it('marks the run not-computable when a component is null', () => {
    assert.equal(sc.runs[0].verdict, 'not-computable');
  });

  it('names the null components as missing inputs', () => {
    assert.deepEqual(sc.runs[0].missing_inputs, ['qa', 'intent']);
  });

  it('still counts as a correctness signal present', () => {
    assert.equal(sc.has_any_correctness_signal, true);
  });
});

describe('computeScorecard — a failing component', () => {
  const sc = computeScorecard([mkCorrectness('run-1', 'pass', 'fail', 'pass')]);

  it('marks the run incorrect', () => {
    assert.equal(sc.runs[0].verdict, 'incorrect');
  });

  it('yields no CORRECT runs', () => {
    assert.deepEqual(sc.correct_run_ids, []);
  });
});

describe('computeScorecard — correct run with null tokens', () => {
  const sc = computeScorecard([
    mkCorrectness('run-1', 'pass', 'pass', 'pass'),
    mkTokens('run-1', null, null, null, null),
  ]);

  it('keeps token totals null when the only correct run recorded nulls', () => {
    assert.equal(sc.correct_tokens.input_tokens, null);
    assert.equal(sc.correct_tokens.output_tokens, null);
  });

  it('still marks the run correct', () => {
    assert.equal(sc.runs[0].verdict, 'correct');
  });
});

describe('computeScorecard — multiple runs', () => {
  const sc = computeScorecard([
    mkCorrectness('run-1', 'pass', 'pass', 'pass'),
    mkTokens('run-1', 100, 10, 0, 0),
    mkCorrectness('run-2', 'pass', 'fail', 'pass'),
    mkSliceStarted('run-3'),
  ]);

  it('produces one row per project_run_id in first-seen order', () => {
    assert.deepEqual(
      sc.runs.map((r) => r.run_id),
      ['run-1', 'run-2', 'run-3'],
    );
  });

  it('classifies each run independently', () => {
    assert.equal(sc.runs[0].verdict, 'correct');
    assert.equal(sc.runs[1].verdict, 'incorrect');
    assert.equal(sc.runs[2].verdict, 'not-computable');
  });

  it('sums tokens only over CORRECT runs', () => {
    assert.equal(sc.correct_tokens.input_tokens, 100);
  });
});
