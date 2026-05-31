import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyOperator, renderOperatorPrompt } from '../judge/classify-operator.ts';
import type { JudgeModel } from '../judge/judge-model.ts';

function mockJudge(response: string): JudgeModel {
  return {
    async grade() {
      return response;
    },
  };
}

const INPUTS = {
  operatorTurnText: 'Use auth code 0xABCD to confirm the destructive operation.',
  surroundingTraceExcerpts: 'round-start round_number: 2',
};

describe('renderOperatorPrompt', () => {
  it('lists the five canonical operator-turn buckets', () => {
    const prompt = renderOperatorPrompt(INPUTS);
    assert.match(prompt, /legitimate-design/);
    assert.match(prompt, /legitimate-authorisation/);
    assert.match(prompt, /illegitimate-asked/);
    assert.match(prompt, /illegitimate-correction/);
    assert.match(prompt, /illegitimate-rescue/);
  });

  it('embeds the operator turn text', () => {
    const prompt = renderOperatorPrompt(INPUTS);
    assert.ok(prompt.includes('0xABCD'));
  });
});

describe('classifyOperator', () => {
  it('parses a legitimate-authorisation bucket', async () => {
    const judge = mockJudge(
      '{"bucket": "legitimate-authorisation", "reasons": ["operator supplied a destructive-operation auth code"]}',
    );
    const verdict = await classifyOperator(INPUTS, judge);
    assert.equal(verdict.bucket, 'legitimate-authorisation');
    assert.equal(verdict.reasons.length, 1);
  });

  it('parses an illegitimate-rescue bucket', async () => {
    const judge = mockJudge(
      '{"bucket": "illegitimate-rescue", "reasons": ["operator wrote the failing code themselves"]}',
    );
    const verdict = await classifyOperator(INPUTS, judge);
    assert.equal(verdict.bucket, 'illegitimate-rescue');
  });

  it('returns bucket:null on a malformed response — never silent', async () => {
    const judge = mockJudge('I think this is fine');
    const verdict = await classifyOperator(INPUTS, judge);
    assert.equal(verdict.bucket, null);
    assert.match(verdict.reasons.join(' '), /malformed|parse/i);
  });

  it('returns bucket:null when the bucket is not in the enum', async () => {
    const judge = mockJudge('{"bucket": "amazing-turn", "reasons": []}');
    const verdict = await classifyOperator(INPUTS, judge);
    assert.equal(verdict.bucket, null);
  });
});
