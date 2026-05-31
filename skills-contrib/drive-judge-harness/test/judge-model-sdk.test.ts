import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSdkJudgeModel } from '../judge/judge-model-sdk.ts';

describe('createSdkJudgeModel — cross-family guard', () => {
  it('rejects a same-family (claude) judge id when orchestrator is claude', () => {
    assert.throws(
      () =>
        createSdkJudgeModel({
          judgeModelId: 'claude-4.6-sonnet-high-thinking',
          orchestratorFamily: 'claude',
        }),
      /cross-family/i,
    );
  });

  it('rejects when the judge id matches the orchestrator family by prefix', () => {
    assert.throws(
      () =>
        createSdkJudgeModel({
          judgeModelId: 'claude-opus-4-8-thinking-high',
          orchestratorFamily: 'claude',
        }),
      /cross-family/i,
    );
  });

  it('accepts a cross-family judge id (default GPT 5.5 vs claude orchestrator)', () => {
    const model = createSdkJudgeModel({
      judgeModelId: 'gpt-5.5',
      orchestratorFamily: 'claude',
    });
    assert.equal(typeof model.grade, 'function');
  });

  it('defaults to GPT 5.5 as the judge id when none is provided', () => {
    const model = createSdkJudgeModel({ orchestratorFamily: 'claude' });
    assert.equal(typeof model.grade, 'function');
  });

  it('rejects gpt-family judge id when orchestrator is gpt', () => {
    assert.throws(
      () =>
        createSdkJudgeModel({
          judgeModelId: 'gpt-5.5',
          orchestratorFamily: 'gpt',
        }),
      /cross-family/i,
    );
  });
});
