import { type } from 'arktype';
import type { JudgeModel } from './judge-model.ts';
import { parseJsonFromModel } from './parse-json.ts';

// Operator-turn classifier. For a single operator-emitted turn (typically a
// reply that mid-flight nudges the orchestrator), pick the canonical bucket
// from the Drive measurement model (`docs/drive/measurement-model.md`):
//   - legitimate-design        : a design-decision the orchestrator legitimately
//                                escalated (intent-bearing scope/architecture call)
//   - legitimate-authorisation : an authorization the operator must supply
//                                (destructive op approval, base-branch override)
//   - illegitimate-asked       : the orchestrator asked the operator something it
//                                should have decided/resolved itself
//   - illegitimate-correction  : the operator corrected work the orchestrator
//                                should have caught itself
//   - illegitimate-rescue      : the operator did the implementer's job
// A malformed model response (or an off-enum bucket) yields `bucket: null` —
// never silent, never an invented bucket.

export const OPERATOR_TURN_BUCKETS = [
  'legitimate-design',
  'legitimate-authorisation',
  'illegitimate-asked',
  'illegitimate-correction',
  'illegitimate-rescue',
] as const;

export type OperatorTurnBucket = (typeof OPERATOR_TURN_BUCKETS)[number];

export type OperatorClassificationInputs = {
  operatorTurnText: string;
  surroundingTraceExcerpts?: string;
};

export type OperatorVerdict = {
  bucket: OperatorTurnBucket | null;
  reasons: string[];
};

const OperatorResponse = type({
  bucket:
    '"legitimate-design" | "legitimate-authorisation" | "illegitimate-asked" | "illegitimate-correction" | "illegitimate-rescue"',
  reasons: type('string').array(),
});

const PROMPT_HEADER =
  'You classify a single operator turn in a Drive orchestrator run. Pick exactly one of these ' +
  'five buckets:\n' +
  '  - legitimate-design        : a design-decision the orchestrator legitimately escalated ' +
  '(intent-bearing scope decision, architectural call, requirement clarification).\n' +
  '  - legitimate-authorisation : an authorization gate the operator must hold (destructive ' +
  'operation approval, force-push, non-default base branch, supply-chain admission).\n' +
  '  - illegitimate-asked       : the orchestrator asked the operator for a decision or ' +
  'permission it should have made or resolved itself (an avoidable question / check-in).\n' +
  '  - illegitimate-correction  : the operator corrected a mistake the orchestrator should have ' +
  'caught itself (a misread spec, a missed grep, a wrong-altitude surface).\n' +
  '  - illegitimate-rescue      : the operator authored or debugged work the implementer should ' +
  'have produced (wrote the code, found the bug, hand-fixed a failing test).\n\n' +
  'Respond with one JSON object (bare or ```json-fenced):\n' +
  '  { "bucket": "<one-of-the-five>", "reasons": [string, ...] }\n' +
  'Never invent a bucket outside the five.';

export function renderOperatorPrompt(inputs: OperatorClassificationInputs): string {
  const surrounding =
    inputs.surroundingTraceExcerpts !== undefined && inputs.surroundingTraceExcerpts.length > 0
      ? `\n\n--- SURROUNDING TRACE ---\n${inputs.surroundingTraceExcerpts}`
      : '';
  return `${PROMPT_HEADER}\n\n--- OPERATOR TURN ---\n${inputs.operatorTurnText}${surrounding}`;
}

export async function classifyOperator(
  inputs: OperatorClassificationInputs,
  model: JudgeModel,
): Promise<OperatorVerdict> {
  const raw = await model.grade(renderOperatorPrompt(inputs));
  const parsed = parseJsonFromModel(raw);
  if (parsed === undefined) {
    return { bucket: null, reasons: ['malformed model output: no parseable JSON object'] };
  }
  const validated = OperatorResponse(parsed);
  if (validated instanceof type.errors) {
    return { bucket: null, reasons: [`malformed model output: ${validated.summary}`] };
  }
  return { bucket: validated.bucket, reasons: [...validated.reasons] };
}
