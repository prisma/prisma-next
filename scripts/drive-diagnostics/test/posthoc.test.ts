import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseTranscript, parseTranscriptFromString } from '../posthoc.ts';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/sample-transcript.jsonl', import.meta.url));

const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// parseTranscriptFromString — sample fixture
// ---------------------------------------------------------------------------

describe('parseTranscriptFromString — sample fixture', () => {
  const result = parseTranscriptFromString(FIXTURE_TEXT, 'sample-transcript.jsonl');

  it('reconstructs 4 events (1 dispatch-start + 2 spec-authored + 1 plan-authored)', () => {
    assert.equal(result.events.length, 4);
  });

  it('operatorTurnCount equals the 4 user-role turns in the fixture', () => {
    assert.equal(result.operatorTurnCount, 4);
  });

  it('all events have origin: post-hoc', () => {
    for (const e of result.events) {
      assert.equal(e.origin, 'post-hoc');
    }
  });

  it('dispatch-start event has confidence medium', () => {
    const dispatchEvent = result.events.find((e) => e.event.event_type === 'dispatch-start');
    assert.ok(dispatchEvent !== undefined, 'dispatch-start event must exist');
    assert.equal(dispatchEvent.confidence, 'medium');
  });

  it('dispatch-start event carries dispatch_name from Task input.description', () => {
    const dispatchEvent = result.events.find((e) => e.event.event_type === 'dispatch-start');
    assert.ok(dispatchEvent !== undefined);
    const event = dispatchEvent.event;
    assert.equal(event.event_type, 'dispatch-start');
    if (event.event_type === 'dispatch-start') {
      assert.equal(event.dispatch_name, 'Implement posthoc parser');
      assert.equal(event.model, 'claude-opus-4-7-thinking-high');
      assert.equal(event.subagent_type, 'generalPurpose');
    }
  });

  it('dispatch-start event has a synthetic event_id and dispatch_id (not null)', () => {
    const dispatchEvent = result.events.find((e) => e.event.event_type === 'dispatch-start');
    assert.ok(dispatchEvent !== undefined);
    const event = dispatchEvent.event;
    assert.equal(event.event_type, 'dispatch-start');
    if (event.event_type === 'dispatch-start') {
      assert.ok(event.event_id.length > 0);
      assert.ok(event.dispatch_id.length > 0);
    }
  });

  it('spec-authored events have confidence low', () => {
    const specEvents = result.events.filter((e) => e.event.event_type === 'spec-authored');
    assert.equal(specEvents.length, 2);
    for (const e of specEvents) {
      assert.equal(e.confidence, 'low');
    }
  });

  it('spec-authored events have spec_kind slice (path contains slices/)', () => {
    const specEvents = result.events.filter((e) => e.event.event_type === 'spec-authored');
    for (const e of specEvents) {
      const event = e.event;
      if (event.event_type === 'spec-authored') {
        assert.equal(event.spec_kind, 'slice');
        assert.ok(event.spec_path.endsWith('spec.md'));
      }
    }
  });

  it('plan-authored event has confidence low', () => {
    const planEvent = result.events.find((e) => e.event.event_type === 'plan-authored');
    assert.ok(planEvent !== undefined, 'plan-authored event must exist');
    assert.equal(planEvent.confidence, 'low');
  });

  it('plan-authored event has plan_kind project (path does not contain slices/)', () => {
    const planEvent = result.events.find((e) => e.event.event_type === 'plan-authored');
    assert.ok(planEvent !== undefined);
    const event = planEvent.event;
    if (event.event_type === 'plan-authored') {
      assert.equal(event.plan_kind, 'project');
      assert.ok(event.plan_path.endsWith('plan.md'));
    }
  });

  it('ts is null on all reconstructed events', () => {
    for (const e of result.events) {
      assert.equal(e.event.ts, null);
    }
  });

  it('notes mention ts unavailability', () => {
    const hasTsNote = result.notes.some((n) => n.includes('ts'));
    assert.ok(hasTsNote, 'notes should mention ts unavailability');
  });
});

// ---------------------------------------------------------------------------
// parseTranscriptFromString — empty / structureless transcripts
// ---------------------------------------------------------------------------

describe('parseTranscriptFromString — empty transcript', () => {
  const result = parseTranscriptFromString('');

  it('returns empty events list', () => {
    assert.equal(result.events.length, 0);
  });

  it('operatorTurnCount is 0', () => {
    assert.equal(result.operatorTurnCount, 0);
  });

  it('includes no-signal note', () => {
    const hasNote = result.notes.some((n) =>
      n.includes('no Drive dispatch/authoring signal detected'),
    );
    assert.ok(hasNote);
  });
});

describe('parseTranscriptFromString — user turns only, no Drive signals', () => {
  const text = [
    '{"role":"user","message":{"content":[{"type":"text","text":"Hello"}]}}',
    '{"role":"assistant","message":{"content":[{"type":"text","text":"Hi there!"}]}}',
  ].join('\n');

  const result = parseTranscriptFromString(text);

  it('returns empty events list', () => {
    assert.equal(result.events.length, 0);
  });

  it('still counts operator turns', () => {
    assert.equal(result.operatorTurnCount, 1);
  });

  it('includes no-signal note', () => {
    const hasNote = result.notes.some((n) =>
      n.includes('no Drive dispatch/authoring signal detected'),
    );
    assert.ok(hasNote);
  });
});

// ---------------------------------------------------------------------------
// parseTranscriptFromString — robustness: malformed lines
// ---------------------------------------------------------------------------

describe('parseTranscriptFromString — malformed line does not throw', () => {
  const text = [
    'NOT_JSON',
    '{"role":"user","message":{"content":[{"type":"text","text":"hello"}]}}',
    '{bad json}',
    '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Task","input":{"description":"foo","subagent_type":"generalPurpose"}}]}}',
  ].join('\n');

  let result: ReturnType<typeof parseTranscriptFromString> | undefined;

  it('does not throw on malformed lines', () => {
    assert.doesNotThrow(() => {
      result = parseTranscriptFromString(text);
    });
  });

  it('still reconstructs events from valid lines', () => {
    assert.ok(result !== undefined);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.event.event_type, 'dispatch-start');
  });

  it('records notes for unparseable lines', () => {
    assert.ok(result !== undefined);
    const unparseableNotes = result.notes.filter((n) => n.includes('unparseable'));
    assert.ok(unparseableNotes.length >= 2, 'should record a note for each unparseable line');
  });
});

// ---------------------------------------------------------------------------
// parseTranscript — reads the fixture file
// ---------------------------------------------------------------------------

describe('parseTranscript — reads from file path', () => {
  const result = parseTranscript(FIXTURE_PATH);

  it('returns the same event count as parseTranscriptFromString', () => {
    const fromString = parseTranscriptFromString(FIXTURE_TEXT, FIXTURE_PATH);
    assert.equal(result.events.length, fromString.events.length);
  });

  it('returns the same operatorTurnCount as parseTranscriptFromString', () => {
    const fromString = parseTranscriptFromString(FIXTURE_TEXT, FIXTURE_PATH);
    assert.equal(result.operatorTurnCount, fromString.operatorTurnCount);
  });
});
