import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTrace } from '../load.ts';
import { computeMetrics } from '../metrics.ts';
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

function mkDispatchStart(
  dispatch_id: string,
  model: string | null = 'model-a',
  ts = ENV.ts,
): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'dispatch-start' as const,
    dispatch_id,
    dispatch_name: 'test dispatch',
    subagent_type: 'generalPurpose',
    model,
    parent_dispatch_id: null,
  };
}

function mkRoundStart(dispatch_id: string, round_id: string, round_number: number): TraceEvent {
  return {
    ...ENV,
    event_type: 'round-start' as const,
    dispatch_id,
    round_id,
    round_number,
  };
}

function mkBriefIssued(
  dispatch_id: string,
  round_id: string,
  brief_disposition: 'initial' | 'reissue' | 'amended',
): TraceEvent {
  return {
    ...ENV,
    event_type: 'brief-issued' as const,
    dispatch_id,
    round_id,
    brief_byte_length: 1024,
    brief_content_hash: 'abc123',
    brief_disposition,
  };
}

function mkRoundEnd(
  dispatch_id: string,
  round_id: string,
  verdict: 'satisfied' | 'another-round-needed' | 'escalating-to-user' | 'stop-condition',
  wall_clock_ms: number,
): TraceEvent {
  return {
    ...ENV,
    event_type: 'round-end' as const,
    dispatch_id,
    round_id,
    verdict,
    findings_filed: 0,
    wall_clock_ms,
  };
}

function mkDispatchEnd(
  dispatch_id: string,
  wall_clock_ms: number,
  result: 'completed' | 'failed' | 'aborted' = 'completed',
): TraceEvent {
  return {
    ...ENV,
    event_type: 'dispatch-end' as const,
    dispatch_id,
    result,
    wall_clock_ms,
  };
}

function mkSpecAuthored(spec_path: string, ts = ENV.ts): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'spec-authored' as const,
    spec_path,
    spec_kind: 'slice' as const,
    byte_length: 5000,
    edge_cases_count: 3,
    open_questions_count: 2,
    dod_items_count: 5,
  };
}

function mkSpecAmended(
  spec_path: string,
  reason:
    | 'falsified-assumption'
    | 'new-edge-case'
    | 'scope-shift'
    | 'operator-correction'
    | 'replan-from-discussion',
  ts = '2026-01-01T01:00:00.000Z',
): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'spec-amended' as const,
    spec_path,
    spec_kind: 'slice' as const,
    byte_length: 5500,
    bytes_delta: 500,
    edge_cases_count: 4,
    open_questions_count: 1,
    dod_items_count: 5,
    reason,
    sections_changed: ['Approach'],
  };
}

function mkPlanAuthored(
  plan_path: string,
  dispatch_size_distribution: { S: number; M: number; L: number; XL: number } | null = null,
  ts = ENV.ts,
): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'plan-authored' as const,
    plan_path,
    plan_kind: 'slice' as const,
    byte_length: 3000,
    dispatch_count: 5,
    slice_count: null,
    dispatch_size_distribution,
    open_items_count: 0,
  };
}

function mkProjectStarted(ts: string): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'project-started' as const,
    project_slug: 'test-project',
    origin: 'new-project' as const,
    has_linear_project: false,
  };
}

function mkProjectClosed(ts: string): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'project-closed' as const,
    dod_status: 'all-met' as const,
    slices_completed: 3,
    final_retro_done: true,
  };
}

function mkSliceStarted(slice_slug: string, ts: string): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'slice-started' as const,
    slice_slug,
    slice_index: 1,
    linear_ref: null,
  };
}

function mkSliceCompleted(slice_slug: string, ts: string): TraceEvent {
  return {
    ...ENV,
    ts,
    event_type: 'slice-completed' as const,
    slice_slug,
    result: 'merged' as const,
    pr_ref: '#1',
  };
}

function mkHealthCheckFired(
  cadence:
    | 'opening-rollup'
    | 'per-slice-merge'
    | 'closing-rollup'
    | 'session-bookend'
    | 'trigger-fired',
  max_drift_severity: 'none' | 'low' | 'medium' | 'high',
): TraceEvent {
  return {
    ...ENV,
    event_type: 'health-check-fired' as const,
    cadence,
    drift_signal_count: 1,
    max_drift_severity,
    recommended_next: null,
  };
}

