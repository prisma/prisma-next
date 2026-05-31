import { type } from 'arktype';
import type { JudgeModel } from './judge-model.ts';
import { parseJsonFromModel } from './parse-json.ts';

// Correctness rubric: grade one Drive run's diff against a golden case's
// acceptance set. Requirements (acceptance criteria) are folded into the single
// `intent` component the `correctness-recorded` schema carries — mechanical and
// QA are gate-sourced and never touched here. A malformed model response yields
// `intent: null` (→ scorecard `not-computable`), never a silent `pass`.

export type RubricInputs = {
  /** The golden case's `acceptance.md` content — the correctness oracle. */
  acceptanceMarkdown: string;
  /** The run's produced diff (or a focused excerpt). */
  diff: string;
  /** Optional excerpts from the run's `trace.jsonl` (e.g. round-end
   *  verdicts, dispatch ends) that inform the design-quality read. */
  traceExcerpts?: string;
};

export type RubricVerdict = {
  intent: 'pass' | 'fail' | null;
  reasons: string[];
};

const RubricResponse = type({
  intent: '"pass" | "fail"',
  reasons: type('string').array(),
});

const PROMPT_HEADER =
  'You are a cross-family grader for a Drive orchestrator run. Read the acceptance set, ' +
  'the produced diff, and any trace excerpts, then judge whether the run satisfies the run-level ' +
  'intent: every acceptance criterion is met AND the design-quality signals named in the ' +
  '"Correctness oracle / Intent" section of the acceptance set hold. Mechanical correctness ' +
  '(`pnpm typecheck` / `test` / `lint`) and QA-run correctness are recorded by other gates — ' +
  'do not re-grade them here.\n\n' +
  'Respond with a single JSON object on its own line (or in a ```json fence). Shape:\n' +
  '  { "intent": "pass" | "fail", "reasons": [string, ...] }\n' +
  'Use "fail" if any acceptance criterion is missed or the design-quality signal is violated. ' +
  'List concrete reasons (one per array entry) citing the specific AC or oracle clause.';

export function renderRubricPrompt(inputs: RubricInputs): string {
  const trace =
    inputs.traceExcerpts !== undefined && inputs.traceExcerpts.length > 0
      ? `\n\n--- TRACE EXCERPTS ---\n${inputs.traceExcerpts}`
      : '';
  return `${PROMPT_HEADER}\n\n--- ACCEPTANCE SET ---\n${inputs.acceptanceMarkdown}\n\n--- DIFF ---\n${inputs.diff}${trace}`;
}

export async function gradeRubric(inputs: RubricInputs, model: JudgeModel): Promise<RubricVerdict> {
  const raw = await model.grade(renderRubricPrompt(inputs));
  const parsed = parseJsonFromModel(raw);
  if (parsed === undefined) {
    return { intent: null, reasons: ['malformed model output: no parseable JSON object'] };
  }
  const validated = RubricResponse(parsed);
  if (validated instanceof type.errors) {
    return { intent: null, reasons: [`malformed model output: ${validated.summary}`] };
  }
  return { intent: validated.intent, reasons: [...validated.reasons] };
}
