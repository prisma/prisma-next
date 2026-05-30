import { fileURLToPath } from 'node:url';
import { basename } from 'pathe';
import { type Confidence, parseTranscript } from '../drive-diagnose-run/posthoc.ts';

// Validation harness for the post-hoc trace parser (drive-diagnose-run/posthoc.ts).
//
// Runs `parseTranscript` over a corpus of realistic Cursor-transcript fixtures
// and tallies the reconstructed events by event_type × confidence, so the
// parser's reconstruction behaviour can be recorded per-event (clears TML-2728).
// Read-only over `posthoc.ts` — it validates, it does not modify the parser.

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

export type FixtureValidation = {
  fixture: string;
  reconstructedCount: number;
  operatorTurnCount: number;
  events: { event_type: string; confidence: Confidence }[];
  byConfidence: Record<Confidence, number>;
  notes: string[];
};

export type ValidationReport = {
  fixtures: FixtureValidation[];
  totals: {
    fixtureCount: number;
    reconstructedCount: number;
    byConfidence: Record<Confidence, number>;
  };
};

function zeroByConfidence(): Record<Confidence, number> {
  return { high: 0, medium: 0, low: 0 };
}

export function validateFixtures(paths: readonly string[]): ValidationReport {
  const fixtures: FixtureValidation[] = [];
  const totalsByConfidence = zeroByConfidence();
  let totalReconstructed = 0;

  for (const path of paths) {
    const result = parseTranscript(path);
    const byConfidence = zeroByConfidence();
    const events = result.events.map((e) => {
      byConfidence[e.confidence] += 1;
      totalsByConfidence[e.confidence] += 1;
      return { event_type: e.event.event_type, confidence: e.confidence };
    });
    totalReconstructed += result.events.length;
    fixtures.push({
      fixture: basename(path),
      reconstructedCount: result.events.length,
      operatorTurnCount: result.operatorTurnCount,
      events,
      byConfidence,
      notes: result.notes,
    });
  }

  return {
    fixtures,
    totals: {
      fixtureCount: paths.length,
      reconstructedCount: totalReconstructed,
      byConfidence: totalsByConfidence,
    },
  };
}

export function renderMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push('# Post-hoc parser validation', '');
  lines.push(
    `Corpus: ${report.totals.fixtureCount} fixtures · ${report.totals.reconstructedCount} events reconstructed.`,
    '',
  );
  lines.push('| Confidence | Count |', '| --- | --- |');
  for (const c of CONFIDENCES) {
    lines.push(`| ${c} | ${report.totals.byConfidence[c]} |`);
  }
  lines.push('');
  for (const f of report.fixtures) {
    lines.push(
      `## ${f.fixture}`,
      '',
      `- reconstructed events: ${f.reconstructedCount}`,
      `- operator turns: ${f.operatorTurnCount}`,
      `- by confidence: high ${f.byConfidence.high} · medium ${f.byConfidence.medium} · low ${f.byConfidence.low}`,
      '',
      '| Event | Confidence |',
      '| --- | --- |',
    );
    for (const e of f.events) {
      lines.push(`| ${e.event_type} | ${e.confidence} |`);
    }
    lines.push('', `Notes: ${f.notes.join('; ')}`, '');
  }
  return lines.join('\n');
}

function main(): void {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    process.stderr.write(
      'Usage: node skills-contrib/drive-judge-harness/validate-parser.ts <transcript.jsonl>...\n',
    );
    process.exit(1);
  }
  process.stdout.write(`${renderMarkdown(validateFixtures(paths))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