function mkRetroLanded(
  trigger_class:
    | 'dispatch-failure'
    | 'drift-event'
    | 'scope-shift-escapee'
    | 'wip-inspection-finding'
    | 'operator-flagged-surprise'
    | 'mandatory-final',
  landing_surfaces: Array<'canonical-skill' | 'project-context-readme' | 'adr'>,
): TraceEvent {
  return {
    ...ENV,
    event_type: 'retro-landed' as const,
    trigger_class,
    landing_surfaces,
    is_mandatory_final: false,
  };
}

function mkFalsifiedAssumption(
  artifact_path: string,
  triggered_by:
    | 'implementer-pushback'
    | 'wip-inspection'
    | 'dispatch-blocked'
    | 'health-check-drift'
    | 'orchestrator-self-detected'
    | 'operator-flagged',
): TraceEvent {
  return {
    ...ENV,
    event_type: 'falsified-assumption' as const,
    artifact_path,
    triggered_by,
    assumption_summary: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeMetrics — empty event array', () => {
  const m = computeMetrics([]);

  it('rounds_per_dispatch is null with a note', () => {
    assert.equal(m.rework.rounds_per_dispatch, null);
    assert.ok(
      typeof m.rework.rounds_per_dispatch_note === 'string',
      'rounds_per_dispatch_note should be a string',
    );
  });

  it('first_pass_acceptance_rate is null with a note', () => {
    assert.equal(m.rework.first_pass_acceptance_rate, null);
    assert.ok(typeof m.rework.first_pass_acceptance_rate_note === 'string');
  });

  it('backtrack_ratio is null with a note', () => {
    assert.equal(m.rework.backtrack_ratio, null);
    assert.ok(typeof m.rework.backtrack_ratio_note === 'string');
  });

  it('brief_stability is null with a note', () => {
    assert.equal(m.rework.brief_stability, null);
    assert.ok(typeof m.rework.brief_stability_note === 'string');
  });

  it('tier_mix is null with a note', () => {
    assert.equal(m.rework.tier_mix, null);
    assert.ok(typeof m.rework.tier_mix_note === 'string');
  });

  it('dispatch_wallclock_ms is null with a note', () => {
    assert.equal(m.rework.dispatch_wallclock_ms, null);
    assert.ok(typeof m.rework.dispatch_wallclock_ms_note === 'string');
  });

  it('round_wallclock_ms is null with a note', () => {
    assert.equal(m.rework.round_wallclock_ms, null);
    assert.ok(typeof m.rework.round_wallclock_ms_note === 'string');
  });

  it('spec_amendments.count is 0 (honest zero)', () => {
    assert.equal(m.planning_quality.spec_amendments.count, 0);
    assert.deepEqual(m.planning_quality.spec_amendments.per_path, {});
    assert.deepEqual(m.planning_quality.spec_amendments.reason_distribution, {});
  });

  it('plan_amendments.count is 0 (honest zero)', () => {
    assert.equal(m.planning_quality.plan_amendments.count, 0);
    assert.deepEqual(m.planning_quality.plan_amendments.per_path, {});
    assert.deepEqual(m.planning_quality.plan_amendments.reason_distribution, {});
  });

  it('dispatch_sizes is empty (no plan-authored events)', () => {
    assert.deepEqual(m.planning_quality.dispatch_sizes, []);
  });

  it('i12_halts.count is 0 (honest zero)', () => {
    assert.equal(m.planning_quality.i12_halts.count, 0);
    assert.deepEqual(m.planning_quality.i12_halts.triggered_by_distribution, {});
  });

  it('triage_stability is null with a note', () => {
    assert.equal(m.planning_quality.triage_stability, null);
    assert.ok(typeof m.planning_quality.triage_stability_note === 'string');
  });

  it('write_amplification.mean is null (no authored events)', () => {
    assert.deepEqual(m.artefact_churn.write_amplification.per_path, {});
    assert.equal(m.artefact_churn.write_amplification.mean, null);
    assert.ok(typeof m.artefact_churn.write_amplification.mean_note === 'string');
  });

  it('time_to_stability_ms.per_path is empty', () => {
    assert.deepEqual(m.artefact_churn.time_to_stability_ms.per_path, {});
  });

  it('project_wallclock_ms is null with a note', () => {
    assert.equal(m.lifecycle.project_wallclock_ms, null);
    assert.ok(typeof m.lifecycle.project_wallclock_ms_note === 'string');
  });

  it('slice_wallclock_ms is null with a note', () => {
    assert.equal(m.lifecycle.slice_wallclock_ms, null);
    assert.ok(typeof m.lifecycle.slice_wallclock_ms_note === 'string');
  });

  it('health_check_cadence.count is 0 with null max severity', () => {
    assert.equal(m.lifecycle.health_check_cadence.count, 0);
    assert.deepEqual(m.lifecycle.health_check_cadence.cadence_distribution, {});
    assert.equal(m.lifecycle.health_check_cadence.max_drift_severity, null);
    assert.ok(typeof m.lifecycle.health_check_cadence.max_drift_severity_note === 'string');
  });

  it('retro_distribution.count is 0', () => {
    assert.equal(m.lifecycle.retro_distribution.count, 0);
    assert.deepEqual(m.lifecycle.retro_distribution.trigger_class_distribution, {});
    assert.deepEqual(m.lifecycle.retro_distribution.landing_surfaces_distribution, {});
  });

  it('operator_turn_count is always null with a note', () => {
    assert.equal(m.operator.operator_turn_count, null);
    assert.ok(typeof m.operator.operator_turn_count_note === 'string');
  });
});

