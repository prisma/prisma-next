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

export function checkCascadeRules(events: TraceEvent[]): AssertionResult[] {
  return [
    checkCascade1(),
    checkCascade2(),
    checkCascade3(events),
    checkCascade4(events),
    checkCascade5(),
    checkCascade6(),
    checkCascade7(),
    checkCascade8(),
  ];
}

// Cascade-1: Project, slice, and dispatch each get their own template.
// Not-checkable: template usage is an authoring-time property with no trace signal.
function checkCascade1(): AssertionResult {
  return {
    id: 'Cascade-1',
    title:
      'Project, slice, and dispatch each get their own template, sized to their limiting constraint.',
    status: 'not-checkable',
    evidence: [],
    note: 'Template usage is an authoring-time property; no trace event records which template was used at each level.',
  };
}

// Cascade-2: Content lives at the lowest level where it doesn't lose information.
// Not-checkable: content placement is an authoring judgment with no trace signal.
function checkCascade2(): AssertionResult {
  return {
    id: 'Cascade-2',
    title: 'Content lives at the lowest artifact level where it does not lose information.',
    status: 'not-checkable',
    evidence: [],
    note: 'Content placement across artifact levels is an authoring judgment; no trace event captures where content was placed.',
  };
}

// Cascade-3: Triage produces one of three delivery shapes: direct-change, slice, or project.
// Observable: triage-verdict.verdict is schema-validated; surface distribution as evidence.
// Not-checkable for "was it the right shape"; pass defensively if all verdicts are in the enum.
function checkCascade3(events: TraceEvent[]): AssertionResult {
  const triageVerdicts = eventsOfType(events, 'triage-verdict');
  if (triageVerdicts.length === 0) {
    return {
      id: 'Cascade-3',
      title: 'Triage produces one of three delivery shapes: direct-change, slice, or project.',
      status: 'pass',
      evidence: [],
      note: 'No triage-verdict events; rule does not apply.',
    };
  }

  const TRIAGE_SHAPES = new Set([
    'direct-change',
    'orphan-slice',
    'in-project-slice',
    'new-project',
  ]);
  const distribution: Record<string, number> = {};
  const evidence: TraceRef[] = [];

  for (const e of triageVerdicts) {
    distribution[e.verdict] = (distribution[e.verdict] ?? 0) + 1;
    const category = TRIAGE_SHAPES.has(e.verdict) ? 'triage-shape' : 'transition';
    evidence.push(ref(e, `verdict="${e.verdict}" (${category})`));
  }

  const distributionStr = Object.entries(distribution)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');

  return {
    id: 'Cascade-3',
    title: 'Triage produces one of three delivery shapes: direct-change, slice, or project.',
    status: 'pass',
    evidence,
    note: `${triageVerdicts.length} triage-verdict event(s); distribution: ${distributionStr}. Whether the right shape was chosen is not-checkable from trace signal alone.`,
  };
}

// Cascade-4: Discussion is signal-triggered, not mandatory.
// Partially observable: falsified-assumption events confirm the halt-and-discuss path fired.
// Not-checkable for cases where discussion was skipped when it should have fired.
function checkCascade4(events: TraceEvent[]): AssertionResult {
  const falsified = eventsOfType(events, 'falsified-assumption');
  return {
    id: 'Cascade-4',
    title: 'Discussion is signal-triggered, not mandatory.',
    status: 'not-checkable',
    evidence: falsified.map((e) => ref(e, 'halt-and-discuss path fired on signal')),
    note: 'Cannot detect when discussion should have been triggered but was skipped; falsified-assumption events are positive evidence the halt-and-discuss path fired.',
  };
}

// Cascade-5: The executor's standing instruction is "stay focused on the goal; control scope."
// Not-checkable: brief text content is not captured in the trace.
function checkCascade5(): AssertionResult {
  return {
    id: 'Cascade-5',
    title: 'The executor\'s standing instruction is "stay focused on the goal; control scope".',
    status: 'not-checkable',
    evidence: [],
    note: 'Brief text content is not captured in the trace; whether the standing instruction is present and verbatim is not-checkable.',
  };
}

// Cascade-6: The reviewer does not re-run validation commands during routine review.
// Not-checkable: no trace event records reviewer actions.
function checkCascade6(): AssertionResult {
  return {
    id: 'Cascade-6',
    title: 'The reviewer does not re-run validation commands during routine review.',
    status: 'not-checkable',
    evidence: [],
    note: 'No trace event records reviewer actions; whether validation commands were re-run cannot be verified.',
  };
}

// Cascade-7: The team-level DoD lives in project context (drive/calibration/dod.md), not in the skill.
// Not-checkable: skill body content is not captured in the trace.
function checkCascade7(): AssertionResult {
  return {
    id: 'Cascade-7',
    title:
      'The team-level Definition of Done lives in project context (drive/calibration/dod.md), not in the skill body.',
    status: 'not-checkable',
    evidence: [],
    note: 'Skill body content is not captured in the trace; where the team-level DoD is defined cannot be verified.',
  };
}

// Cascade-8: Internal project labels stay out of operator-facing communication.
// Not-checkable: PR body text, Linear ticket content, and commit messages are not in the trace.
function checkCascade8(): AssertionResult {
  return {
    id: 'Cascade-8',
    title: 'Internal project labels stay out of operator-facing communication.',
    status: 'not-checkable',
    evidence: [],
    note: 'PR body text, Linear ticket content, and commit message text are not captured in the trace.',
  };
}
