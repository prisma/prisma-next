import assert from 'node:assert';
import { test } from 'node:test';

import {
  deriveOutJsonPath,
  parseCliArgs,
  parsePrUrl,
  renderReviewStateMarkdown,
} from './fetch-review-state.mjs';

test('parseCliArgs rejects unknown flags', () => {
  assert.throws(
    () => parseCliArgs(['node', 'script', '--wat']),
    (error) => error?.code === 2 && String(error.message).includes('unknown flag'),
  );
});

test('parseCliArgs enforces output extensions', () => {
  assert.throws(
    () => parseCliArgs(['node', 'script', '--out', 'review-state.txt']),
    (error) => error?.code === 2 && String(error.message).includes('must end with .md'),
  );
  assert.throws(
    () => parseCliArgs(['node', 'script', '--out-json', 'review-state.txt']),
    (error) => error?.code === 2 && String(error.message).includes('must end with .json'),
  );
});

test('parseCliArgs parses known options', () => {
  const options = parseCliArgs([
    'node',
    'script',
    '--pr',
    'https://github.com/owner/repo/pull/123',
    '--out',
    'review-state.md',
    '--out-json',
    'review-state.json',
  ]);

  assert.deepStrictEqual(options, {
    prUrl: 'https://github.com/owner/repo/pull/123',
    outPath: 'review-state.md',
    outJsonPath: 'review-state.json',
    help: false,
  });
});

test('parsePrUrl parses GitHub pull request URLs', () => {
  assert.strictEqual(parsePrUrl('not a url'), null);
  assert.deepStrictEqual(parsePrUrl('https://github.com/owner/repo/pull/123'), {
    owner: 'owner',
    repo: 'repo',
    number: 123,
  });
});

test('deriveOutJsonPath follows JSON-first defaults', () => {
  assert.strictEqual(deriveOutJsonPath('review-state.md', null), 'review-state.json');
  assert.strictEqual(deriveOutJsonPath('-', null), null);
  assert.strictEqual(deriveOutJsonPath('review-state.md', 'custom.json'), 'custom.json');
});

test('renderReviewStateMarkdown returns deterministic summary output', () => {
  const markdown = renderReviewStateMarkdown({
    fetchedAt: '2026-02-12T00:00:00.000Z',
    sourceBranch: 'feature/review-framework',
    pr: { url: 'https://github.com/owner/repo/pull/123' },
    reviewThreads: [{ nodeId: 'PRRT_1' }],
    reviews: [{ nodeId: 'PRR_1' }, { nodeId: 'PRR_2' }],
    issueComments: [],
  });

  assert.strictEqual(
    markdown,
    [
      '# Review State',
      '',
      'PR: https://github.com/owner/repo/pull/123',
      'FetchedAt: 2026-02-12T00:00:00.000Z',
      'SourceBranch: feature/review-framework',
      '',
      'Unresolved threads: 1',
      'Reviews with body: 2',
      'Issue comments: 0',
      '',
      '',
    ].join('\n'),
  );
});