describe('computeMetrics — rework: single dispatch, 1 round, satisfied', () => {
  const D = 'd-001';
  const R = 'r-001';
  const events: TraceEvent[] = [
    mkDispatchStart(D, 'model-a'),
    mkRoundStart(D, R, 1),
    mkBriefIssued(D, R, 'initial'),
    mkRoundEnd(D, R, 'satisfied', 5000),
    mkDispatchEnd(D, 5000),
  ];
  const m = computeMetrics(events);

  it('rounds_per_dispatch has 1 entry with count 1', () => {
    assert.ok(m.rework.rounds_per_dispatch !== null);
    assert.equal(m.rework.rounds_per_dispatch.per_dispatch[D], 1);
  });

  it('rounds_per_dispatch.mean is 1', () => {
    assert.ok(m.rework.rounds_per_dispatch !== null);
    assert.equal(m.rework.rounds_per_dispatch.mean, 1);
  });

  it('first_pass_acceptance_rate is 1 (satisfied on round 1)', () => {
    assert.equal(m.rework.first_pass_acceptance_rate, 1);
  });

  it('backtrack_ratio is 0 (0 non-satisfied / 1 satisfied)', () => {
    assert.equal(m.rework.backtrack_ratio, 0);
  });

  it('brief_stability.overall counts initial briefs', () => {
    assert.ok(m.rework.brief_stability !== null);
    assert.equal(m.rework.brief_stability.overall['initial'], 1);
  });

  it('brief_stability.per_dispatch tracks disposition per dispatch', () => {
    assert.ok(m.rework.brief_stability !== null);
    assert.equal(m.rework.brief_stability.per_dispatch[D]?.['initial'], 1);
  });

  it('tier_mix records the model', () => {
    assert.ok(m.rework.tier_mix !== null);
    assert.equal(m.rework.tier_mix['model-a'], 1);
  });

  it('dispatch_wallclock_ms reflects dispatch-end wall_clock_ms', () => {
    assert.ok(m.rework.dispatch_wallclock_ms !== null);
    assert.equal(m.rework.dispatch_wallclock_ms.per_dispatch[D], 5000);
    assert.equal(m.rework.dispatch_wallclock_ms.mean, 5000);
    assert.equal(m.rework.dispatch_wallclock_ms.total, 5000);
  });

  it('round_wallclock_ms keyed by round_id', () => {
    assert.ok(m.rework.round_wallclock_ms !== null);
    assert.equal(m.rework.round_wallclock_ms[R], 5000);
  });
});

