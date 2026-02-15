import assert from 'node:assert';
import { test } from 'node:test';

import { deriveReviewDirectoryName, parseCliArgs, parsePrUrl } from './review-iterate.mjs';

test('parses GitHub PR URL', () => {
  assert.deepStrictEqual(parsePrUrl('https://github.com/Owner/Repo/pull/123'), {
    owner: 'Owner',
    repo: 'Repo',
    number: 123,
  });
});

test('returns null for non-PR URL', () => {
  assert.strictEqual(parsePrUrl('https://github.com/Owner/Repo/issues/123'), null);
});

test('derives deterministic review directory name', () => {
  assert.strictEqual(
    deriveReviewDirectoryName('https://github.com/Owner/Repo/pull/123'),
    'owner_repo_pr-123',
  );
});

test('parses CLI defaults', () => {
  const parsed = parseCliArgs(['node', 'review-iterate.mjs', '--pr', 'https://github.com/o/r/pull/1']);
  assert.strictEqual(parsed.prUrl, 'https://github.com/o/r/pull/1');
  assert.strictEqual(parsed.reviewsRoot, 'agent-os/specs/review-framework/reviews');
});

test('rejects unknown flag', () => {
  assert.throws(() => parseCliArgs(['node', 'review-iterate.mjs', '--pr', 'https://github.com/o/r/pull/1', '--x']), {
    message: 'error: unknown flag "--x"',
  });
});
