import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTrace, loadTraceFromString } from '../load.ts';

const TRACE_PATH = fileURLToPath(new URL('./fixtures/sample-trace.jsonl', import.meta.url));

describe('loadTraceFromString', () => {
  it('returns all-empty result for empty string', () => {
    const result = loadTraceFromString('');
    assert.equal(result.events.length, 0);
    assert.equal(result.unknown.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('ignores blank lines', () => {
    const result = loadTraceFromString('  \n\n  ');
    assert.equal(result.events.length, 0);
    assert.equal(result.unknown.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('captures malformed JSON in errors with correct 1-based line number', () => {
    const input = '{"valid":true}\n{not json\n{"another":"valid"}';
    const result = loadTraceFromString(input);
    const jsonError = result.errors.find((e) => e.line === 2);
    assert.ok(jsonError !== undefined, 'line 2 should be captured in errors');
    assert.equal(jsonError.line, 2);
    assert.equal(jsonError.raw, '{not json');
  });

  it('puts an object with an unknown event_type into the unknown array', () => {
    const futureEvent = JSON.stringify({
      event_id: 'aabbccdd-1234-4567-8901-abcdef012345',
      event_type: 'slice4-future-event',
      schema_version: '1',
      ts: '2026-01-01T00:00:00.000Z',
      project_run_id: 'test-run',
      orchestrator_agent_id: null,
      future_field: 'whatever',
    });
    const result = loadTraceFromString(futureEvent);
    assert.equal(result.unknown.length, 1);
    assert.equal(result.unknown[0].event_type, 'slice4-future-event');
    assert.equal(result.unknown[0].unknownType, true);
    assert.equal(result.unknown[0].origin, 'native');
    assert.equal(result.errors.length, 0);
  });

  it('puts a known-type object that fails schema validation into errors', () => {
    const malformedKnownEvent = JSON.stringify({
      event_id: 'aabbccdd-1234-4567-8901-abcdef012345',
      event_type: 'dispatch-start',
      schema_version: '1',
      ts: '2026-01-01T00:00:00.000Z',
      project_run_id: 'test-run',
      orchestrator_agent_id: null,
      // Missing required fields: dispatch_id, dispatch_name, subagent_type, model, parent_dispatch_id
    });
    const result = loadTraceFromString(malformedKnownEvent);
    assert.equal(result.errors.length, 1);
    assert.equal(result.unknown.length, 0);
  });
});

describe('loadTrace', () => {
  it('parses real trace.jsonl with 0 errors and the expected event count', () => {
    const fileContent = readFileSync(TRACE_PATH, 'utf8');
    const nonBlankLineCount = fileContent
      .split('\n')
      .filter((line) => line.trim().length > 0).length;

    const result = loadTrace(TRACE_PATH);

    assert.equal(result.errors.length, 0, 'expected no parse/validation errors');
    assert.equal(
      result.events.length + result.unknown.length,
      nonBlankLineCount,
      `expected all ${nonBlankLineCount} non-blank lines to produce events or unknown entries`,
    );
  });

  it('never throws on a non-existent path (returns a load error)', () => {
    assert.doesNotThrow(() => {
      const result = loadTrace('/nonexistent/path/trace.jsonl');
      assert.equal(result.errors.length, 1);
    });
  });
});
