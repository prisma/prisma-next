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

export function checkInvariants(events: TraceEvent[]): AssertionResult[] {
  return [
    checkI1(events),
    checkI2(),
    checkI3(),
    checkI4(events),
    checkI5(),
    checkI6(events),
    checkI7(),
    checkI8(events),
    checkI9(),
    checkI10(events),
    checkI11(),
    checkI12(events),
  ];
}

// I1: A slice or direct change delivers exactly one PR.
function checkI1(events: TraceEvent[]): AssertionResult {
  const sliceCompleted = eventsOfType(events, 'slice-completed');
  const bySlug = new Map<string, typeof sliceCompleted>();
  for (const e of sliceCompleted) {
    const list = bySlug.get(e.slice_slug) ?? [];
    list.push(e);
    bySlug.set(e.slice_slug, list);
  }

  const duplicates: TraceRef[] = [];
  let duplicatedSlugCount = 0;
  for (const [slug, slugEvents] of bySlug) {
    if (slugEvents.length > 1) {
      duplicatedSlugCount += 1;
      for (const e of slugEvents) {
        duplicates.push(ref(e, `duplicate slice-completed for slug "${slug}"`));
      }
    }
  }

  if (duplicates.length > 0) {
    return {
      id: 'I1',
      title: 'A slice or direct change delivers exactly one PR.',
      status: 'fail',
      evidence: duplicates,
      note: `${duplicatedSlugCount} slice(s) have more than one slice-completed event`,
    };
  }

  return {
    id: 'I1',
    title: 'A slice or direct change delivers exactly one PR.',
    status: 'pass',
    evidence: sliceCompleted.map((e) => ref(e)),
    note: '',
  };
}

// I2: A project's scope is bounded by its project spec at all times.
function checkI2(): AssertionResult {
  return {
    id: 'I2',
    title: "A project's scope is bounded by its project spec at all times.",
    status: 'not-checkable',
    evidence: [],
    note: 'No trace event records scope expansion or contraction relative to the project spec.',
  };
}

// I3: Every spec and plan has exactly one scope-type (project or slice), immutable after creation.
function checkI3(): AssertionResult {
  return {
    id: 'I3',
    title:
      'Every spec and plan has exactly one scope-type (project or slice), immutable after creation.',
    status: 'not-checkable',
    evidence: [],
    note: 'spec_kind is recorded at authoring time but no event signals a retroactive scope-type change.',
  };
}

// I4: A project has at least one slice or direct change.
function checkI4(events: TraceEvent[]): AssertionResult {
  const projectStarted = eventsOfType(events, 'project-started');
  if (projectStarted.length === 0) {
    return {
      id: 'I4',
      title: 'A project has at least one slice or direct change.',
      status: 'pass',
      evidence: [],
      note: 'No project-started events; invariant does not apply.',
    };
  }

  const sliceStarted = eventsOfType(events, 'slice-started');
  const triageVerdicts = eventsOfType(events, 'triage-verdict');

  const failing: TraceRef[] = [];
  const passing: TraceRef[] = [];
  const runIds = new Set(projectStarted.map((e) => e.project_run_id));

  for (const runId of runIds) {
    const projEvent = projectStarted.find((e) => e.project_run_id === runId);
    if (projEvent === undefined) continue;

    const hasSlice = sliceStarted.some((e) => e.project_run_id === runId);
    const hasDirectChange = triageVerdicts.some(
      (e) => e.project_run_id === runId && e.verdict === 'direct-change',
    );

    if (!hasSlice && !hasDirectChange) {
      failing.push(
        ref(projEvent, `project run "${runId}" has no slice-started or direct-change verdict`),
      );
    } else {
      passing.push(ref(projEvent));
    }
  }

  if (failing.length > 0) {
    return {
      id: 'I4',
      title: 'A project has at least one slice or direct change.',
      status: 'fail',
      evidence: failing,
      note: `${failing.length} project(s) have no recorded slice or direct change`,
    };
  }

  return {
    id: 'I4',
    title: 'A project has at least one slice or direct change.',
    status: 'pass',
    evidence: passing,
    note: '',
  };
}

