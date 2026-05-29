import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkInvariants } from '../assertions/invariants.ts';
import { loadTrace } from '../load.ts';
import type { TraceEvent } from '../schema.ts';

const TRACE_PATH = fileURLToPath(new URL('./fixtures/sample-trace.jsonl', import.meta.url));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ENV = {
  event_id: 'aabbccdd-1234-4567-8901-abcdef000000',
  schema_version: '1' as const,
  ts: '2026-01-01T00:00:00.000Z',
  project_run_id: 'test-run',
  orchestrator_agent_id: null,
};

let _eid = 0;
function uid(): string {
  return `aaaaaaaa-0000-4000-8000-${String(_eid++).padStart(12, '0')}`;
}

function mkSliceCompleted(
  slice_slug: string,
  ts = ENV.ts,
  project_run_id = ENV.project_run_id,
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    ts,
    project_run_id,
    event_type: 'slice-completed' as const,
    slice_slug,
    result: 'merged' as const,
    pr_ref: null,
  };
}

function mkDispatchStart(
  dispatch_id: string,
  project_run_id = ENV.project_run_id,
  ts = ENV.ts,
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    ts,
    project_run_id,
    event_type: 'dispatch-start' as const,
    dispatch_id,
    dispatch_name: 'test dispatch',
    subagent_type: 'generalPurpose',
    model: null,
    parent_dispatch_id: null,
  };
}

function mkBriefIssued(
  dispatch_id: string,
  project_run_id = ENV.project_run_id,
  ts = ENV.ts,
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    ts,
    project_run_id,
    event_type: 'brief-issued' as const,
    dispatch_id,
    round_id: uid(),
    brief_byte_length: 1000,
    brief_content_hash: 'abc123',
    brief_disposition: 'initial' as const,
  };
}

function mkSpecAuthored(
  spec_path: string,
  spec_kind: 'project' | 'slice' = 'slice',
  dod_items_count = 5,
  ts = ENV.ts,
  project_run_id = ENV.project_run_id,
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    ts,
    project_run_id,
    event_type: 'spec-authored' as const,
    spec_path,
    spec_kind,
    byte_length: 5000,
    edge_cases_count: 3,
    open_questions_count: 2,
    dod_items_count,
  };
}

function mkSpecAmended(
  spec_path: string,
  spec_kind: 'project' | 'slice' = 'project',
  dod_items_count = 5,
  project_run_id = ENV.project_run_id,
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    project_run_id,
    event_type: 'spec-amended' as const,
    spec_path,
    spec_kind,
    byte_length: 4000,
    bytes_delta: -1000,
    edge_cases_count: 3,
    open_questions_count: 1,
    dod_items_count,
    reason: 'operator-correction' as const,
    sections_changed: [],
  };
}

function mkPlanAuthored(
  plan_path: string,
  ts = ENV.ts,
  project_run_id = ENV.project_run_id,
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    ts,
    project_run_id,
    event_type: 'plan-authored' as const,
    plan_path,
    plan_kind: 'slice' as const,
    byte_length: 3000,
    dispatch_count: 3,
    slice_count: null,
    dispatch_size_distribution: null,
    open_items_count: 0,
  };
}

function mkProjectStarted(project_run_id: string): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    project_run_id,
    event_type: 'project-started' as const,
    project_slug: project_run_id,
    origin: 'new-project' as const,
    has_linear_project: false,
  };
}

function mkSliceStarted(slice_slug: string, project_run_id = ENV.project_run_id): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    project_run_id,
    event_type: 'slice-started' as const,
    slice_slug,
    slice_index: 1,
    linear_ref: null,
  };
}

function mkFalsifiedAssumption(project_run_id = ENV.project_run_id): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    project_run_id,
    event_type: 'falsified-assumption' as const,
    artifact_path: 'spec.md',
    triggered_by: 'implementer-pushback' as const,
    assumption_summary: null,
  };
}

// ---------------------------------------------------------------------------
// I1 — a slice or direct change delivers exactly one PR
// ---------------------------------------------------------------------------

describe('I1 — pass: empty trace', () => {
  const results = checkInvariants([]);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence is empty', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });
});

describe('I1 — pass: unique slice slugs', () => {
  const events: TraceEvent[] = [mkSliceCompleted('slice-a'), mkSliceCompleted('slice-b')];
  const results = checkInvariants(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence contains both slice-completed events', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 2);
  });
});

