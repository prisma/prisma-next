import type { TraceEvent } from '../../drive-record-traces/schema.ts';
import type { AssertionResult, TraceRef } from './types.ts';

function eventsOfType<T extends TraceEvent['event_type']>(
  events: TraceEvent[],
  eventType: T,
): Extract<TraceEvent, { event_type: T }>[] {
  return events.filter(
    (e): e is Extract<TraceEvent, { event_type: T }> => e.event_type === eventType,
  );
}

function ref(e: { event_id: string; event_type: string }, note?: string): TraceRef {
  return note !== undefined
    ? { event_id: e.event_id, event_type: e.event_type, note }
    : { event_id: e.event_id, event_type: e.event_type };
}

// Shared rationale for checks that need brief content sections not emitted by the trace.
const CONTENT_NOT_IN_TRACE =
  'The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted.';

export function checkBriefDiscipline(events: TraceEvent[]): AssertionResult[] {
  return [
    checkBD1(),
    checkBD2(),
    checkBD3(),
    checkBD4(),
    checkBD5(),
    checkBD6(),
    checkBD7(),
    checkBD8(events),
    checkBD9(events),
    checkBD10(),
    checkBD11(),
  ];
}

// BD-1: "Do what's needed" briefs — no Task, no Scope, no Completed when.
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD1(): AssertionResult {
  return {
    id: 'BD-1',
    title: '"Do what\'s needed" briefs — no Task, no Scope, no Completed when.',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-2: Brief omits "Completed when" section.
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD2(): AssertionResult {
  return {
    id: 'BD-2',
    title: 'Brief omits "Completed when" section.',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-3: Brief omits "Out of scope" list.
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD3(): AssertionResult {
  return {
    id: 'BD-3',
    title: 'Brief omits "Out of scope" list.',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-4: Brief pre-decomposes every file the executor will touch.
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD4(): AssertionResult {
  return {
    id: 'BD-4',
    title: 'Brief pre-decomposes every file the executor will touch.',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-5: Brief pre-walks every edge case "to be safe".
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD5(): AssertionResult {
  return {
    id: 'BD-5',
    title: 'Brief pre-walks every edge case "to be safe".',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-6: Brief has wishlist "Completed when" entries (not verifiable, not binary).
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD6(): AssertionResult {
  return {
    id: 'BD-6',
    title: 'Brief has wishlist "Completed when" entries (not verifiable, not binary).',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-7: Brief omits model tier in "Operational metadata".
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD7(): AssertionResult {
  return {
    id: 'BD-7',
    title: 'Brief omits model tier ("Operational metadata" section absent or unpopulated).',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-8: Brief restates the slice spec (over-long brief).
// Heuristic: compare brief_byte_length to the minimum spec byte_length for the same
// project_run_id. If brief >= spec, flag as heuristic fail.
// Not-checkable if no spec-authored events are present for comparison.
function checkBD8(events: TraceEvent[]): AssertionResult {
  const briefIssueds = eventsOfType(events, 'brief-issued');
  if (briefIssueds.length === 0) {
    return {
      id: 'BD-8',
      title: 'Brief restates the slice spec (over-long brief).',
      status: 'not-checkable',
      evidence: [],
      note: 'No brief-issued events; check does not apply.',
    };
  }

  const specAuthored = eventsOfType(events, 'spec-authored').filter((e) => e.spec_kind === 'slice');
  const minSpecByteLength = new Map<string, number>();
  for (const e of specAuthored) {
    const current = minSpecByteLength.get(e.project_run_id);
    if (current === undefined || e.byte_length < current) {
      minSpecByteLength.set(e.project_run_id, e.byte_length);
    }
  }

  const failing: TraceRef[] = [];
  const passing: TraceRef[] = [];
  let uncheckedCount = 0;

  for (const b of briefIssueds) {
    const minSpec = minSpecByteLength.get(b.project_run_id);
    if (minSpec === undefined) {
      uncheckedCount += 1;
      continue;
    }
    if (b.brief_byte_length >= minSpec) {
      failing.push(
        ref(
          b,
          `heuristic: brief_byte_length ${b.brief_byte_length} >= spec byte_length ${minSpec}`,
        ),
      );
    } else {
      passing.push(ref(b, `${b.brief_byte_length} bytes < spec ${minSpec} bytes`));
    }
  }

  if (failing.length > 0) {
    return {
      id: 'BD-8',
      title: 'Brief restates the slice spec (over-long brief).',
      status: 'fail',
      evidence: failing,
      note: `heuristic: ${failing.length} brief(s) have brief_byte_length >= their slice spec's byte_length; may be restating the spec.`,
    };
  }

  if (passing.length === 0) {
    return {
      id: 'BD-8',
      title: 'Brief restates the slice spec (over-long brief).',
      status: 'not-checkable',
      evidence: [],
      note: 'Briefs present but no spec-authored events found for any matching project_run_id; cannot compare.',
    };
  }

  const uncheckedSuffix =
    uncheckedCount > 0 ? ` ${uncheckedCount} brief(s) had no matching spec.` : '';
  return {
    id: 'BD-8',
    title: 'Brief restates the slice spec (over-long brief).',
    status: 'pass',
    evidence: passing,
    note: `heuristic: all ${passing.length} checked brief(s) have brief_byte_length < their spec.${uncheckedSuffix}`,
  };
}

// BD-9: Executor silently rewrites the brief (orchestrator owns the brief).
// Partially observable: brief_disposition === "amended" is positive evidence the rewrite was
// surfaced, not silent. Silent rewrites are not-checkable.
function checkBD9(events: TraceEvent[]): AssertionResult {
  const briefIssueds = eventsOfType(events, 'brief-issued');
  const amended = briefIssueds.filter((e) => e.brief_disposition === 'amended');

  return {
    id: 'BD-9',
    title: 'Executor silently rewrites the brief (orchestrator owns the brief).',
    status: 'not-checkable',
    evidence: amended.map((e) => ref(e, 'amended disposition — rewrite was surfaced, not silent')),
    note: 'Silent brief rewrites cannot be detected from the trace; amended dispositions confirm surfaced rewrites (positive evidence).',
  };
}

// BD-10: Standing instruction rephrased as "minimize changes" (trains timidity).
// Not-checkable: brief content sections are not emitted in the trace.
function checkBD10(): AssertionResult {
  return {
    id: 'BD-10',
    title: 'Standing instruction rephrased as "minimize changes" (trains executor timidity).',
    status: 'not-checkable',
    evidence: [],
    note: CONTENT_NOT_IN_TRACE,
  };
}

// BD-11: Brief composed by a subagent (inflates context, inverts cost model).
// Not-checkable: who authored the brief is not recorded in the trace.
function checkBD11(): AssertionResult {
  return {
    id: 'BD-11',
    title: 'Brief composed by a subagent (inflates context, inverts cost model).',
    status: 'not-checkable',
    evidence: [],
    note: 'Who authored the brief is not recorded in the trace.',
  };
}