describe('computeMetrics — rework: single dispatch, 2 rounds (ARN then satisfied)', () => {
  const D = 'd-002';
  const R1 = 'r-001';
  const R2 = 'r-002';
  const events: TraceEvent[] = [
    mkDispatchStart(D, 'model-b'),
    mkRoundStart(D, R1, 1),
    mkBriefIssued(D, R1, 'initial'),
    mkRoundEnd(D, R1, 'another-round-needed', 3000),
    mkRoundStart(D, R2, 2),
    mkBriefIssued(D, R2, 'amended'),
    mkRoundEnd(D, R2, 'satisfied', 2000),
    mkDispatchEnd(D, 5000),
  ];
  const m = computeMetrics(events);

  it('rounds_per_dispatch.per_dispatch has count 2 for this dispatch', () => {
    assert.ok(m.rework.rounds_per_dispatch !== null);
    assert.equal(m.rework.rounds_per_dispatch.per_dispatch[D], 2);
  });

  it('rounds_per_dispatch.mean is 2', () => {
    assert.ok(m.rework.rounds_per_dispatch !== null);
    assert.equal(m.rework.rounds_per_dispatch.mean, 2);
  });

  it('first_pass_acceptance_rate is 0 (not satisfied on round 1)', () => {
    assert.equal(m.rework.first_pass_acceptance_rate, 0);
  });

  it('backtrack_ratio is 1 (1 non-satisfied / 1 satisfied)', () => {
    assert.equal(m.rework.backtrack_ratio, 1);
  });

  it('brief_stability.overall has initial:1 and amended:1', () => {
    assert.ok(m.rework.brief_stability !== null);
    assert.equal(m.rework.brief_stability.overall['initial'], 1);
    assert.equal(m.rework.brief_stability.overall['amended'], 1);
  });
});

describe('computeMetrics — rework: dispatch without dispatch-end (partial trace)', () => {
  const D = 'd-003';
  const R = 'r-001';
  const events: TraceEvent[] = [
    mkDispatchStart(D, 'model-a'),
    mkRoundStart(D, R, 1),
    mkBriefIssued(D, R, 'initial'),
  ];

  it('does not throw', () => {
    assert.doesNotThrow(() => computeMetrics(events));
  });

  it('rounds_per_dispatch still counts the round-start', () => {
    const m = computeMetrics(events);
    assert.ok(m.rework.rounds_per_dispatch !== null);
    assert.equal(m.rework.rounds_per_dispatch.per_dispatch[D], 1);
  });

  it('dispatch_wallclock_ms is null (no dispatch-end)', () => {
    const m = computeMetrics(events);
    assert.equal(m.rework.dispatch_wallclock_ms, null);
  });

  it('first_pass_acceptance_rate is null (no round-end)', () => {
    const m = computeMetrics(events);
    assert.equal(m.rework.first_pass_acceptance_rate, null);
  });
});

describe('computeMetrics — rework: null model recorded as (unspecified)', () => {
  const D = 'd-004';
  const R = 'r-001';
  const events: TraceEvent[] = [
    mkDispatchStart(D, null),
    mkRoundStart(D, R, 1),
    mkRoundEnd(D, R, 'satisfied', 1000),
    mkDispatchEnd(D, 1000),
  ];
  const m = computeMetrics(events);

  it('tier_mix has (unspecified) key when model is null', () => {
    assert.ok(m.rework.tier_mix !== null);
    assert.equal(m.rework.tier_mix['(unspecified)'], 1);
  });
});

describe('computeMetrics — planning quality: spec-amended events', () => {
  const events: TraceEvent[] = [
    mkSpecAuthored('spec.md'),
    mkSpecAmended('spec.md', 'falsified-assumption'),
    mkSpecAmended('spec.md', 'operator-correction'),
    mkSpecAmended('other.md', 'scope-shift'),
  ];
  const m = computeMetrics(events);

  it('spec_amendments.count equals total spec-amended events', () => {
    assert.equal(m.planning_quality.spec_amendments.count, 3);
  });

  it('spec_amendments.per_path tracks counts per file', () => {
    assert.equal(m.planning_quality.spec_amendments.per_path['spec.md'], 2);
    assert.equal(m.planning_quality.spec_amendments.per_path['other.md'], 1);
  });

  it('spec_amendments.reason_distribution tallies reasons', () => {
    assert.equal(m.planning_quality.spec_amendments.reason_distribution['falsified-assumption'], 1);
    assert.equal(m.planning_quality.spec_amendments.reason_distribution['operator-correction'], 1);
    assert.equal(m.planning_quality.spec_amendments.reason_distribution['scope-shift'], 1);
  });
});