describe('I1 — fail: same slug completed twice', () => {
  const events: TraceEvent[] = [
    mkSliceCompleted('slice-a', '2026-01-01T00:00:00.000Z'),
    mkSliceCompleted('slice-b', '2026-01-01T00:01:00.000Z'),
    mkSliceCompleted('slice-a', '2026-01-01T00:02:00.000Z'),
  ];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence contains the two duplicate slice-a events', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 2);
    assert.ok(r.evidence.every((ref) => ref.event_type === 'slice-completed'));
  });

  it('evidence notes reference the duplicate slug', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('slice-a'));
  });

  it('note reports 1 duplicated slug', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.ok(r.note.startsWith('1 slice(s)'));
  });
});

describe('I1 — fail: same slug completed three times counts as one duplicated slug', () => {
  const events: TraceEvent[] = [
    mkSliceCompleted('slice-a', '2026-01-01T00:00:00.000Z'),
    mkSliceCompleted('slice-a', '2026-01-01T00:01:00.000Z'),
    mkSliceCompleted('slice-a', '2026-01-01T00:02:00.000Z'),
  ];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence contains all three events', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 3);
  });

  it('note correctly reports 1 duplicated slug (not 1 from Math.floor(3/2))', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.ok(r.note.startsWith('1 slice(s)'));
  });
});

// ---------------------------------------------------------------------------
// I2, I3, I5, I7, I9, I11 — always not-checkable
// ---------------------------------------------------------------------------

for (const id of ['I2', 'I3', 'I5', 'I7', 'I9', 'I11'] as const) {
  describe(`${id} — always not-checkable`, () => {
    const results = checkInvariants([]);

    it('status is not-checkable', () => {
      const r = results.find((x) => x.id === id);
      assert.ok(r !== undefined, `no result for ${id}`);
      assert.equal(r.status, 'not-checkable');
    });

    it('note is a non-empty rationale', () => {
      const r = results.find((x) => x.id === id);
      assert.ok(r !== undefined);
      assert.ok(r.note.length > 0, `${id} not-checkable note must be non-empty`);
    });

    it('evidence is empty', () => {
      const r = results.find((x) => x.id === id);
      assert.ok(r !== undefined);
      assert.equal(r.evidence.length, 0);
    });
  });
}

// ---------------------------------------------------------------------------
// I4 — a project has at least one slice or direct change
// ---------------------------------------------------------------------------

describe('I4 — pass: no project-started events', () => {
  const results = checkInvariants([]);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });
});

describe('I4 — pass: project-started with matching slice-started', () => {
  const events: TraceEvent[] = [
    mkProjectStarted('my-project'),
    mkSliceStarted('slice-01', 'my-project'),
  ];
  const results = checkInvariants(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence contains the project-started event', () => {
    const r = results.find((x) => x.id === 'I4');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'project-started');
  });
});

describe('I4 — fail: project-started with no child work', () => {
  const events: TraceEvent[] = [mkProjectStarted('empty-project')];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence contains the offending project-started event', () => {
    const r = results.find((x) => x.id === 'I4');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'project-started');
  });
});

// ---------------------------------------------------------------------------
// I6 — spec+plan before first dispatch of a slice
// ---------------------------------------------------------------------------

describe('I6 — pass: spec+plan precede the dispatch', () => {
  const SPEC_TS = '2026-01-01T00:00:00.000Z';
  const DISPATCH_TS = '2026-01-01T01:00:00.000Z';
  const events: TraceEvent[] = [
    mkSpecAuthored('spec.md', 'slice', 5, SPEC_TS),
    mkPlanAuthored('plan.md', SPEC_TS),
    mkDispatchStart('d-001', 'test-run', DISPATCH_TS),
    mkBriefIssued('d-001'),
  ];
  const results = checkInvariants(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence references the dispatch-start', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'dispatch-start');
  });
});

describe('I6 — pass: direct-change run skips the spec+plan check', () => {
  const events: TraceEvent[] = [
    mkDispatchStart('d-direct', 'direct-2026-01-01', '2026-01-01T01:00:00.000Z'),
  ];
  const results = checkInvariants(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence note mentions direct-change', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('direct-change'));
  });
});

