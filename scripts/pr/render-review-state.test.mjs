import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { renderReviewStateMarkdown } from './render-review-state.mjs';

test('renders fixture payload to deterministic markdown', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/review-state.v1.json', import.meta.url), 'utf8'),
  );
  const expected = await readFile(new URL('./fixtures/review-state.v1.md', import.meta.url), 'utf8');
  const markdown = renderReviewStateMarkdown(fixture, {
    sourcePath: 'review-state.v1.json',
  });

  assert.strictEqual(markdown, expected);
});

