import { type } from 'arktype';
import type { JudgeModel } from './judge-model.ts';
import { parseJsonFromModel } from './parse-json.ts';

// Failure-mode classifier. Catalogues the run's failure modes against the
// repo's tracked taxonomy: the F1–F15 dispatch-execution failure modes (see
// `drive/calibration/failure-modes.md`), slice-shape scope traps, and QA
// coverage-gate gaps. The classifier feeds the auto-retro surface, NOT the
// scorecard — its verdict is diagnostic, not gating. A malformed model
// response yields an empty list (never silently invents a failure mode).

export const FAILURE_MODE_CODES = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'F13',
  'F14',
  'F15',
  'scope-trap',
  'qa-coverage-gap',
] as const;

export type FailureModeCode = (typeof FAILURE_MODE_CODES)[number];

export type FailureClassificationInputs = {
  acceptanceMarkdown: string;
  diff: string;
  traceExcerpts?: string;
};

export type FailureVerdict = {
  failureModes: FailureModeCode[];
  reasons: string[];
};

const FailureResponse = type({
  failureModes: type.enumerated(...FAILURE_MODE_CODES).array(),
  reasons: type('string').array(),
});

const PROMPT_HEADER =
  'You classify the failure modes of a Drive orchestrator run. Read the acceptance set, the ' +
  'produced diff, and any trace excerpts. Identify every failure mode that fired, drawn from ' +
  'this fixed taxonomy:\n' +
  '  - F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15 : ' +
  'dispatch-execution failure modes (e.g. F3 = discovery via test suite instead of grep; ' +
  'F4 = feature-sized dispatch with no inspection cadence; F11 = spec-pinned module ' +
  'placement not enforced). See drive/calibration/failure-modes.md for the full catalogue.\n' +
  '  - scope-trap: a slice-shape scope-creep pattern (e.g. "fix on postgres" silently leaking ' +
  'to all targets, blanket package.json constraints conflating runtime vs dev).\n' +
  "  - qa-coverage-gap: a behaviour CI doesn't cover that manual QA must catch (error " +
  'envelope copy, --help legibility, multi-command journey, generated .d.ts shape).\n\n' +
  'Respond with a single JSON object (bare or ```json-fenced):\n' +
  '  { "failureModes": [<code>, ...], "reasons": [string, ...] }\n' +
  'Use an empty array when the run is clean. Never invent a code outside the taxonomy.';

export function renderFailurePrompt(inputs: FailureClassificationInputs): string {
  const trace =
    inputs.traceExcerpts !== undefined && inputs.traceExcerpts.length > 0
      ? `\n\n--- TRACE EXCERPTS ---\n${inputs.traceExcerpts}`
      : '';
  return `${PROMPT_HEADER}\n\n--- ACCEPTANCE SET ---\n${inputs.acceptanceMarkdown}\n\n--- DIFF ---\n${inputs.diff}${trace}`;
}

export async function classifyFailure(
  inputs: FailureClassificationInputs,
  model: JudgeModel,
): Promise<FailureVerdict> {
  const raw = await model.grade(renderFailurePrompt(inputs));
  const parsed = parseJsonFromModel(raw);
  if (parsed === undefined) {
    return { failureModes: [], reasons: ['malformed model output: no parseable JSON object'] };
  }
  const validated = FailureResponse(parsed);
  if (validated instanceof type.errors) {
    return { failureModes: [], reasons: [`malformed model output: ${validated.summary}`] };
  }
  return { failureModes: [...validated.failureModes], reasons: [...validated.reasons] };
}