describe('computeMetrics — planning quality: plan-authored with dispatch_size_distribution', () => {
  const events: TraceEvent[] = [
    mkPlanAuthored('plan1.md', { S: 0, M: 5, L: 0, XL: 0 }),
    mkPlanAuthored('plan2.md', { S: 1, M: 2, L: 1, XL: 0 }),
    mkPlanAuthored('plan3.md', null),
  ];
  const m = computeMetrics(events);

  it('dispatch_sizes excludes nulls and includes plan_path + distribution', () => {
    assert.equal(m.planning_quality.dispatch_sizes.length, 2);
    assert.deepEqual(m.planning_quality.dispatch_sizes[0], {
      plan_path: 'plan1.md',
      distribution: { S: 0, M: 5, L: 0, XL: 0 },
    });
  });
});

describe('computeMetrics — planning quality: i12_halt_rate', () => {
  const events: TraceEvent[] = [
    mkFalsifiedAssumption('spec.md', 'implementer-pushback'),
    mkFalsifiedAssumption('plan.md', 'wip-inspection'),
    mkFalsifiedAssumption('spec.md', 'implementer-pushback'),
  ];
  const m = computeMetrics(events);

  it('i12_halts.count is 3', () => {
    assert.equal(m.planning_quality.i12_halts.count, 3);
  });

  it('triggered_by_distribution tallies correctly', () => {
    assert.equal(m.planning_quality.i12_halts.triggered_by_distribution['implementer-pushback'], 2);
    assert.equal(m.planning_quality.i12_halts.triggered_by_distribution['wip-inspection'], 1);
  });
});

describe('computeMetrics — artefact churn: write_amplification', () => {
  const events: TraceEvent[] = [
    mkSpecAuthored('spec.md', '2026-01-01T00:00:00.000Z'),
    mkSpecAmended('spec.md', 'falsified-assumption', '2026-01-01T02:00:00.000Z'),
    mkSpecAmended('spec.md', 'new-edge-case', '2026-01-01T04:00:00.000Z'),
    mkSpecAuthored('other.md', '2026-01-01T00:00:00.000Z'),
  ];
  const m = computeMetrics(events);

  it('per_path counts all writes (authored + amended)', () => {
    assert.equal(m.artefact_churn.write_amplification.per_path['spec.md'], 3);
    assert.equal(m.artefact_churn.write_amplification.per_path['other.md'], 1);
  });

  it('mean is the average across paths (3+1)/2 = 2', () => {
    assert.equal(m.artefact_churn.write_amplification.mean, 2);
  });
});

describe('computeMetrics — artefact churn: time_to_stability_ms', () => {
  const events: TraceEvent[] = [
    mkSpecAuthored('spec.md', '2026-01-01T00:00:00.000Z'),
    mkSpecAmended('spec.md', 'falsified-assumption', '2026-01-01T02:00:00.000Z'),
    mkSpecAuthored('never-amended.md', '2026-01-01T00:00:00.000Z'),
  ];
  const m = computeMetrics(events);

  it('time_to_stability_ms for amended spec = last_amend_ts - first_author_ts', () => {
    // 2 hours = 7200000 ms
    assert.equal(m.artefact_churn.time_to_stability_ms.per_path['spec.md'], 7_200_000);
  });

  it('time_to_stability_ms is 0 for a path that was never amended', () => {
    assert.equal(m.artefact_churn.time_to_stability_ms.per_path['never-amended.md'], 0);
  });
});

