import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AssertionResult } from '../assertions/types.ts';
import type { LoadError, UnknownEvent } from '../load.ts';
import type { Metrics } from '../metrics.ts';
import { renderReport } from '../report.ts';
import type { Scorecard } from '../scorecard.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_METRICS: Metrics = {
  rework: {
    rounds_per_dispatch: null,
    rounds_per_dispatch_note: 'no round-start events',
    first_pass_acceptance_rate: null,
    first_pass_acceptance_rate_note: 'no round-end events for round 1',
    backtrack_ratio: null,
    backtrack_ratio_note: 'no round-end events',
    brief_stability: null,
    brief_stability_note: 'no brief-issued events',
    tier_mix: null,
    tier_mix_note: 'no dispatch-start events',
    dispatch_wallclock_ms: null,
    dispatch_wallclock_ms_note: 'no dispatch-end events',
    round_wallclock_ms: null,
    round_wallclock_ms_note: 'no round-end events',
  },
  planning_quality: {
    spec_amendments: { count: 0, per_path: {}, reason_distribution: {} },
    plan_amendments: {
      count: 0,
      per_path: {},
      reason_distribution: {},
    },
    dispatch_sizes: [],
    i12_halts: { count: 0, triggered_by_distribution: {} },
    triage_stability: null,
    triage_stability_note: 'no triage-verdict events',
  },
  artefact_churn: {
    write_amplification: { per_path: {}, mean: null, mean_note: 'no spec or plan events' },
    time_to_stability_ms: { per_path: {} },
  },
  lifecycle: {
    project_wallclock_ms: null,
    project_wallclock_ms_note: 'no project-started event',
    slice_wallclock_ms: null,
    slice_wallclock_ms_note: 'no slice-started or slice-completed events',
    health_check_cadence: {
      count: 0,
      cadence_distribution: {},
      max_drift_severity: null,
      max_drift_severity_note: 'no health-check-fired events',
    },
    retro_distribution: {
      count: 0,
      trigger_class_distribution: {},
      landing_surfaces_distribution: {},
    },
  },
  operator: {
    operator_turn_count: null,
    operator_turn_count_note: 'post-hoc only — no native operator-turn event exists in slice 1',
  },
};

const EMPTY_SCORECARD: Scorecard = {
  runs: [],
  correct_run_ids: [],
  correct_tokens: {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
  },
  has_any_correctness_signal: false,
};

const NOT_COMPUTABLE_SCORECARD: Scorecard = {
  runs: [
    {
      run_id: 'run-abc',
      correctness: null,
      verdict: 'not-computable',
      missing_inputs: ['external correctness signal (no `correctness-recorded` event)'],
      tokens: null,
    },
  ],
  correct_run_ids: [],
  correct_tokens: {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
  },
  has_any_correctness_signal: false,
};

const CORRECT_SCORECARD: Scorecard = {
  runs: [
    {
      run_id: 'run-abc',
      correctness: { mechanical: 'pass', qa: 'pass', intent: 'pass' },
      verdict: 'correct',
      missing_inputs: [],
      tokens: {
        input_tokens: 1_900_000,
        output_tokens: 42_000,
        cache_read_tokens: null,
        cache_write_tokens: null,
      },
    },
  ],
  correct_run_ids: ['run-abc'],
  correct_tokens: {
    input_tokens: 1_900_000,
    output_tokens: 42_000,
    cache_read_tokens: null,
    cache_write_tokens: null,
  },
  has_any_correctness_signal: true,
};

const FAIL_EVIDENCE_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const FIXTURE_ASSERTIONS: AssertionResult[] = [
  {
    id: 'I1',
    title: 'One PR per slice',
    status: 'pass',
    evidence: [],
    note: 'no violations found',
  },
  {
    id: 'I6',
    title: 'Spec+plan before implementation',
    status: 'fail',
    evidence: [
      {
        event_id: FAIL_EVIDENCE_ID,
        event_type: 'dispatch-start',
        note: 'no preceding spec-authored',
      },
    ],
    note: 'dispatch-start with no preceding spec-authored/plan-authored',
  },
  {
    id: 'I2',
    title: 'Scope bounded by spec',
    status: 'not-checkable',
    evidence: [],
    note: 'no direct trace signal for scope-bounded check',
  },
];

const FIXTURE_LOAD_ERROR: LoadError = {
  line: 7,
  raw: 'NOT_JSON',
  problem: 'Unexpected token N',
};

const FIXTURE_UNKNOWN_EVENT: UnknownEvent = {
  line: 8,
  raw: '{"event_type":"future-event","event_id":"x"}',
  event_type: 'future-event',
  origin: 'native',
  unknownType: true,
};

const RUN_META = {
  tracePath: 'projects/sample-project/trace.jsonl',
  eventCount: 42,
  projectRunIds: ['run-abc', 'run-def'],
  origin: 'native' as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderReport — header', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions: FIXTURE_ASSERTIONS,
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('contains the trace path', () => {
    assert.ok(report.includes('projects/sample-project/trace.jsonl'));
  });

  it('contains the event count', () => {
    assert.ok(report.includes('42'));
  });

  it('contains all project run IDs', () => {
    assert.ok(report.includes('run-abc'));
    assert.ok(report.includes('run-def'));
  });

  it('shows the origin banner', () => {
    assert.ok(report.includes('native'));
  });
});