describe('I6 — fail: dispatch-start with neither spec nor plan', () => {
  const events: TraceEvent[] = [mkDispatchStart('d-orphan')];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence contains the orphan dispatch-start', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'dispatch-start');
  });

  it('evidence note mentions spec-authored', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('spec-authored'));
  });
});

describe('I6 — fail: dispatch-start with spec but no plan', () => {
  const SPEC_TS = '2026-01-01T00:00:00.000Z';
  const DISPATCH_TS = '2026-01-01T01:00:00.000Z';
  const events: TraceEvent[] = [
    mkSpecAuthored('spec.md', 'slice', 5, SPEC_TS),
    mkDispatchStart('d-no-plan', 'test-run', DISPATCH_TS),
  ];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence note mentions plan-authored', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('plan-authored'));
  });
});

// ---------------------------------------------------------------------------
// I8 — every dispatch has a matching brief-issued
// ---------------------------------------------------------------------------

describe('I8 — pass: no dispatch-start events', () => {
  const results = checkInvariants([]);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });
});

describe('I8 — pass: all dispatches have matching brief-issued', () => {
  const events: TraceEvent[] = [
    mkDispatchStart('d-001'),
    mkBriefIssued('d-001'),
    mkDispatchStart('d-002'),
    mkBriefIssued('d-002'),
  ];
  const results = checkInvariants(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence contains both dispatch-start events', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 2);
  });
});

describe('I8 — fail: dispatch-start without matching brief-issued', () => {
  const events: TraceEvent[] = [
    mkDispatchStart('d-001'),
    mkBriefIssued('d-001'),
    mkDispatchStart('d-orphan'),
  ];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence contains only the orphan dispatch-start', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'dispatch-start');
  });

  it('evidence note mentions brief-issued', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('brief-issued'));
  });
});

describe('I8 — fail: brief-issued from different run does not satisfy the dispatch-start', () => {
  const BRIEF_TS = '2026-01-01T00:00:00.000Z';
  const DISPATCH_TS = '2026-01-01T01:00:00.000Z';
  const events: TraceEvent[] = [
    mkDispatchStart('d-001', 'run-A', DISPATCH_TS),
    mkBriefIssued('d-001', 'run-B', BRIEF_TS),
  ];
  const results = checkInvariants(events);

  it('status is fail (cross-run brief does not match)', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence references the orphan dispatch-start', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'dispatch-start');
  });
});

describe('I8 — fail: brief-issued arrives after dispatch-start', () => {
  const DISPATCH_TS = '2026-01-01T00:00:00.000Z';
  const BRIEF_TS = '2026-01-01T01:00:00.000Z';
  const events: TraceEvent[] = [
    mkDispatchStart('d-late', 'test-run', DISPATCH_TS),
    mkBriefIssued('d-late', 'test-run', BRIEF_TS),
  ];
  const results = checkInvariants(events);

  it('status is fail (brief arrived after dispatch-start)', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence note mentions brief occurs after dispatch-start', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('after'));
  });
});

// ---------------------------------------------------------------------------
// I10 — every project has a DoD in its project spec
// ---------------------------------------------------------------------------

describe('I10 — pass: no project spec-authored events', () => {
  const results = checkInvariants([]);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });
});

describe('I10 — pass: project spec with dod_items_count > 0', () => {
  const events: TraceEvent[] = [mkSpecAuthored('spec.md', 'project', 5)];
  const results = checkInvariants(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence contains the spec-authored event', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
  });
});

describe('I10 — fail: project spec with dod_items_count = 0', () => {
  const events: TraceEvent[] = [mkSpecAuthored('spec.md', 'project', 0)];
  const results = checkInvariants(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence note mentions dod_items_count', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('dod_items_count'));
  });
});

describe('I10 — fail: no spec-authored but spec-amended zeroes out dod_items (early-return bug fix)', () => {
  const events: TraceEvent[] = [mkSpecAmended('spec.md', 'project', 0)];
  const results = checkInvariants(events);

  it('status is fail (spec-amended with dod=0 must be caught even without spec-authored)', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('evidence references the spec-amended event', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'spec-amended');
  });
});

describe('I10 — pass: slice specs do not count (only project specs checked)', () => {
  const events: TraceEvent[] = [mkSpecAuthored('slice-spec.md', 'slice', 0)];
  const results = checkInvariants(events);

  it('status is pass (slice spec with 0 dod_items ignored by I10)', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });
});