describe('computeMetrics — lifecycle: project wallclock', () => {
  it('project_wallclock_ms is closed.ts - started.ts in ms', () => {
    const events: TraceEvent[] = [
      mkProjectStarted('2026-01-01T00:00:00.000Z'),
      mkProjectClosed('2026-01-01T01:00:00.000Z'),
    ];
    const m = computeMetrics(events);
    assert.equal(m.lifecycle.project_wallclock_ms, 3_600_000);
  });

  it('project_wallclock_ms is null when project-started is missing', () => {
    const events: TraceEvent[] = [mkProjectClosed('2026-01-01T01:00:00.000Z')];
    const m = computeMetrics(events);
    assert.equal(m.lifecycle.project_wallclock_ms, null);
    assert.ok(typeof m.lifecycle.project_wallclock_ms_note === 'string');
  });

  it('project_wallclock_ms is null when project-closed is missing', () => {
    const events: TraceEvent[] = [mkProjectStarted('2026-01-01T00:00:00.000Z')];
    const m = computeMetrics(events);
    assert.equal(m.lifecycle.project_wallclock_ms, null);
    assert.ok(typeof m.lifecycle.project_wallclock_ms_note === 'string');
  });
});

describe('computeMetrics — lifecycle: slice wallclock', () => {
  it('slice_wallclock_ms matched by slice_slug', () => {
    const events: TraceEvent[] = [
      mkSliceStarted('slice-01', '2026-01-01T00:00:00.000Z'),
      mkSliceCompleted('slice-01', '2026-01-01T00:30:00.000Z'),
      mkSliceStarted('slice-02', '2026-01-01T01:00:00.000Z'),
      mkSliceCompleted('slice-02', '2026-01-01T02:00:00.000Z'),
    ];
    const m = computeMetrics(events);
    assert.ok(m.lifecycle.slice_wallclock_ms !== null);
    assert.equal(m.lifecycle.slice_wallclock_ms['slice-01'], 1_800_000);
    assert.equal(m.lifecycle.slice_wallclock_ms['slice-02'], 3_600_000);
  });

  it('slice_wallclock_ms is null when no slice events', () => {
    const m = computeMetrics([]);
    assert.equal(m.lifecycle.slice_wallclock_ms, null);
  });
});

describe('computeMetrics — lifecycle: health_check_cadence', () => {
  const events: TraceEvent[] = [
    mkHealthCheckFired('opening-rollup', 'none'),
    mkHealthCheckFired('per-slice-merge', 'low'),
    mkHealthCheckFired('trigger-fired', 'high'),
    mkHealthCheckFired('closing-rollup', 'medium'),
  ];
  const m = computeMetrics(events);

  it('count is 4', () => {
    assert.equal(m.lifecycle.health_check_cadence.count, 4);
  });

  it('cadence_distribution tallies cadence values', () => {
    assert.equal(m.lifecycle.health_check_cadence.cadence_distribution['opening-rollup'], 1);
    assert.equal(m.lifecycle.health_check_cadence.cadence_distribution['per-slice-merge'], 1);
    assert.equal(m.lifecycle.health_check_cadence.cadence_distribution['trigger-fired'], 1);
    assert.equal(m.lifecycle.health_check_cadence.cadence_distribution['closing-rollup'], 1);
  });

  it('max_drift_severity is the highest severity seen', () => {
    assert.equal(m.lifecycle.health_check_cadence.max_drift_severity, 'high');
  });
});

describe('computeMetrics — lifecycle: retro_distribution', () => {
  const events: TraceEvent[] = [
    mkRetroLanded('dispatch-failure', ['canonical-skill', 'adr']),
    mkRetroLanded('mandatory-final', ['canonical-skill', 'project-context-readme']),
  ];
  const m = computeMetrics(events);

  it('count is 2', () => {
    assert.equal(m.lifecycle.retro_distribution.count, 2);
  });

  it('trigger_class_distribution is correct', () => {
    assert.equal(m.lifecycle.retro_distribution.trigger_class_distribution['dispatch-failure'], 1);
    assert.equal(m.lifecycle.retro_distribution.trigger_class_distribution['mandatory-final'], 1);
  });

  it('landing_surfaces_distribution flattens arrays', () => {
    assert.equal(
      m.lifecycle.retro_distribution.landing_surfaces_distribution['canonical-skill'],
      2,
    );
    assert.equal(m.lifecycle.retro_distribution.landing_surfaces_distribution['adr'], 1);
    assert.equal(
      m.lifecycle.retro_distribution.landing_surfaces_distribution['project-context-readme'],
      1,
    );
  });
});

