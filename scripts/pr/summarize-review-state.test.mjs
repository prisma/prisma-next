import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  buildReviewStateSummary,
  renderReviewStateSummaryJson,
  renderReviewStateSummaryText,
} from './summarize-review-state.mjs';

test('renders fixture summary text deterministically', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/review-state.v1.json', import.meta.url), 'utf8'),
  );
  const expected = await readFile(
    new URL('./fixtures/review-state-summary.txt', import.meta.url),
    'utf8',
  );
  const summary = buildReviewStateSummary(fixture);

  assert.strictEqual(renderReviewStateSummaryText(summary), expected);
});

test('renders fixture summary json deterministically', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/review-state.v1.json', import.meta.url), 'utf8'),
  );
  const expected = await readFile(
    new URL('./fixtures/review-state-summary.json', import.meta.url),
    'utf8',
  );
  const summary = buildReviewStateSummary(fixture);

  assert.strictEqual(renderReviewStateSummaryJson(summary), expected);
});