// ---------------------------------------------------------------------------
// I12 — not-checkable for silent amendments; falsified-assumption events surfaced
// ---------------------------------------------------------------------------

describe('I12 — not-checkable with no falsified-assumption events', () => {
  const results = checkInvariants([]);

  it('status is not-checkable', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence is empty', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });

  it('note mentions silent amendments', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.ok(r.note.includes('silent'));
  });
});

describe('I12 — not-checkable with falsified-assumption evidence surfaced', () => {
  const events: TraceEvent[] = [mkFalsifiedAssumption(), mkFalsifiedAssumption()];
  const results = checkInvariants(events);

  it('status is still not-checkable', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence contains both falsified-assumption events', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 2);
    assert.ok(r.evidence.every((ref) => ref.event_type === 'falsified-assumption'));
  });

  it('evidence notes reference the halt-and-discuss path', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('halt'));
  });
});

// ---------------------------------------------------------------------------
// Structural invariants — checkInvariants always returns 12 results
// ---------------------------------------------------------------------------

describe('checkInvariants — structural guarantees', () => {
  const results = checkInvariants([]);

  it('returns exactly 12 results for empty trace', () => {
    assert.equal(results.length, 12);
  });

  it('ids are I1–I12 in order', () => {
    assert.deepEqual(
      results.map((r) => r.id),
      ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10', 'I11', 'I12'],
    );
  });

  it('every result has a non-empty title', () => {
    for (const r of results) {
      assert.ok(r.title.length > 0, `${r.id} missing title`);
    }
  });

  it('every not-checkable result has a non-empty note', () => {
    for (const r of results) {
      if (r.status === 'not-checkable') {
        assert.ok(r.note.length > 0, `${r.id} not-checkable but note is empty`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Real trace — test/fixtures/sample-trace.jsonl
// ---------------------------------------------------------------------------

describe('checkInvariants — real trace', () => {
  const { events } = loadTrace(TRACE_PATH);
  const results = checkInvariants(events);

  it('returns 12 results without throwing', () => {
    assert.equal(results.length, 12);
  });

  it('I1 is pass (no slice-completed events in trace)', () => {
    const r = results.find((x) => x.id === 'I1');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('I2 is not-checkable', () => {
    const r = results.find((x) => x.id === 'I2');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('I3 is not-checkable', () => {
    const r = results.find((x) => x.id === 'I3');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('I4 is pass (no project-started events)', () => {
    const r = results.find((x) => x.id === 'I4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('I5 is not-checkable', () => {
    const r = results.find((x) => x.id === 'I5');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('I6 is pass (spec+plan precede all dispatches in the trace)', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('I7 is not-checkable', () => {
    const r = results.find((x) => x.id === 'I7');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('I8 is pass (all dispatches have matching brief-issued)', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('I9 is not-checkable', () => {
    const r = results.find((x) => x.id === 'I9');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('I10 is pass (no project spec-authored events in trace)', () => {
    const r = results.find((x) => x.id === 'I10');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('I11 is not-checkable', () => {
    const r = results.find((x) => x.id === 'I11');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('I12 is not-checkable with 0 evidence (no falsified-assumption events in trace)', () => {
    const r = results.find((x) => x.id === 'I12');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
    assert.equal(r.evidence.length, 0);
  });

  it('all not-checkable results have non-empty notes', () => {
    for (const r of results) {
      if (r.status === 'not-checkable') {
        assert.ok(r.note.length > 0, `${r.id} not-checkable but note is empty`);
      }
    }
  });

  it('I6 evidence references real event_ids from the trace', () => {
    const r = results.find((x) => x.id === 'I6');
    assert.ok(r !== undefined);
    const traceEventIds = new Set(events.map((e) => e.event_id));
    for (const ref of r.evidence) {
      assert.ok(traceEventIds.has(ref.event_id), `evidence event_id ${ref.event_id} not in trace`);
    }
  });

  it('I8 evidence references real event_ids from the trace', () => {
    const r = results.find((x) => x.id === 'I8');
    assert.ok(r !== undefined);
    const traceEventIds = new Set(events.map((e) => e.event_id));
    for (const ref of r.evidence) {
      assert.ok(traceEventIds.has(ref.event_id), `evidence event_id ${ref.event_id} not in trace`);
    }
  });
});
