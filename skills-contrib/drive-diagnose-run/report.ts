import type { AssertionResult } from './assertions/types.ts';
import type { LoadError, UnknownEvent } from './load.ts';
import type { Metrics } from './metrics.ts';
import type { CorrectnessComponent, RunScore, Scorecard } from './scorecard.ts';

export type RunMeta = {
  tracePath: string;
  eventCount: number;
  projectRunIds: string[];
  origin: 'native' | 'post-hoc' | 'mixed';
  operatorTurnCount?: number | null;
};

export type ReportInput = {
  metrics: Metrics;
  scorecard: Scorecard;
  assertions: AssertionResult[];
  loadErrors: LoadError[];
  unknown: UnknownEvent[];
  runMeta: RunMeta;
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDist(dist: Record<string, number>): string {
  const keys = Object.keys(dist).sort();
  if (keys.length === 0) return '(none)';
  return keys.map((k) => `${k}: ${String(dist[k])}`).join(', ');
}

function fmtMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

function naCell(note: string | undefined): string {
  return `n/a (no signal)${note !== undefined ? ` — ${note}` : ''}`;
}

// ---------------------------------------------------------------------------
// Markdown table
// ---------------------------------------------------------------------------

function escapeMdCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br/>');
}

function mdTable(header: string[], rows: string[][]): string {
  const sep = header.map(() => '---');
  const allRows = [
    `| ${header.map(escapeMdCell).join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(escapeMdCell).join(' | ')} |`),
  ];
  return allRows.join('\n');
}

// ---------------------------------------------------------------------------
// Metrics section renderers
// ---------------------------------------------------------------------------

function renderRework(m: Metrics['rework']): string {
  const rows: string[][] = [];

  if (m.rounds_per_dispatch === null) {
    rows.push(['rounds per dispatch (mean)', naCell(m.rounds_per_dispatch_note)]);
  } else {
    rows.push(['rounds per dispatch (mean)', m.rounds_per_dispatch.mean.toFixed(2)]);
  }

  if (m.first_pass_acceptance_rate === null) {
    rows.push(['first-pass acceptance rate', naCell(m.first_pass_acceptance_rate_note)]);
  } else {
    rows.push([
      'first-pass acceptance rate',
      `${(m.first_pass_acceptance_rate * 100).toFixed(1)}%`,
    ]);
  }

  if (m.backtrack_ratio === null) {
    rows.push(['backtrack ratio (non-satisfied ÷ satisfied)', naCell(m.backtrack_ratio_note)]);
  } else {
    rows.push(['backtrack ratio (non-satisfied ÷ satisfied)', m.backtrack_ratio.toFixed(3)]);
  }

  if (m.brief_stability === null) {
    rows.push(['brief reissues', naCell(m.brief_stability_note)]);
  } else {
    const o = m.brief_stability.overall;
    const total = Object.values(o).reduce((a, b) => a + b, 0);
    const reissues = (o.reissue ?? 0) + (o.amended ?? 0);
    rows.push(['brief reissues', `${String(reissues)} of ${String(total)} (${fmtDist(o)})`]);
  }

  if (m.tier_mix === null) {
    rows.push(['tier mix', naCell(m.tier_mix_note)]);
  } else {
    rows.push(['tier mix', fmtDist(m.tier_mix)]);
  }

  if (m.dispatch_wallclock_ms === null) {
    rows.push(['dispatch wallclock (mean)', naCell(m.dispatch_wallclock_ms_note)]);
    rows.push(['dispatch wallclock (total)', naCell(m.dispatch_wallclock_ms_note)]);
  } else {
    rows.push(['dispatch wallclock (mean)', fmtMs(m.dispatch_wallclock_ms.mean)]);
    rows.push(['dispatch wallclock (total)', fmtMs(m.dispatch_wallclock_ms.total)]);
  }

  if (m.round_wallclock_ms === null) {
    rows.push(['round wallclock', naCell(m.round_wallclock_ms_note)]);
  } else {
    const count = Object.keys(m.round_wallclock_ms).length;
    const total = Object.values(m.round_wallclock_ms).reduce((a, b) => a + b, 0);
    rows.push(['round wallclock (rounds)', String(count)]);
    rows.push(['round wallclock (total)', fmtMs(total)]);
  }

  return `### Rework\n\n${mdTable(['Metric', 'Value'], rows)}`;
}