// The live project trace keeps growing as this project dogfoods its own
// instrumentation, so these assertions are internally consistent (derived from
// the loaded events) rather than pinned to magic counts. Exact-value coverage
// lives in the inline-fixture suites above.
describe('computeMetrics — real trace (test/fixtures/sample-trace.jsonl)', () => {
  const { events, errors } = loadTrace(TRACE_PATH);

  const countOf = (t: string): number => events.filter((e) => e.event_type === t).length;

  it('loads the live trace with no parse/validation errors', () => {
    assert.equal(errors.length, 0);
    assert.ok(events.length > 0);
  });

  it('computeMetrics never throws and returns all metric groups', () => {
    const m = computeMetrics(events);
    assert.ok(m.rework && m.planning_quality && m.artefact_churn && m.lifecycle && m.operator);
  });

  it('rounds_per_dispatch covers every dispatch-start and means the round-starts', () => {
    const m = computeMetrics(events);
    assert.ok(m.rework.rounds_per_dispatch !== null);
    const dispatches = countOf('dispatch-start');
    const rounds = countOf('round-start');
    assert.equal(Object.keys(m.rework.rounds_per_dispatch.per_dispatch).length, dispatches);
    assert.equal(m.rework.rounds_per_dispatch.mean, rounds / dispatches);
  });

  it('spec_amendments + i12_halts counts match the raw event counts', () => {
    const m = computeMetrics(events);
    assert.equal(m.planning_quality.spec_amendments.count, countOf('spec-amended'));
    assert.equal(m.planning_quality.i12_halts.count, countOf('falsified-assumption'));
  });

  it('brief_stability dispositions sum to the brief-issued count', () => {
    const m = computeMetrics(events);
    assert.ok(m.rework.brief_stability !== null);
    const total = Object.values(m.rework.brief_stability.overall).reduce((a, b) => a + b, 0);
    assert.equal(total, countOf('brief-issued'));
  });

  it('tier_mix tallies sum to the dispatch-start count', () => {
    const m = computeMetrics(events);
    assert.ok(m.rework.tier_mix !== null);
    const total = Object.values(m.rework.tier_mix).reduce((a, b) => a + b, 0);
    assert.equal(total, countOf('dispatch-start'));
  });

  it('dispatch + round wall-clock entries match the *-end event counts', () => {
    const m = computeMetrics(events);
    assert.ok(m.rework.dispatch_wallclock_ms !== null);
    assert.ok(m.rework.round_wallclock_ms !== null);
    assert.equal(
      Object.keys(m.rework.dispatch_wallclock_ms.per_dispatch).length,
      countOf('dispatch-end'),
    );
    assert.equal(Object.keys(m.rework.round_wallclock_ms).length, countOf('round-end'));
  });

  it('dispatch_sizes has one entry per plan-authored with non-null distribution', () => {
    const m = computeMetrics(events);
    const withDist = events.filter(
      (e) => e.event_type === 'plan-authored' && e.dispatch_size_distribution !== null,
    ).length;
    assert.equal(m.planning_quality.dispatch_sizes.length, withDist);
  });

  it('write_amplification per-path count equals distinct authored artefact paths', () => {
    const m = computeMetrics(events);
    const authoredPaths = new Set<string>();
    for (const e of events) {
      if (e.event_type === 'spec-authored') authoredPaths.add(e.spec_path);
      if (e.event_type === 'plan-authored') authoredPaths.add(e.plan_path);
    }
    assert.equal(
      Object.keys(m.artefact_churn.write_amplification.per_path).length,
      authoredPaths.size,
    );
  });

  it('operator_turn_count is null with a note (post-hoc only in the native path)', () => {
    const m = computeMetrics(events);
    assert.equal(m.operator.operator_turn_count, null);
    assert.ok(typeof m.operator.operator_turn_count_note === 'string');
  });
});
