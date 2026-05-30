import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TraceEvent } from '../../drive-record-traces/schema.ts';
import { checkBriefDiscipline } from '../assertions/brief.ts';
import { checkCascadeRules } from '../assertions/cascade.ts';
import { runAssertions } from '../assertions/index.ts';
import { loadTrace } from '../load.ts';

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

function mkTriageVerdict(
  verdict:
    | 'direct-change'
    | 'orphan-slice'
    | 'in-project-slice'
    | 'new-project'
    | 'promote'
    | 'demote'
    | 'spike-first'
    | 'defer',
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    event_type: 'triage-verdict' as const,
    verdict,
    input_shape: 'linear-ticket' as const,
    input_ref: null,
  };
}

function mkFalsifiedAssumption(): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    event_type: 'falsified-assumption' as const,
    artifact_path: 'spec.md',
    triggered_by: 'implementer-pushback' as const,
    assumption_summary: null,
  };
}

function mkBriefIssued(
  dispatch_id: string,
  brief_byte_length: number,
  brief_disposition: 'initial' | 'reissue' | 'amended' = 'initial',
): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    event_type: 'brief-issued' as const,
    dispatch_id,
    round_id: uid(),
    brief_byte_length,
    brief_content_hash: 'abc123',
    brief_disposition,
  };
}

function mkSpecAuthored(spec_path: string, byte_length: number): TraceEvent {
  return {
    ...ENV,
    event_id: uid(),
    event_type: 'spec-authored' as const,
    spec_path,
    spec_kind: 'slice' as const,
    byte_length,
    edge_cases_count: 0,
    open_questions_count: 0,
    dod_items_count: 5,
  };
}

// ---------------------------------------------------------------------------
// checkCascadeRules — structural guarantees
// ---------------------------------------------------------------------------

