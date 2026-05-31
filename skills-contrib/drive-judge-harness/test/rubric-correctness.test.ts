import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JudgeModel } from '../judge/judge-model.ts';
import { gradeRubric, renderRubricPrompt } from '../judge/rubric-correctness.ts';

const ACCEPTANCE =
  '# Acceptance\n\n- AC-1: imports deduped per module\n- AC-2: aliases preserved\n';
const DIFF =
  '--- a/foo.ts\n+++ b/foo.ts\n@@ -1,2 +1,1 @@\n-import type { A } from "x";\n-import type { B } from "x";\n+import type { A, B } from "x";\n';

function mockJudge(response: string): JudgeModel {
  return {
    async grade() {
      return response;
    },
  };
}

describe('renderRubricPrompt', () => {
  it('embeds the acceptance set and the diff', () => {
    const prompt = renderRubricPrompt({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF });
    assert.ok(prompt.includes('AC-1'));
    assert.ok(prompt.includes('+import type { A, B }'));
  });

  it('embeds optional trace excerpts when provided', () => {
    const prompt = renderRubricPrompt({
      acceptanceMarkdown: ACCEPTANCE,
      diff: DIFF,
      traceExcerpts: 'round-end verdict: satisfied',
    });
    assert.ok(prompt.includes('round-end verdict: satisfied'));
  });

  it('asks the model for a JSON verdict with intent and reasons', () => {
    const prompt = renderRubricPrompt({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF });
    assert.match(prompt, /intent/i);
    assert.match(prompt, /reasons/i);
    assert.match(prompt, /JSON/i);
  });
});

describe('gradeRubric', () => {
  it('parses a structured pass verdict', async () => {
    const judge = mockJudge('{"intent": "pass", "reasons": ["all ACs met", "imports merged"]}');
    const verdict = await gradeRubric({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF }, judge);
    assert.equal(verdict.intent, 'pass');
    assert.deepEqual(verdict.reasons, ['all ACs met', 'imports merged']);
  });

  it('parses a structured fail verdict', async () => {
    const judge = mockJudge('{"intent": "fail", "reasons": ["AC-2 violated: alias dropped"]}');
    const verdict = await gradeRubric({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF }, judge);
    assert.equal(verdict.intent, 'fail');
    assert.deepEqual(verdict.reasons, ['AC-2 violated: alias dropped']);
  });

  it('extracts the verdict from a fenced ```json block', async () => {
    const judge = mockJudge(
      'My analysis:\n\n```json\n{"intent": "pass", "reasons": ["fine"]}\n```\n',
    );
    const verdict = await gradeRubric({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF }, judge);
    assert.equal(verdict.intent, 'pass');
  });

  it('returns intent:null on a malformed model response — never a false pass', async () => {
    const judge = mockJudge('this is not JSON at all, just prose');
    const verdict = await gradeRubric({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF }, judge);
    assert.equal(verdict.intent, null);
    assert.ok(verdict.reasons.length > 0);
    assert.match(verdict.reasons.join(' '), /malformed|parse/i);
  });

  it('returns intent:null when the JSON shape is wrong', async () => {
    const judge = mockJudge('{"verdict": "yes"}');
    const verdict = await gradeRubric({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF }, judge);
    assert.equal(verdict.intent, null);
  });

  it('returns intent:null when intent is a non-enum value', async () => {
    const judge = mockJudge('{"intent": "maybe", "reasons": []}');
    const verdict = await gradeRubric({ acceptanceMarkdown: ACCEPTANCE, diff: DIFF }, judge);
    assert.equal(verdict.intent, null);
  });
});
