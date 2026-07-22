import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReviewActionsMarkdown } from './render-review-actions.mjs';

function buildPayload() {
  return {
    version: 2,
    pr: { url: 'https://example.com/pr/1' },
    reviewState: {
      path: 'wip/review-state.json',
      fetchedAt: '2026-01-01T00:00:00Z',
      version: 2,
    },
    actions: [
      {
        actionId: 'A1',
        target: {
          kind: 'review_thread',
          nodeId: 'THREAD_1',
          url: 'https://example.com/pr/1#discussion_r1',
        },
        decision: 'will_address',
        summary: 'fix foo \\| bar',
        targetFiles: ['src/a.ts'],
        acceptance: 'trailing \\',
        status: 'pending',
      },
    ],
  };
}

test('escapes backslashes before pipes in table cells', () => {
  const markdown = renderReviewActionsMarkdown(buildPayload(), {
    sourcePath: 'wip/review-actions.json',
  });

  assert.ok(markdown.includes('fix foo \\\\\\| bar'), `expected escaped summary in:\n${markdown}`);
  assert.ok(markdown.includes('trailing \\\\ |'), `expected escaped acceptance in:\n${markdown}`);
});