describe('renderReport — parse-health banner', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions: FIXTURE_ASSERTIONS,
    loadErrors: [FIXTURE_LOAD_ERROR],
    unknown: [FIXTURE_UNKNOWN_EVENT],
    runMeta: RUN_META,
  });

  it('shows unparseable count', () => {
    assert.ok(report.includes('1 unparseable'));
  });

  it('shows unknown-type count', () => {
    assert.ok(report.includes('1 unknown-type'));
  });
});

describe('renderReport — no banner when no errors', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions: [],
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('does not show the parse-health banner', () => {
    assert.ok(!report.includes('unparseable'));
  });
});

describe('renderReport — null metrics render as n/a (no signal)', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions: [],
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('contains n/a (no signal) for null metrics', () => {
    assert.ok(report.includes('n/a (no signal)'));
  });

  it('includes the note text alongside n/a', () => {
    assert.ok(report.includes('no round-start events'));
  });
});

describe('renderReport — assertion sections', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions: FIXTURE_ASSERTIONS,
    loadErrors: [FIXTURE_LOAD_ERROR],
    unknown: [FIXTURE_UNKNOWN_EVENT],
    runMeta: RUN_META,
  });

  it('groups assertions into Pass/Fail/Not Checkable sections', () => {
    assert.ok(report.includes('Pass'));
    assert.ok(report.includes('Fail'));
    assert.ok(report.includes('Not Checkable'));
  });

  it('includes the failing evidence event_id', () => {
    assert.ok(report.includes(FAIL_EVIDENCE_ID));
  });

  it('includes the not-checkable rationale', () => {
    assert.ok(report.includes('no direct trace signal for scope-bounded check'));
  });

  it('includes assertion IDs', () => {
    assert.ok(report.includes('I1'));
    assert.ok(report.includes('I2'));
    assert.ok(report.includes('I6'));
  });
});

describe('renderReport — mdTable cell escaping', () => {
  const assertions: AssertionResult[] = [
    {
      id: 'NC1',
      title: 'Check with pipe | character',
      status: 'not-checkable',
      evidence: [],
      note: 'rationale with | pipe and\nnewline in note',
    },
  ];
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions,
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('escapes pipe characters in table cells', () => {
    assert.ok(report.includes('\\|'), 'pipe in title/note must be escaped as \\|');
  });

  it('replaces newline in table cells with <br/>', () => {
    assert.ok(report.includes('<br/>'), 'newline in note must become <br/>');
  });

  it('the note text appears on a single unbroken table row', () => {
    const lineWithNote = report.split('\n').find((l) => l.includes('rationale with'));
    assert.ok(lineWithNote !== undefined, 'note text must appear on exactly one line');
    assert.ok(lineWithNote.startsWith('|'), 'that line must be a table row');
  });
});

describe('renderReport — determinism', () => {
  it('renders identically on two successive calls', () => {
    const input = {
      metrics: EMPTY_METRICS,
      scorecard: EMPTY_SCORECARD,
      assertions: FIXTURE_ASSERTIONS,
      loadErrors: [FIXTURE_LOAD_ERROR],
      unknown: [FIXTURE_UNKNOWN_EVENT],
      runMeta: RUN_META,
    };
    assert.equal(renderReport(input), renderReport(input));
  });
});

describe('renderReport — verdict + coverage + provenance', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: EMPTY_SCORECARD,
    assertions: FIXTURE_ASSERTIONS,
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('includes Run verdict line', () => {
    assert.ok(report.includes('Run verdict'));
  });

  it('includes not computable text', () => {
    assert.ok(report.includes('not computable'));
  });

  it('includes Assertion coverage line', () => {
    assert.ok(report.includes('Assertion coverage'));
  });

  it('includes Provenance blockquote', () => {
    assert.ok(report.includes('Provenance'));
  });

  it('no longer claims token usage is "not instrumented"', () => {
    assert.ok(!report.includes('not instrumented'));
  });
});

describe('renderReport — scorecard (no correctness signal)', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: NOT_COMPUTABLE_SCORECARD,
    assertions: [],
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('renders a two-tier Scorecard heading', () => {
    assert.ok(report.includes('## Scorecard'));
    assert.ok(report.includes('Tier 1'));
    assert.ok(report.includes('Tier 2'));
  });

  it('reads not computable and names the missing correctness signal', () => {
    assert.ok(report.includes('not computable'));
    assert.ok(report.includes('correctness-recorded'));
  });

  it('hides Tier 2 efficiency when no run passed Tier 1', () => {
    assert.ok(report.includes('Hidden'));
  });
});

describe('renderReport — scorecard (a CORRECT run)', () => {
  const report = renderReport({
    metrics: EMPTY_METRICS,
    scorecard: CORRECT_SCORECARD,
    assertions: [],
    loadErrors: [],
    unknown: [],
    runMeta: RUN_META,
  });

  it('reports the run as CORRECT', () => {
    assert.ok(report.includes('CORRECT'));
  });

  it('shows Tier 2 token values for the correct run', () => {
    assert.ok(report.includes('1900000'));
  });

  it('renders n/a (no signal) for the null token components', () => {
    assert.ok(report.includes('n/a (no signal)'));
  });
});
