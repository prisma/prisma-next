import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyFailure, renderFailurePrompt } from '../judge/classify-failure.ts';
import type { JudgeModel } from '../judge/judge-model.ts';

function mockJudge(response: string): JudgeModel {
  return {
    async grade() {
      return response;
    },
  };
}

const INPUTS = {
  acceptanceMarkdown: '# Acceptance\n- AC-1: dedupe imports\n',
  diff: '--- a\n+++ b\n@@\n-old\n+new\n',
  traceExcerpts: 'dispatch-end result: completed',
};

describe('renderFailurePrompt', () => {
  it('lists the F1-F15 codes and the scope-trap / qa-coverage-gap buckets', () => {
    const prompt = renderFailurePrompt(INPUTS);
    assert.match(prompt, /F1\b/);
    assert.match(prompt, /F9\b/);
    assert.match(prompt, /scope-trap/);
    assert.match(prompt, /qa-coverage-gap/);
  });

  it('includes the diff and acceptance set', () => {
    const prompt = renderFailurePrompt(INPUTS);
    assert.ok(prompt.includes('AC-1'));
    assert.ok(prompt.includes('+new'));
  });
});

describe('classifyFailure', () => {
  it('parses a populated failure-mode list', async () => {
    const judge = mockJudge(
      '{"failureModes": ["F3", "scope-trap"], "reasons": ["used test suite for discovery", "leaked target scope"]}',
    );
    const verdict = await classifyFailure(INPUTS, judge);
    assert.deepEqual(verdict.failureModes, ['F3', 'scope-trap']);
    assert.equal(verdict.reasons.length, 2);
  });

  it('parses an empty failure-mode list (a clean run)', async () => {
    const judge = mockJudge('{"failureModes": [], "reasons": []}');
    const verdict = await classifyFailure(INPUTS, judge);
    assert.deepEqual(verdict.failureModes, []);
  });

  it('falls back safely to an empty list on malformed output', async () => {
    const judge = mockJudge('the run had some problems but I cannot say which');
    const verdict = await classifyFailure(INPUTS, judge);
    assert.deepEqual(verdict.failureModes, []);
    assert.match(verdict.reasons.join(' '), /malformed|parse/i);
  });

  it('falls back safely when an unknown failure-mode code is returned', async () => {
    const judge = mockJudge('{"failureModes": ["F99", "made-up"], "reasons": ["nope"]}');
    const verdict = await classifyFailure(INPUTS, judge);
    assert.deepEqual(verdict.failureModes, []);
    assert.match(verdict.reasons.join(' '), /malformed|parse/i);
  });
});