describe('checkCascadeRules — structural: empty trace returns 8 results', () => {
  const results = checkCascadeRules([]);

  it('returns exactly 8 results', () => {
    assert.equal(results.length, 8);
  });

  it('ids are Cascade-1 through Cascade-8 in order', () => {
    assert.deepEqual(
      results.map((r) => r.id),
      [
        'Cascade-1',
        'Cascade-2',
        'Cascade-3',
        'Cascade-4',
        'Cascade-5',
        'Cascade-6',
        'Cascade-7',
        'Cascade-8',
      ],
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
// Cascade-1, 2, 5, 6, 7, 8 — always not-checkable (no trace signal)
// ---------------------------------------------------------------------------

for (const id of [
  'Cascade-1',
  'Cascade-2',
  'Cascade-5',
  'Cascade-6',
  'Cascade-7',
  'Cascade-8',
] as const) {
  describe(`${id} — always not-checkable`, () => {
    const results = checkCascadeRules([]);

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
// Cascade-3 — triage produces one of three delivery shapes
// ---------------------------------------------------------------------------

describe('Cascade-3 — pass: no triage-verdict events', () => {
  const results = checkCascadeRules([]);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence is empty', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });
});

describe('Cascade-3 — pass: valid triage-shape verdicts surface distribution', () => {
  const events: TraceEvent[] = [
    mkTriageVerdict('direct-change'),
    mkTriageVerdict('orphan-slice'),
    mkTriageVerdict('orphan-slice'),
  ];
  const results = checkCascadeRules(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence contains one ref per triage-verdict event', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 3);
    assert.ok(r.evidence.every((e) => e.event_type === 'triage-verdict'));
  });

  it('evidence notes include the verdict value', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.includes('direct-change'));
  });
});

describe('Cascade-3 — pass: transition verdicts are schema-valid and surfaced', () => {
  const events: TraceEvent[] = [mkTriageVerdict('promote'), mkTriageVerdict('defer')];
  const results = checkCascadeRules(events);

  it('status is still pass (schema-valid; whether right shape is not-checkable)', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence notes classify transitions', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    const notes = r.evidence.map((e) => e.note ?? '');
    assert.ok(notes.some((n) => n.includes('transition')));
  });
});

// ---------------------------------------------------------------------------
// Cascade-4 — discussion is signal-triggered
// ---------------------------------------------------------------------------

describe('Cascade-4 — not-checkable: no falsified-assumption events', () => {
  const results = checkCascadeRules([]);

  it('status is not-checkable', () => {
    const r = results.find((x) => x.id === 'Cascade-4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence is empty', () => {
    const r = results.find((x) => x.id === 'Cascade-4');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });

  it('note is non-empty', () => {
    const r = results.find((x) => x.id === 'Cascade-4');
    assert.ok(r !== undefined);
    assert.ok(r.note.length > 0);
  });
});

describe('Cascade-4 — not-checkable with evidence: falsified-assumption events surface halt path', () => {
  const events: TraceEvent[] = [mkFalsifiedAssumption(), mkFalsifiedAssumption()];
  const results = checkCascadeRules(events);

  it('status is still not-checkable', () => {
    const r = results.find((x) => x.id === 'Cascade-4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence contains both falsified-assumption events', () => {
    const r = results.find((x) => x.id === 'Cascade-4');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 2);
    assert.ok(r.evidence.every((e) => e.event_type === 'falsified-assumption'));
  });
});

// ---------------------------------------------------------------------------
// checkBriefDiscipline — structural guarantees
// ---------------------------------------------------------------------------

describe('checkBriefDiscipline — structural: empty trace returns 11 results', () => {
  const results = checkBriefDiscipline([]);

  it('returns exactly 11 results', () => {
    assert.equal(results.length, 11);
  });

  it('ids are BD-1 through BD-11 in order', () => {
    assert.deepEqual(
      results.map((r) => r.id),
      ['BD-1', 'BD-2', 'BD-3', 'BD-4', 'BD-5', 'BD-6', 'BD-7', 'BD-8', 'BD-9', 'BD-10', 'BD-11'],
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
// BD-1 through BD-7, BD-10, BD-11 — always not-checkable (no content signal)
// ---------------------------------------------------------------------------

for (const id of [
  'BD-1',
  'BD-2',
  'BD-3',
  'BD-4',
  'BD-5',
  'BD-6',
  'BD-7',
  'BD-10',
  'BD-11',
] as const) {
  describe(`${id} — always not-checkable`, () => {
    const results = checkBriefDiscipline([]);

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
// BD-8 — brief restates the slice spec (heuristic: brief_byte_length >= spec)
// ---------------------------------------------------------------------------

describe('BD-8 — not-checkable: no brief-issued events', () => {
  const results = checkBriefDiscipline([]);

  it('status is not-checkable', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence is empty', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });
});

describe('BD-8 — not-checkable: briefs present but no spec-authored to compare', () => {
  const events: TraceEvent[] = [mkBriefIssued('d-001', 5000)];
  const results = checkBriefDiscipline(events);

  it('status is not-checkable', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });
});

describe('BD-8 — pass: brief shorter than spec', () => {
  const events: TraceEvent[] = [mkSpecAuthored('spec.md', 10000), mkBriefIssued('d-001', 3000)];
  const results = checkBriefDiscipline(events);

  it('status is pass', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('evidence contains the passing brief-issued ref', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'brief-issued');
  });
});

describe('BD-8 — heuristic fail: brief_byte_length >= spec byte_length', () => {
  const events: TraceEvent[] = [mkSpecAuthored('spec.md', 3000), mkBriefIssued('d-001', 3000)];
  const results = checkBriefDiscipline(events);

  it('status is fail', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'fail');
  });

  it('note contains "heuristic"', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.ok(r.note.toLowerCase().includes('heuristic'));
  });

  it('evidence contains the offending brief-issued event', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'brief-issued');
  });

  it('evidence note contains "heuristic"', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.ok(r.evidence[0]?.note?.toLowerCase().includes('heuristic'));
  });
});

// ---------------------------------------------------------------------------
// BD-9 — executor silently rewriting the brief
// ---------------------------------------------------------------------------

describe('BD-9 — not-checkable: no brief-issued events', () => {
  const results = checkBriefDiscipline([]);

  it('status is not-checkable', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence is empty', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });
});

describe('BD-9 — not-checkable: only initial dispositions', () => {
  const events: TraceEvent[] = [mkBriefIssued('d-001', 1000, 'initial')];
  const results = checkBriefDiscipline(events);

  it('status is not-checkable', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence is empty (no amended dispositions)', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 0);
  });
});

describe('BD-9 — not-checkable with evidence: amended disposition confirms surfaced rewrite', () => {
  const events: TraceEvent[] = [
    mkBriefIssued('d-001', 1000, 'initial'),
    mkBriefIssued('d-001', 1100, 'amended'),
  ];
  const results = checkBriefDiscipline(events);

  it('status is still not-checkable (cannot detect silent rewrites)', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
  });

  it('evidence contains the amended brief-issued event', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0]?.event_type, 'brief-issued');
  });

  it('evidence note references amended or surfaced rewrite', () => {
    const r = results.find((x) => x.id === 'BD-9');
    assert.ok(r !== undefined);
    const note = r.evidence[0]?.note ?? '';
    assert.ok(note.includes('amended') || note.includes('surfaced'));
  });
});

// ---------------------------------------------------------------------------
// runAssertions — structural: 12 invariants + 8 cascade + 11 brief = 31
// ---------------------------------------------------------------------------

describe('runAssertions — structural: empty trace returns 31 results', () => {
  const results = runAssertions([]);

  it('total count is 12 + 8 + 11 = 31', () => {
    assert.equal(results.length, 31);
  });

  it('first 12 are invariant results (I-prefixed ids)', () => {
    const invIds = results.slice(0, 12).map((r) => r.id);
    assert.ok(invIds.every((id) => id.startsWith('I')));
  });

  it('next 8 are cascade results (Cascade-prefixed ids)', () => {
    const cascadeIds = results.slice(12, 20).map((r) => r.id);
    assert.ok(cascadeIds.every((id) => id.startsWith('Cascade-')));
  });

  it('last 11 are brief results (BD-prefixed ids)', () => {
    const briefIds = results.slice(20).map((r) => r.id);
    assert.ok(briefIds.every((id) => id.startsWith('BD-')));
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
// runAssertions — real trace
// ---------------------------------------------------------------------------

describe('runAssertions — real trace (test/fixtures/sample-trace.jsonl)', () => {
  const { events, errors } = loadTrace(TRACE_PATH);
  const results = runAssertions(events);

  it('trace loads with no errors', () => {
    assert.equal(errors.length, 0);
    assert.ok(events.length > 0);
  });

  it('returns 31 results without throwing', () => {
    assert.equal(results.length, 31);
  });

  it('Cascade-3 is pass (no triage-verdict events in trace)', () => {
    const r = results.find((x) => x.id === 'Cascade-3');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('Cascade-4 is not-checkable with 0 evidence (no falsified-assumption events)', () => {
    const r = results.find((x) => x.id === 'Cascade-4');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'not-checkable');
    assert.equal(r.evidence.length, 0);
  });

  it('BD-8 is pass (all briefs shorter than their slice specs)', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    assert.equal(r.status, 'pass');
  });

  it('BD-8 evidence references real brief-issued event_ids', () => {
    const r = results.find((x) => x.id === 'BD-8');
    assert.ok(r !== undefined);
    const traceEventIds = new Set(events.map((e) => e.event_id));
    for (const evidenceRef of r.evidence) {
      assert.ok(
        traceEventIds.has(evidenceRef.event_id),
        `evidence event_id ${evidenceRef.event_id} not in trace`,
      );
    }
  });

  it('BD-9 is not-checkable (no amended dispositions in trace)', () => {
    const r = results.find((x) => x.id === 'BD-9');
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
});