function renderPlanningQuality(m: Metrics['planning_quality']): string {
  const rows: string[][] = [];

  rows.push(['spec amendments (count)', String(m.spec_amendments.count)]);
  rows.push(['spec amendment reasons', fmtDist(m.spec_amendments.reason_distribution)]);

  rows.push(['plan amendments (count)', String(m.plan_amendments.count)]);
  rows.push(['plan amendment reasons', fmtDist(m.plan_amendments.reason_distribution)]);

  const sizeDists =
    m.dispatch_sizes.length === 0
      ? '(none)'
      : m.dispatch_sizes
          .map(
            ({ plan_path, distribution: d }) =>
              `${plan_path} → S:${d.S} M:${d.M} L:${d.L} XL:${d.XL}`,
          )
          .join('; ');
  rows.push(['planned dispatch sizes (per plan)', sizeDists]);

  rows.push(['I12 halts (count)', String(m.i12_halts.count)]);
  rows.push(['I12 halts triggered by', fmtDist(m.i12_halts.triggered_by_distribution)]);

  if (m.triage_stability === null) {
    rows.push(['triage re-verdicts', naCell(m.triage_stability_note)]);
  } else {
    const entries = Object.entries(m.triage_stability).sort(([a], [b]) => a.localeCompare(b));
    const val =
      entries.length === 0
        ? '(none)'
        : entries
            .map(
              ([ref, info]) =>
                `${ref}: ${info.count} verdict(s), ${info.distinct_verdict_count} distinct`,
            )
            .join('; ');
    rows.push(['triage re-verdicts', val]);
  }

  const note =
    '_Counts of instability events: lower is better; 0 means the artefact held (no amendments / halts)._';
  return `### Planning Quality\n\n${note}\n\n${mdTable(['Metric', 'Value'], rows)}`;
}

function renderArtefactChurn(m: Metrics['artefact_churn']): string {
  const rows: string[][] = [];

  if (m.write_amplification.mean === null) {
    rows.push(['write amplification (mean)', naCell(m.write_amplification.mean_note)]);
  } else {
    rows.push(['write amplification (mean)', m.write_amplification.mean.toFixed(2)]);
  }

  const sortedPaths = Object.entries(m.write_amplification.per_path).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const pathsVal =
    sortedPaths.length === 0
      ? '(none)'
      : sortedPaths.map(([p, c]) => `${p}: ${String(c)}`).join(', ');
  rows.push(['write amplification (paths)', pathsVal]);

  const stabilityEntries = Object.entries(m.time_to_stability_ms.per_path).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const stabilityVal =
    stabilityEntries.length === 0
      ? '(none)'
      : stabilityEntries
          .map(([p, ms]) => `${p}: ${ms === 0 ? '0 ms (no re-amendment)' : fmtMs(ms)}`)
          .join(', ');
  rows.push(['time to stability', stabilityVal]);

  const note =
    '_Write amplification = writes per artefact (authored + amended); 1.00 = authored once, never rewritten (the floor, and the best case)._';
  return `### Artefact Churn\n\n${note}\n\n${mdTable(['Metric', 'Value'], rows)}`;
}

function renderLifecycle(m: Metrics['lifecycle']): string {
  const rows: string[][] = [];

  if (m.project_wallclock_ms === null) {
    rows.push(['project wallclock', naCell(m.project_wallclock_ms_note)]);
  } else {
    rows.push(['project wallclock', fmtMs(m.project_wallclock_ms)]);
  }

  if (m.slice_wallclock_ms === null) {
    rows.push(['slice wallclock', naCell(m.slice_wallclock_ms_note)]);
  } else {
    const entries = Object.entries(m.slice_wallclock_ms).sort(([a], [b]) => a.localeCompare(b));
    const val =
      entries.length === 0
        ? '(none)'
        : entries.map(([slug, ms]) => `${slug}: ${fmtMs(ms)}`).join(', ');
    rows.push(['slice wallclock', val]);
  }

  rows.push(['health checks (count)', String(m.health_check_cadence.count)]);
  rows.push(['health checks (cadence)', fmtDist(m.health_check_cadence.cadence_distribution)]);

  if (m.health_check_cadence.max_drift_severity === null) {
    rows.push([
      'health checks (max severity)',
      naCell(m.health_check_cadence.max_drift_severity_note),
    ]);
  } else {
    rows.push(['health checks (max severity)', m.health_check_cadence.max_drift_severity]);
  }

  rows.push(['retros (count)', String(m.retro_distribution.count)]);
  rows.push(['retros (trigger classes)', fmtDist(m.retro_distribution.trigger_class_distribution)]);
  rows.push([
    'retros (landing surfaces)',
    fmtDist(m.retro_distribution.landing_surfaces_distribution),
  ]);

  return `### Lifecycle\n\n${mdTable(['Metric', 'Value'], rows)}`;
}