// I5: A slice or direct change may or may not have a parent project (orphan units are allowed).
function checkI5(): AssertionResult {
  return {
    id: 'I5',
    title:
      'A slice or direct change may or may not have a parent project (orphan units are allowed).',
    status: 'not-checkable',
    evidence: [],
    note: 'Whether a slice or direct change is orphan cannot be inferred from project_run_id alone.',
  };
}

// I6: A slice's spec and plan exist before implementation begins; a direct change has no spec/plan.
function checkI6(events: TraceEvent[]): AssertionResult {
  const dispatchStarts = eventsOfType(events, 'dispatch-start');
  if (dispatchStarts.length === 0) {
    return {
      id: 'I6',
      title:
        "A slice's spec and plan exist before implementation begins; a direct change has no spec/plan.",
      status: 'pass',
      evidence: [],
      note: 'No dispatch-start events.',
    };
  }

  const specAuthored = eventsOfType(events, 'spec-authored');
  const planAuthored = eventsOfType(events, 'plan-authored');
  const failing: TraceRef[] = [];
  const passing: TraceRef[] = [];

  for (const ds of dispatchStarts) {
    // Direct-change runs (project_run_id starts with "direct-") legitimately have no spec/plan.
    if (ds.project_run_id.startsWith('direct-')) {
      passing.push(ref(ds, 'direct-change run — no spec/plan required'));
      continue;
    }

    const hasSpec = specAuthored.some(
      (e) => e.project_run_id === ds.project_run_id && e.ts < ds.ts,
    );
    const hasPlan = planAuthored.some(
      (e) => e.project_run_id === ds.project_run_id && e.ts < ds.ts,
    );

    if (!hasSpec || !hasPlan) {
      const reason =
        !hasSpec && !hasPlan
          ? 'no preceding spec-authored or plan-authored'
          : !hasSpec
            ? 'no preceding spec-authored'
            : 'no preceding plan-authored';
      failing.push(ref(ds, reason));
    } else {
      passing.push(ref(ds));
    }
  }

  if (failing.length > 0) {
    return {
      id: 'I6',
      title:
        "A slice's spec and plan exist before implementation begins; a direct change has no spec/plan.",
      status: 'fail',
      evidence: failing,
      note: `${failing.length} dispatch(es) started without a preceding spec and/or plan`,
    };
  }

  return {
    id: 'I6',
    title:
      "A slice's spec and plan exist before implementation begins; a direct change has no spec/plan.",
    status: 'pass',
    evidence: passing,
    note: '',
  };
}

// I7: A project's purpose statement is immutable after the first slice or direct change starts.
function checkI7(): AssertionResult {
  return {
    id: 'I7',
    title:
      "A project's purpose statement is immutable after the first slice or direct change starts.",
    status: 'not-checkable',
    evidence: [],
    note: "No trace event records changes to a project's purpose statement; immutability cannot be verified.",
  };
}

// I8: Every dispatch has a DoD in its brief AND a DoR satisfied before it starts.
// Proxy: every dispatch-start has a matching brief-issued (the brief carries the DoD).
function checkI8(events: TraceEvent[]): AssertionResult {
  const dispatchStarts = eventsOfType(events, 'dispatch-start');
  if (dispatchStarts.length === 0) {
    return {
      id: 'I8',
      title: 'Every dispatch has a DoD in its brief AND a DoR satisfied before it starts.',
      status: 'pass',
      evidence: [],
      note: 'No dispatch-start events.',
    };
  }

  const briefIssueds = eventsOfType(events, 'brief-issued');
  const earliestBriefTsByKey = new Map<string, string>();
  for (const b of briefIssueds) {
    const key = `${b.project_run_id}::${b.dispatch_id}`;
    const prev = earliestBriefTsByKey.get(key);
    if (prev === undefined || b.ts < prev) {
      earliestBriefTsByKey.set(key, b.ts);
    }
  }

  const orphans: TraceRef[] = [];
  const matched: TraceRef[] = [];

  for (const ds of dispatchStarts) {
    const key = `${ds.project_run_id}::${ds.dispatch_id}`;
    const briefTs = earliestBriefTsByKey.get(key);
    if (briefTs !== undefined && briefTs <= ds.ts) {
      matched.push(ref(ds));
    } else {
      const note =
        briefTs === undefined
          ? `no matching brief-issued for dispatch_id "${ds.dispatch_id}" in run "${ds.project_run_id}"`
          : `brief-issued for dispatch_id "${ds.dispatch_id}" occurs after dispatch-start`;
      orphans.push(ref(ds, note));
    }
  }

  if (orphans.length > 0) {
    return {
      id: 'I8',
      title: 'Every dispatch has a DoD in its brief AND a DoR satisfied before it starts.',
      status: 'fail',
      evidence: orphans,
      note: `${orphans.length} dispatch(es) have no matching brief-issued event`,
    };
  }

  return {
    id: 'I8',
    title: 'Every dispatch has a DoD in its brief AND a DoR satisfied before it starts.',
    status: 'pass',
    evidence: matched,
    note: '',
  };
}

