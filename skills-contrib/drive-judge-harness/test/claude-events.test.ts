import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outcomeFromResult, streamEventFromMessage, usageFromAssistant } from '../claude-events.ts';

// Real shapes from @anthropic-ai/claude-agent-sdk (confirmed from SDK docs).
// These tests must pass with @anthropic-ai/claude-agent-sdk NOT installed.

const ASSISTANT_MESSAGE = {
  type: 'assistant',
  message: {
    id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
    usage: {
      input_tokens: 33,
      output_tokens: 904,
      cache_creation_input_tokens: 53995,
      cache_read_input_tokens: 230827,
    },
  },
};

const SUCCESS_RESULT = {
  type: 'result',
  subtype: 'success',
  session_id: 'sess-abc123',
  duration_ms: 16025,
  num_turns: 9,
  total_cost_usd: 0.1839242,
  usage: {
    input_tokens: 33,
    output_tokens: 904,
    cache_creation_input_tokens: 53995,
    cache_read_input_tokens: 230827,
  },
  result: 'done',
};

const ERROR_MAX_TURNS_RESULT = {
  type: 'result',
  subtype: 'error_max_turns',
  session_id: 'sess-def456',
  duration_ms: 8000,
  num_turns: 5,
  total_cost_usd: 0.05,
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  result: null,
};

describe('usageFromAssistant', () => {
  it('maps all four fields from message.usage', () => {
    const usage = usageFromAssistant(ASSISTANT_MESSAGE);
    assert.ok(usage !== null);
    assert.equal(usage.inputTokens, 33);
    assert.equal(usage.outputTokens, 904);
    assert.equal(usage.cacheWriteTokens, 53995);
    assert.equal(usage.cacheReadTokens, 230827);
  });

  it('returns null for a non-assistant type', () => {
    assert.equal(usageFromAssistant({ type: 'result', subtype: 'success' }), null);
  });

  it('returns null for an assistant message without usage', () => {
    assert.equal(usageFromAssistant({ type: 'assistant', message: { id: 'x' } }), null);
  });

  it('returns null for a non-record', () => {
    assert.equal(usageFromAssistant('junk'), null);
    assert.equal(usageFromAssistant(null), null);
    assert.equal(usageFromAssistant(42), null);
  });
});

describe('streamEventFromMessage', () => {
  it('maps an assistant message with usage to {kind:turn-ended}', () => {
    const event = streamEventFromMessage(ASSISTANT_MESSAGE);
    assert.equal(event.kind, 'turn-ended');
    assert.ok(event.kind === 'turn-ended' && event.usage.inputTokens === 33);
    assert.ok(event.kind === 'turn-ended' && event.usage.cacheWriteTokens === 53995);
    assert.ok(event.kind === 'turn-ended' && event.usage.cacheReadTokens === 230827);
  });

  it('maps a result message to {kind:other}', () => {
    const event = streamEventFromMessage(SUCCESS_RESULT);
    assert.equal(event.kind, 'other');
  });

  it('maps junk to {kind:other}', () => {
    assert.equal(streamEventFromMessage({ type: 'unknown' }).kind, 'other');
    assert.equal(streamEventFromMessage(null).kind, 'other');
  });
});

describe('outcomeFromResult', () => {
  it('extracts all fields from a success result', () => {
    const outcome = outcomeFromResult(SUCCESS_RESULT);
    assert.ok(outcome !== null);
    assert.equal(outcome.status, 'finished');
    assert.equal(outcome.runId, 'sess-abc123');
    assert.equal(outcome.durationMs, 16025);
    assert.equal(outcome.costUsd, 0.1839242);
    assert.equal(outcome.numTurns, 9);
  });

  it('maps token fields correctly on a success result', () => {
    const outcome = outcomeFromResult(SUCCESS_RESULT);
    assert.ok(outcome !== null && outcome.tokens !== null);
    assert.equal(outcome.tokens.inputTokens, 33);
    assert.equal(outcome.tokens.outputTokens, 904);
    assert.equal(outcome.tokens.cacheWriteTokens, 53995);
    assert.equal(outcome.tokens.cacheReadTokens, 230827);
    assert.equal(outcome.tokens.totalTokens, 33 + 904 + 53995 + 230827);
  });

  it('maps status=error for error_max_turns subtype', () => {
    const outcome = outcomeFromResult(ERROR_MAX_TURNS_RESULT);
    assert.ok(outcome !== null);
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.runId, 'sess-def456');
    assert.equal(outcome.durationMs, 8000);
    assert.equal(outcome.costUsd, 0.05);
    assert.equal(outcome.numTurns, 5);
  });

  it('maps token fields for error_max_turns result', () => {
    const outcome = outcomeFromResult(ERROR_MAX_TURNS_RESULT);
    assert.ok(outcome !== null && outcome.tokens !== null);
    assert.equal(outcome.tokens.inputTokens, 10);
    assert.equal(outcome.tokens.outputTokens, 20);
    assert.equal(outcome.tokens.cacheWriteTokens, 0);
    assert.equal(outcome.tokens.cacheReadTokens, 0);
    assert.equal(outcome.tokens.totalTokens, 30);
  });

  it('returns null for a non-result type', () => {
    assert.equal(outcomeFromResult(ASSISTANT_MESSAGE), null);
    assert.equal(outcomeFromResult({ type: 'status' }), null);
  });

  it('returns null for a non-record', () => {
    assert.equal(outcomeFromResult('junk'), null);
    assert.equal(outcomeFromResult(null), null);
  });

  it('sets tokens:null when usage is absent', () => {
    const noUsage = { ...SUCCESS_RESULT, usage: undefined };
    const outcome = outcomeFromResult(noUsage);
    assert.ok(outcome !== null);
    assert.equal(outcome.tokens, null);
  });

  it('sets costUsd:null when total_cost_usd is absent', () => {
    const { total_cost_usd: _c, ...noUsd } = SUCCESS_RESULT;
    const outcome = outcomeFromResult(noUsd);
    assert.ok(outcome !== null);
    assert.equal(outcome.costUsd, null);
  });

  it('sets durationMs:null when duration_ms is absent', () => {
    const { duration_ms: _d, ...noDuration } = SUCCESS_RESULT;
    const outcome = outcomeFromResult(noDuration);
    assert.ok(outcome !== null);
    assert.equal(outcome.durationMs, null);
  });

  it('sets numTurns:null when num_turns is absent', () => {
    const { num_turns: _n, ...noTurns } = SUCCESS_RESULT;
    const outcome = outcomeFromResult(noTurns);
    assert.ok(outcome !== null);
    assert.equal(outcome.numTurns, null);
  });
});
