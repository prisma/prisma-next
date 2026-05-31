import { type EmitResult, emitEvent } from '../../drive-record-traces/emit.ts';
import type { TraceEvent } from '../../drive-record-traces/schema.ts';

// Merge-preserving emission of the rubric's `intent` verdict.
//
// The scorecard is **last-write-wins per `project_run_id` on the whole
// `{mechanical, qa, intent}` triple** — a `correctness-recorded` event replaces
// the triple, it does not merge components. So the judge cannot emit
// `{mechanical:null, qa:null, intent:<verdict>}` without clobbering any
// `mechanical` / `qa` already recorded by the validation gates / QA run.
//
// This helper:
//   1. reads the run's latest `correctness-recorded` event from the events the
//      caller passes (typically the run's current `trace.jsonl` parsed in);
//   2. forms a merged payload that preserves the prior `mechanical` and `qa`
//      and fills `intent` with the judge's verdict;
//   3. emits the merged triple through the deterministic emitter.
//
// `intent` is forwarded verbatim — a `null` from the rubric (malformed model
// output) emits as `null`, never silently re-classified as `pass`.

export type IntentVerdict = 'pass' | 'fail' | null;

export type MergedCorrectness = {
  mechanical: 'pass' | 'fail' | null;
  qa: 'pass' | 'fail' | null;
  intent: 'pass' | 'fail' | null;
};

function latestCorrectness(
  events: TraceEvent[],
  projectRunId: string,
): MergedCorrectness | undefined {
  let latest: MergedCorrectness | undefined;
  for (const e of events) {
    if (e.event_type !== 'correctness-recorded') continue;
    if (e.project_run_id !== projectRunId) continue;
    latest = { mechanical: e.mechanical, qa: e.qa, intent: e.intent };
  }
  return latest;
}

/** Compute the merged correctness payload — preserves the prior `mechanical`
 *  and `qa` and fills `intent` with the judge's verdict. Pure. */
export function mergedCorrectnessPayload(
  events: TraceEvent[],
  projectRunId: string,
  intent: IntentVerdict,
): MergedCorrectness {
  const prior = latestCorrectness(events, projectRunId);
  return {
    mechanical: prior?.mechanical ?? null,
    qa: prior?.qa ?? null,
    intent,
  };
}

export type EmitMergedCorrectnessInput = {
  traceFile: string;
  projectRunId: string;
  /** The run's current trace events — read for the prior `{mechanical, qa}`. */
  events: TraceEvent[];
  /** The judge's `intent` verdict. `null` forwards as `null`. */
  intent: IntentVerdict;
  orchestratorAgentId?: string | null;
};

/** Compute the merged payload and append one `correctness-recorded` line to
 *  the trace file via the deterministic emitter. */
export function emitMergedCorrectness(input: EmitMergedCorrectnessInput): EmitResult {
  const payload = mergedCorrectnessPayload(input.events, input.projectRunId, input.intent);
  return emitEvent({
    traceFile: input.traceFile,
    projectRunId: input.projectRunId,
    event: 'correctness-recorded',
    payload,
    orchestratorAgentId: input.orchestratorAgentId,
  });
}