// I9: Every slice has a DoD declared in its slice spec or inherited from its parent project.
function checkI9(): AssertionResult {
  return {
    id: 'I9',
    title: 'Every slice has a DoD declared in its slice spec or inherited from its parent project.',
    status: 'not-checkable',
    evidence: [],
    note: 'Cannot distinguish a slice spec with zero dod_items from one legitimately inheriting project DoD.',
  };
}

// I10: Every project has a DoD declared in its project spec.
function checkI10(events: TraceEvent[]): AssertionResult {
  const projectSpecs = eventsOfType(events, 'spec-authored').filter(
    (e) => e.spec_kind === 'project',
  );
  const projectSpecAmended = eventsOfType(events, 'spec-amended').filter(
    (e) => e.spec_kind === 'project',
  );

  if (projectSpecs.length === 0 && projectSpecAmended.length === 0) {
    return {
      id: 'I10',
      title: 'Every project has a DoD declared in its project spec.',
      status: 'pass',
      evidence: [],
      note: 'No project spec-authored or spec-amended events; invariant does not apply.',
    };
  }

  const failing: TraceRef[] = [];
  const passing: TraceRef[] = [];

  for (const e of projectSpecs) {
    if (e.dod_items_count === 0) {
      failing.push(ref(e, `project spec at "${e.spec_path}" has dod_items_count = 0`));
    } else {
      passing.push(ref(e));
    }
  }

  for (const e of projectSpecAmended) {
    if (e.dod_items_count === 0) {
      failing.push(ref(e, `project spec at "${e.spec_path}" amended to dod_items_count = 0`));
    }
  }

  if (failing.length > 0) {
    return {
      id: 'I10',
      title: 'Every project has a DoD declared in its project spec.',
      status: 'fail',
      evidence: failing,
      note: `${failing.length} project spec event(s) have dod_items_count = 0`,
    };
  }

  return {
    id: 'I10',
    title: 'Every project has a DoD declared in its project spec.',
    status: 'pass',
    evidence: passing,
    note: '',
  };
}

// I11: Sizing applies at two altitudes by logical coherence (INVEST), not by logistical footprint.
function checkI11(): AssertionResult {
  return {
    id: 'I11',
    title:
      'Sizing applies at two altitudes by logical coherence (INVEST), not by logistical footprint.',
    status: 'not-checkable',
    evidence: [],
    note: 'Sizing by INVEST is a human/agent judgment call; no trace event captures whether a unit passed INVEST.',
  };
}

// I12: Spec or plan amendments after the first dispatch starts are operator-driven or design-discussion
// output; silent agent-side amendments are forbidden.
// Not-checkable for silent amendments; falsified-assumption events are positive evidence the halt fired.
function checkI12(events: TraceEvent[]): AssertionResult {
  const falsified = eventsOfType(events, 'falsified-assumption');
  return {
    id: 'I12',
    title:
      'Spec or plan amendments after the first dispatch starts are operator-driven or design-discussion output; silent agent-side amendments are forbidden.',
    status: 'not-checkable',
    evidence: falsified.map((e) => ref(e, 'halt-and-discuss path fired')),
    note: 'Can confirm the halt-and-discuss path fired via falsified-assumption events, but cannot detect silent amendments.',
  };
}
