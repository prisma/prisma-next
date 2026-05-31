import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { join } from 'pathe';
import { computeScorecard } from '../../drive-diagnose-run/scorecard.ts';
import type { TraceEvent } from '../../drive-record-traces/schema.ts';
import { emitMergedCorrectness, mergedCorrectnessPayload } from '../judge/emit-correctness.ts';

const ENV = {
  event_id: '00000000-1111-4222-8333-444444444444',
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

describe('mergedCorrectnessPayload — pure merge', () => {
  it('fills intent and preserves a prior mechanical:pass + qa:pass', () => {
    const events: TraceEvent[] = [mkCorrectness('run-1', 'pass', 'pass', null)];
    const payload = mergedCorrectnessPayload(events, 'run-1', 'pass');
    assert.deepEqual(payload, { mechanical: 'pass', qa: 'pass', intent: 'pass' });
  });

  it('preserves mechanical:pass when no qa is recorded yet', () => {
    const events: TraceEvent[] = [mkCorrectness('run-1', 'pass', null, null)];
    const payload = mergedCorrectnessPayload(events, 'run-1', 'fail');
    assert.deepEqual(payload, { mechanical: 'pass', qa: null, intent: 'fail' });
  });

  it('uses the latest recorded {mechanical, qa} when multiple events exist', () => {
    const events: TraceEvent[] = [
      mkCorrectness('run-1', 'fail', null, null),
      mkCorrectness('run-1', 'pass', 'pass', null),
    ];
    const payload = mergedCorrectnessPayload(events, 'run-1', 'pass');
    assert.deepEqual(payload, { mechanical: 'pass', qa: 'pass', intent: 'pass' });
  });

  it('ignores correctness events for OTHER runs when merging', () => {
    const events: TraceEvent[] = [
      mkCorrectness('run-other', 'fail', 'fail', 'fail'),
      mkCorrectness('run-1', 'pass', null, null),
    ];
    const payload = mergedCorrectnessPayload(events, 'run-1', 'pass');
    assert.deepEqual(payload, { mechanical: 'pass', qa: null, intent: 'pass' });
  });

  it('emits {mechanical:null, qa:null, intent:<verdict>} when no prior event exists', () => {
    const payload = mergedCorrectnessPayload([], 'run-1', 'pass');
    assert.deepEqual(payload, { mechanical: null, qa: null, intent: 'pass' });
  });

  it('forwards a null intent verdict (the fail-to-null invariant)', () => {
    const events: TraceEvent[] = [mkCorrectness('run-1', 'pass', 'pass', null)];
    const payload = mergedCorrectnessPayload(events, 'run-1', null);
    assert.deepEqual(payload, { mechanical: 'pass', qa: 'pass', intent: null });
  });
});

describe('emitMergedCorrectness — appends a merge-preserving event', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'judge-emit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one correctness-recorded line carrying the merged triple', () => {
    const traceFile = join(dir, 'trace.jsonl');
    const events: TraceEvent[] = [mkCorrectness('run-1', 'pass', 'pass', null)];
    const result = emitMergedCorrectness({
      traceFile,
      projectRunId: 'run-1',
      events,
      intent: 'pass',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const obj = JSON.parse(result.line);
    assert.equal(obj.event_type, 'correctness-recorded');
    assert.equal(obj.mechanical, 'pass');
    assert.equal(obj.qa, 'pass');
    assert.equal(obj.intent, 'pass');

    const onDisk = readFileSync(traceFile, 'utf8').trim();
    assert.equal(JSON.parse(onDisk).intent, 'pass');
  });
});

describe('end-to-end — scorecard composes intent from a merged emission', () => {
  it('a prior mechanical:pass + qa:pass survives the judge filling intent — scorecard reads correct', () => {
    const priorEvents: TraceEvent[] = [mkCorrectness('run-1', 'pass', 'pass', null)];
    const payload = mergedCorrectnessPayload(priorEvents, 'run-1', 'pass');
    const merged: TraceEvent = {
      ...ENV,
      project_run_id: 'run-1',
      event_type: 'correctness-recorded',
      ...payload,
    };
    const sc = computeScorecard([...priorEvents, merged]);
    assert.equal(sc.runs[0].verdict, 'correct');
    assert.deepEqual(sc.runs[0].correctness, { mechanical: 'pass', qa: 'pass', intent: 'pass' });
  });

  it('a null intent verdict leaves the scorecard not-computable, naming intent as missing', () => {
    const priorEvents: TraceEvent[] = [mkCorrectness('run-1', 'pass', 'pass', null)];
    const payload = mergedCorrectnessPayload(priorEvents, 'run-1', null);
    const merged: TraceEvent = {
      ...ENV,
      project_run_id: 'run-1',
      event_type: 'correctness-recorded',
      ...payload,
    };
    const sc = computeScorecard([...priorEvents, merged]);
    assert.equal(sc.runs[0].verdict, 'not-computable');
    assert.ok(sc.runs[0].missing_inputs.includes('intent'));
  });

  it('a prior mechanical:pass survives a fail intent → scorecard reads incorrect (not lost)', () => {
    const priorEvents: TraceEvent[] = [mkCorrectness('run-1', 'pass', 'pass', null)];
    const payload = mergedCorrectnessPayload(priorEvents, 'run-1', 'fail');
    const merged: TraceEvent = {
      ...ENV,
      project_run_id: 'run-1',
      event_type: 'correctness-recorded',
      ...payload,
    };
    const sc = computeScorecard([...priorEvents, merged]);
    assert.equal(sc.runs[0].verdict, 'incorrect');
    assert.equal(sc.runs[0].correctness?.mechanical, 'pass');
    assert.equal(sc.runs[0].correctness?.qa, 'pass');
    assert.equal(sc.runs[0].correctness?.intent, 'fail');
  });
});
