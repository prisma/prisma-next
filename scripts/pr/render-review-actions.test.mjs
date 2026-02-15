import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { renderReviewActionsMarkdown } from './render-review-actions.mjs';

test('renders fixture payload to deterministic markdown', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/review-actions.v1.json', import.meta.url), 'utf8'),
  );
  const expected = await readFile(new URL('./fixtures/review-actions.v1.md', import.meta.url), 'utf8');
  const markdown = renderReviewActionsMarkdown(fixture, {
    sourcePath: 'review-actions.v1.json',
  });

  assert.strictEqual(markdown, expected);
});

test('escapes pipes and normalizes newlines for table safety', () => {
  const markdown = renderReviewActionsMarkdown(
    {
      version: 1,
      pr: { url: 'https://github.com/owner/repo/pull/1' },
      reviewState: {
        path: 'review-state.json',
        fetchedAt: '2026-02-12T00:00:00.000Z',
      },
      actions: [
        {
          actionId: 'A-001',
          target: {
            kind: 'review_thread',
            nodeId: 'PRRT_abc',
            url: 'https://github.com/owner/repo/pull/1#discussion_r123',
          },
          decision: 'will_address',
          summary: 'Title has | pipe\nand newline',
          targetFiles: ['a|b.ts'],
          acceptance: 'ok',
          rationale: null,
          status: 'pending',
        },
      ],
    },
    { sourcePath: 'review-actions.json' },
  );

  assert.match(markdown, /Title has \\| pipe and newline/);
  assert.match(markdown, /`a\\|b\.ts`/);
  assert.ok(markdown.endsWith('\n'));
});