function renderOperator(m: Metrics['operator'], turnCountOverride?: number | null): string {
  const value =
    turnCountOverride != null ? String(turnCountOverride) : naCell(m.operator_turn_count_note);
  const rows: string[][] = [['operator turn count', value]];
  const note = '_Token usage is reported in the Scorecard (Tier 2), not here._';
  return `### Operator\n\n${note}\n\n${mdTable(['Metric', 'Value'], rows)}`;
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function renderAssertionCoverage(assertions: AssertionResult[]): string {
  const total = assertions.length;
  if (total === 0) return '**Assertion coverage:** n/a (no assertions)';
  const checkable = assertions.filter((a) => a.status === 'pass' || a.status === 'fail').length;
  const notObservable = total - checkable;
  return `**Assertion coverage:** ${String(checkable)}/${String(total)} checkable (${String(notObservable)} not observable from the trace)`;
}

function renderProvenance(origin: RunMeta['origin']): string {
  const captions: Record<RunMeta['origin'], string> = {
    native:
      '> Provenance: events were appended through the trace path; their values are author-asserted (e.g. round verdicts are written by the emitter, not verified by an external gate). Read the metrics below as *what was recorded*, not *what was independently measured*.',
    'post-hoc':
      '> Provenance: events were reconstructed post-hoc from a transcript — timestamps are absent and counts are best-effort.',
    mixed:
      '> Provenance: mixed native + post-hoc events; post-hoc events are best-effort and timestamp-less. Native values are author-asserted, not independently verified.',
  };
  return captions[origin];
}

// ---------------------------------------------------------------------------
// Two-tier scorecard (the report headline)
// ---------------------------------------------------------------------------

function fmtComponent(c: CorrectnessComponent): string {
  return c === null ? '—' : c;
}

function fmtTokenCell(value: number | null): string {
  return value === null ? naCell(undefined) : String(value);
}

function verdictCell(run: RunScore): string {
  if (run.verdict === 'correct') return 'CORRECT';
  if (run.verdict === 'incorrect') return 'INCORRECT';
  return `not computable (missing: ${run.missing_inputs.join(', ')})`;
}

function renderVerdictLine(scorecard: Scorecard): string {
  if (!scorecard.has_any_correctness_signal) {
    return [
      '**Run verdict — not computable:** no external correctness signal in the trace ',
      '(no `correctness-recorded` event). Tier-1 correctness is sourced outside the run — ',
      "mechanical gates (typecheck / test / lint) + a QA run + the judge's intent verdict. ",
      "Until that signal is recorded, this run's correctness is unknown; ",
      'do not read the all-green metrics below as "good".',
    ].join('');
  }

  const correct = scorecard.runs.filter((r) => r.verdict === 'correct').length;
  const incorrect = scorecard.runs.filter((r) => r.verdict === 'incorrect').length;
  const notComputable = scorecard.runs.filter((r) => r.verdict === 'not-computable');

  const parts: string[] = [];
  if (correct > 0) parts.push(`${String(correct)} CORRECT`);
  if (incorrect > 0) parts.push(`${String(incorrect)} INCORRECT`);
  if (notComputable.length > 0) parts.push(`${String(notComputable.length)} not computable`);

  let line = `**Run verdict:** ${parts.join(', ')}.`;
  if (notComputable.length > 0) {
    const missing = [...new Set(notComputable.flatMap((r) => r.missing_inputs))];
    line += ` Missing inputs for the not-computable run(s): ${missing.join(', ')}.`;
  }
  if (correct === 0) {
    line += ' No run passed the Tier-1 correctness gate — do not read the metrics below as "good".';
  }
  return line;
}

function renderTier1(scorecard: Scorecard): string {
  const rows = scorecard.runs.map((r) => [
    r.run_id,
    fmtComponent(r.correctness?.mechanical ?? null),
    fmtComponent(r.correctness?.qa ?? null),
    fmtComponent(r.correctness?.intent ?? null),
    verdictCell(r),
  ]);

  const table =
    rows.length === 0
      ? '_No runs in the trace._'
      : mdTable(['Run', 'Mechanical', 'QA', 'Intent', 'Verdict'], rows);

  return [
    '### Tier 1 — correctness gate (binary, external)',
    '',
    table,
    '',
    renderVerdictLine(scorecard),
  ].join('\n');
}

function renderTier2(scorecard: Scorecard, metrics: Metrics): string {
  const heading = '### Tier 2 — efficiency (CORRECT runs only)';

  if (scorecard.correct_run_ids.length === 0) {
    const reason = scorecard.has_any_correctness_signal
      ? 'no run was graded CORRECT'
      : 'no correctness signal was recorded';
    return [
      heading,
      '',
      `_Hidden — ${reason}. Scoring an incorrect or ungraded run's efficiency is meaningless, so Tier 2 is gated on Tier 1._`,
    ].join('\n');
  }

  const t = scorecard.correct_tokens;
  const rows: string[][] = [
    ['tokens — input', fmtTokenCell(t.input_tokens)],
    ['tokens — output', fmtTokenCell(t.output_tokens)],
    ['tokens — cache read', fmtTokenCell(t.cache_read_tokens)],
    ['tokens — cache write', fmtTokenCell(t.cache_write_tokens)],
  ];

  if (metrics.lifecycle.project_wallclock_ms !== null) {
    rows.push(['wall-clock (project)', fmtMs(metrics.lifecycle.project_wallclock_ms)]);
  } else if (metrics.rework.dispatch_wallclock_ms !== null) {
    rows.push(['wall-clock (dispatch total)', fmtMs(metrics.rework.dispatch_wallclock_ms.total)]);
  } else {
    rows.push(['wall-clock', naCell(undefined)]);
  }

  if (metrics.rework.rounds_per_dispatch !== null) {
    rows.push([
      'rework (rounds per dispatch, mean)',
      metrics.rework.rounds_per_dispatch.mean.toFixed(2),
    ]);
  } else {
    rows.push(['rework (rounds per dispatch, mean)', naCell(undefined)]);
  }

  const note = `_Scored over ${String(scorecard.correct_run_ids.length)} CORRECT run(s): ${scorecard.correct_run_ids.join(', ')}. Tokens come from the per-run \`tokens-recorded\` feed; wall-clock and rework are trace-wide aggregates (per-run attribution is the experiment engine's remit)._`;

  return [heading, '', note, '', mdTable(['Metric', 'Value'], rows)].join('\n');
}

function renderScorecard(scorecard: Scorecard, metrics: Metrics): string {
  return [
    '## Scorecard',
    '',
    '> Two-tier: **Tier 1** is a binary correctness gate sourced from outside the run; **Tier 2** (efficiency) is scored only over runs that passed Tier 1. Speed never compensates for incorrectness.',
    '',
    renderTier1(scorecard),
    '',
    renderTier2(scorecard, metrics),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Assertions section
// ---------------------------------------------------------------------------

function renderAssertions(assertions: AssertionResult[]): string {
  const pass = assertions
    .filter((a) => a.status === 'pass')
    .sort((a, b) => a.id.localeCompare(b.id));
  const fail = assertions
    .filter((a) => a.status === 'fail')
    .sort((a, b) => a.id.localeCompare(b.id));
  const nc = assertions
    .filter((a) => a.status === 'not-checkable')
    .sort((a, b) => a.id.localeCompare(b.id));

  const passRows = pass.map((a) => [a.id, a.title]);
  const failRows = fail.map((a) => {
    const evidence =
      a.evidence.length === 0
        ? '(none)'
        : a.evidence.map((e) => `${e.event_id} (${e.event_type})`).join(', ');
    return [a.id, a.title, evidence];
  });
  const ncRows = nc.map((a) => [a.id, a.title, a.note]);

  const sections = [
    `### Pass (${pass.length})\n\n${mdTable(['ID', 'Title'], passRows)}`,
    `### Fail (${fail.length})\n\n${mdTable(['ID', 'Title', 'Evidence'], failRows)}`,
    `### Not Checkable (${nc.length})\n\n${mdTable(['ID', 'Title', 'Rationale'], ncRows)}`,
  ];

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderReport(input: ReportInput): string {
  const { metrics, scorecard, assertions, loadErrors, unknown, runMeta } = input;

  const lines: string[] = [];

  lines.push('# Drive Diagnostics Report');
  lines.push('');
  lines.push(`**Trace:** ${runMeta.tracePath}`);
  lines.push(`**Events:** ${String(runMeta.eventCount)}`);
  const runIds =
    runMeta.projectRunIds.length === 0 ? '(none)' : runMeta.projectRunIds.slice().sort().join(', ');
  lines.push(`**Run IDs:** ${runIds}`);
  lines.push(`**Origin:** ${runMeta.origin}`);
  lines.push(renderAssertionCoverage(assertions));

  if (loadErrors.length > 0 || unknown.length > 0) {
    lines.push('');
    lines.push(
      `> ⚠ ${String(loadErrors.length)} unparseable lines, ${String(unknown.length)} unknown-type events`,
    );
  }

  lines.push('');
  lines.push(renderProvenance(runMeta.origin));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(renderScorecard(scorecard, metrics));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push(renderRework(metrics.rework));
  lines.push('');
  lines.push(renderPlanningQuality(metrics.planning_quality));
  lines.push('');
  lines.push(renderArtefactChurn(metrics.artefact_churn));
  lines.push('');
  lines.push(renderLifecycle(metrics.lifecycle));
  lines.push('');
  lines.push(renderOperator(metrics.operator, runMeta.operatorTurnCount));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Assertions');
  lines.push('');
  lines.push(renderAssertions(assertions));
  lines.push('');

  return lines.join('\n');
}
