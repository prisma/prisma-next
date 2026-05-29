import type { AssertionResult } from './assertions/index.ts';
import type { LoadError, UnknownEvent } from './load.ts';
import type { Metrics } from './metrics.ts';

export type RunMeta = {
  tracePath: string;
  eventCount: number;
  projectRunIds: string[];
  origin: 'native' | 'post-hoc' | 'mixed';
};

export type ReportInput = {
  metrics: Metrics;
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

function mdTable(header: string[], rows: string[][]): string {
  const sep = header.map(() => '---');
  const allRows = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
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
    rows.push(['backtrack ratio', naCell(m.backtrack_ratio_note)]);
  } else {
    rows.push(['backtrack ratio', m.backtrack_ratio.toFixed(3)]);
  }

  if (m.brief_stability === null) {
    rows.push(['brief stability (overall)', naCell(m.brief_stability_note)]);
  } else {
    rows.push(['brief stability (overall)', fmtDist(m.brief_stability.overall)]);
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

  rows.push(['spec stability (count)', String(m.spec_stability.count)]);
  rows.push(['spec stability (reasons)', fmtDist(m.spec_stability.reason_distribution)]);

  rows.push(['plan accuracy (count)', String(m.plan_accuracy.count)]);
  rows.push(['plan accuracy (reasons)', fmtDist(m.plan_accuracy.reason_distribution)]);

  const sizeDists =
    m.plan_accuracy.dispatch_size_distributions.length === 0
      ? '(none)'
      : m.plan_accuracy.dispatch_size_distributions
          .map((d) => `S:${d.S} M:${d.M} L:${d.L} XL:${d.XL}`)
          .join('; ');
  rows.push(['dispatch size distributions', sizeDists]);

  rows.push(['I12 halt rate (count)', String(m.i12_halt_rate.count)]);
  rows.push(['I12 triggered by', fmtDist(m.i12_halt_rate.triggered_by_distribution)]);

  if (m.triage_stability === null) {
    rows.push(['triage stability', naCell(m.triage_stability_note)]);
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
    rows.push(['triage stability', val]);
  }

  return `### Planning Quality\n\n${mdTable(['Metric', 'Value'], rows)}`;
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
      : stabilityEntries.map(([p, ms]) => `${p}: ${fmtMs(ms)}`).join(', ');
  rows.push(['time to stability', stabilityVal]);

  return `### Artefact Churn\n\n${mdTable(['Metric', 'Value'], rows)}`;
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

function renderOperator(m: Metrics['operator']): string {
  const rows: string[][] = [['operator turn count', naCell(m.operator_turn_count_note)]];
  return `### Operator\n\n${mdTable(['Metric', 'Value'], rows)}`;
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
  const { metrics, assertions, loadErrors, unknown, runMeta } = input;

  const lines: string[] = [];

  lines.push('# Drive Diagnostics Report');
  lines.push('');
  lines.push(`**Trace:** ${runMeta.tracePath}`);
  lines.push(`**Events:** ${String(runMeta.eventCount)}`);
  const runIds =
    runMeta.projectRunIds.length === 0 ? '(none)' : runMeta.projectRunIds.slice().sort().join(', ');
  lines.push(`**Run IDs:** ${runIds}`);
  lines.push(`**Origin:** ${runMeta.origin}`);

  if (loadErrors.length > 0 || unknown.length > 0) {
    lines.push('');
    lines.push(
      `> ⚠ ${String(loadErrors.length)} unparseable lines, ${String(unknown.length)} unknown-type events`,
    );
  }

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
  lines.push(renderOperator(metrics.operator));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Assertions');
  lines.push('');
  lines.push(renderAssertions(assertions));
  lines.push('');

  return lines.join('\n');
}
