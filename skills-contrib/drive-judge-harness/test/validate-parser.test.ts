import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import { renderMarkdown, validateFixtures } from '../validate-parser.ts';

const FIX_DIR = fileURLToPath(new URL('./fixtures/transcripts/', import.meta.url));
const FIXTURES = [
  join(FIX_DIR, 'direct-change-diagnostic-wording.transcript.jsonl'),
  join(FIX_DIR, 'slice-cli-list-flag.transcript.jsonl'),
  join(FIX_DIR, 'project-retry-policy.transcript.jsonl'),
];

describe('validateFixtures — corpus of ≥3 transcript fixtures', () => {
  const report = validateFixtures(FIXTURES);

  it('validates exactly three fixtures', () => {
    assert.equal(report.totals.fixtureCount, 3);
    assert.equal(report.fixtures.length, 3);
  });

  it('reconstructs the expected total event count', () => {
    assert.equal(report.totals.reconstructedCount, 12);
  });

  it('produces no high-confidence reconstruction (parser caps at medium)', () => {
    assert.equal(report.totals.byConfidence.high, 0);
  });

  it('splits the corpus evenly between medium (dispatch) and low (spec/plan)', () => {
    assert.equal(report.totals.byConfidence.medium, 6);
    assert.equal(report.totals.byConfidence.low, 6);
  });

  it('reconstructs only a dispatch-start from the direct-change transcript', () => {
    const direct = report.fixtures.find((f) => f.fixture.startsWith('direct-change'));
    assert.ok(direct !== undefined);
    assert.equal(direct.reconstructedCount, 1);
    assert.equal(direct.events[0]?.event_type, 'dispatch-start');
    assert.equal(direct.events[0]?.confidence, 'medium');
  });

  it('reconstructs spec + plan + dispatches from the slice transcript', () => {
    const slice = report.fixtures.find((f) => f.fixture.startsWith('slice-cli'));
    assert.ok(slice !== undefined);
    assert.equal(slice.reconstructedCount, 4);
    assert.equal(slice.byConfidence.medium, 2);
    assert.equal(slice.byConfidence.low, 2);
    assert.equal(slice.operatorTurnCount, 2);
  });

  it('reconstructs three specs + one plan + three dispatches from the project transcript', () => {
    const project = report.fixtures.find((f) => f.fixture.startsWith('project-retry'));
    assert.ok(project !== undefined);
    const specs = project.events.filter((e) => e.event_type === 'spec-authored');
    const plans = project.events.filter((e) => e.event_type === 'plan-authored');
    const dispatches = project.events.filter((e) => e.event_type === 'dispatch-start');
    assert.equal(specs.length, 3);
    assert.equal(plans.length, 1);
    assert.equal(dispatches.length, 3);
  });
});

describe('renderMarkdown', () => {
  it('renders a markdown summary with the confidence table', () => {
    const md = renderMarkdown(validateFixtures(FIXTURES));
    assert.match(md, /# Post-hoc parser validation/);
    assert.match(md, /\| Confidence \| Count \|/);
  });
});
