import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentIdFromMessage,
  isRecord,
  outcomeFromResult,
  streamEventFromMessage,
} from '../sdk-events.ts';

// Real shapes from @cursor/sdk@1.0.15 local runtime (captured via probe).
// Tests here must pass with @cursor/sdk NOT installed.

const STATUS_MESSAGE = {
  type: 'status',
  agent_id: 'agent-abc123',
  run_id: 'run-xyz789',
  status: 'running',
};

const ASSISTANT_MESSAGE = {
  type: 'assistant',
  agent_id: 'agent-abc123',
  run_id: 'run-xyz789',
  message: {
    content: [{ type: 'text', text: 'Hello from the orchestrator.' }],
  },
};

const WAIT_OUTCOME = {
  id: 'run-xyz789',
  status: 'finished',
  result: 'done',
  model: 'composer-2.5-fast',
  durationMs: 42500,
};

describe('agentIdFromMessage', () => {
  it('reads agent_id from a status message', () => {
    assert.equal(agentIdFromMessage(STATUS_MESSAGE), 'agent-abc123');
  });

  it('reads agent_id from an assistant message', () => {
    assert.equal(agentIdFromMessage(ASSISTANT_MESSAGE), 'agent-abc123');
  });

  it('returns null for the wait() outcome (no agent_id field)', () => {
    assert.equal(agentIdFromMessage(WAIT_OUTCOME), null);
  });

  it('returns null for a non-object (string)', () => {
    assert.equal(agentIdFromMessage('junk'), null);
  });

  it('returns null for a non-object (null)', () => {
    assert.equal(agentIdFromMessage(null), null);
  });

  it('returns null for a record with no agent_id', () => {
    assert.equal(agentIdFromMessage({ type: 'other' }), null);
  });
});

describe('outcomeFromResult', () => {
  it('extracts runId, status=finished, and durationMs from the real outcome shape', () => {
    const result = outcomeFromResult(WAIT_OUTCOME);
    assert.equal(result.status, 'finished');
    assert.equal(result.runId, 'run-xyz789');
    assert.equal(result.durationMs, 42500);
  });

  it('maps status=error for a non-finished status', () => {
    const result = outcomeFromResult({ ...WAIT_OUTCOME, status: 'failed' });
    assert.equal(result.status, 'error');
  });

  it('returns durationMs:null when durationMs is absent', () => {
    const { durationMs: _d, ...withoutDuration } = WAIT_OUTCOME;
    const result = outcomeFromResult(withoutDuration);
    assert.equal(result.durationMs, null);
  });

  it('returns durationMs:null when durationMs is not a number', () => {
    const result = outcomeFromResult({ ...WAIT_OUTCOME, durationMs: 'not-a-number' });
    assert.equal(result.durationMs, null);
  });

  it('degrades to {status:error, runId:null, durationMs:null} for a non-record', () => {
    const result = outcomeFromResult('not-an-object');
    assert.equal(result.status, 'error');
    assert.equal(result.runId, null);
    assert.equal(result.durationMs, null);
  });

  it('degrades to {status:error, runId:null, durationMs:null} for null', () => {
    const result = outcomeFromResult(null);
    assert.equal(result.status, 'error');
    assert.equal(result.runId, null);
    assert.equal(result.durationMs, null);
  });
});

describe('streamEventFromMessage', () => {
  it('maps a status message to {kind:other} (no usage, no assistant text)', () => {
    const event = streamEventFromMessage(STATUS_MESSAGE);
    assert.equal(event.kind, 'other');
  });

  it('maps an assistant message with text content to {kind:text}', () => {
    const event = streamEventFromMessage(ASSISTANT_MESSAGE);
    assert.equal(event.kind, 'text');
    assert.ok(event.kind === 'text' && event.text.includes('Hello from the orchestrator.'));
  });

  it('maps a turn-ended message with usage to {kind:turn-ended}', () => {
    const turnEndedMsg = {
      usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
    const event = streamEventFromMessage(turnEndedMsg);
    assert.equal(event.kind, 'turn-ended');
    assert.ok(event.kind === 'turn-ended' && event.usage.inputTokens === 100);
  });

  it('maps junk to {kind:other}', () => {
    const event = streamEventFromMessage({ type: 'unknown-event' });
    assert.equal(event.kind, 'other');
  });
});

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord({ a: 1 }), true);
  });

  it('returns false for arrays', () => {
    assert.equal(isRecord([]), false);
  });

  it('returns false for null', () => {
    assert.equal(isRecord(null), false);
  });

  it('returns false for primitives', () => {
    assert.equal(isRecord('string'), false);
    assert.equal(isRecord(42), false);
  });
});
