import assert from 'node:assert';
import { test } from 'node:test';

import {
  assertReviewActionsV1,
  assertReviewStateV1,
  formatCanonicalJson,
  normalizeReactionGroups,
  normalizeReviewStateV1,
  sortIssueComments,
  sortReviewThreads,
  sortReviews,
  sortThreadComments,
  stripReviewFrameworkMarkers,
} from './review-artifacts.mjs';

test('stripReviewFrameworkMarkers strips automation markers from body', () => {
  const body = [
    'First line',
    '<!-- review-framework:actionId=A-001 kind=done -->',
    'Second line',
    '',
  ].join('\n');
  assert.strictEqual(stripReviewFrameworkMarkers(body), 'First line\nSecond line');
});

test('normalizeReactionGroups keeps counts only and sorts by content', () => {
  const normalized = normalizeReactionGroups([
    { content: 'THUMBS_UP', users: { totalCount: 2 }, extra: 'x' },
    { content: 'EYES', users: { totalCount: 1 }, viewerHasReacted: true },
  ]);
  assert.deepStrictEqual(normalized, [
    { content: 'EYES', users: { totalCount: 1 } },
    { content: 'THUMBS_UP', users: { totalCount: 2 } },
  ]);
});

test('sortThreadComments orders by createdAt then nodeId', () => {
  const comments = sortThreadComments([
    { nodeId: 'PRRC_3', createdAt: '2026-02-12T10:00:00.000Z' },
    { nodeId: 'PRRC_2', createdAt: '2026-02-12T09:00:00.000Z' },
    { nodeId: 'PRRC_1', createdAt: '2026-02-12T09:00:00.000Z' },
  ]);
  assert.deepStrictEqual(comments.map((comment) => comment.nodeId), ['PRRC_1', 'PRRC_2', 'PRRC_3']);
});

test('sortReviewThreads orders by path/startLine/earliest comment/nodeId', () => {
  const threads = sortReviewThreads([
    {
      nodeId: 'PRRT_2',
      path: 'b.ts',
      startLine: 10,
      comments: [{ createdAt: '2026-02-12T09:00:00.000Z' }],
    },
    {
      nodeId: 'PRRT_3',
      path: 'a.ts',
      startLine: 2,
      comments: [{ createdAt: '2026-02-12T08:00:00.000Z' }],
    },
    {
      nodeId: 'PRRT_1',
      path: 'a.ts',
      startLine: 2,
      comments: [{ createdAt: '2026-02-12T07:00:00.000Z' }],
    },
  ]);
  assert.deepStrictEqual(threads.map((thread) => thread.nodeId), ['PRRT_1', 'PRRT_3', 'PRRT_2']);
});

test('sortReviews orders by submittedAt then nodeId', () => {
  const reviews = sortReviews([
    { nodeId: 'PRR_2', submittedAt: '2026-02-12T10:00:00.000Z' },
    { nodeId: 'PRR_3', submittedAt: '2026-02-12T09:00:00.000Z' },
    { nodeId: 'PRR_1', submittedAt: '2026-02-12T09:00:00.000Z' },
  ]);
  assert.deepStrictEqual(reviews.map((review) => review.nodeId), ['PRR_1', 'PRR_3', 'PRR_2']);
});

test('sortIssueComments orders by createdAt then nodeId', () => {
  const comments = sortIssueComments([
    { nodeId: 'IC_3', createdAt: '2026-02-12T10:00:00.000Z' },
    { nodeId: 'IC_2', createdAt: '2026-02-12T09:00:00.000Z' },
    { nodeId: 'IC_1', createdAt: '2026-02-12T09:00:00.000Z' },
  ]);
  assert.deepStrictEqual(comments.map((comment) => comment.nodeId), ['IC_1', 'IC_2', 'IC_3']);
});

test('normalizeReviewStateV1 emits canonical node-id-only state', () => {
  const normalized = normalizeReviewStateV1({
    fetchedAt: '2026-02-12T00:00:00.000Z',
    sourceBranch: 'feature/review-framework',
    pr: {
      id: 'PR_1',
      url: 'https://github.com/owner/repo/pull/123',
      number: 123,
      title: 'Title',
      state: 'OPEN',
      headRefName: 'feature/review-framework',
      baseRefName: 'main',
      updatedAt: '2026-02-12T00:00:00.000Z',
    },
    reviewThreads: [
      {
        id: 'PRRT_2',
        isResolved: false,
        isOutdated: false,
        path: 'src/b.ts',
        startLine: 10,
        line: 10,
        comments: {
          nodes: [
            {
              id: 'PRRC_2',
              url: 'https://github.com/owner/repo/pull/123#discussion_r2',
              author: { login: 'reviewer' },
              createdAt: '2026-02-12T10:00:00.000Z',
              body: 'Body<!-- review-framework:actionId=A-001 kind=done -->',
              reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 1 } }],
            },
          ],
        },
      },
      {
        id: 'PRRT_1',
        isResolved: true,
        isOutdated: false,
        path: 'src/a.ts',
        startLine: 1,
        line: 1,
        comments: { nodes: [] },
      },
    ],
    reviews: [
      {
        id: 'PRR_1',
        url: 'https://github.com/owner/repo/pull/123#pullrequestreview-1',
        author: { login: 'reviewer' },
        state: 'COMMENTED',
        submittedAt: '2026-02-12T10:00:00.000Z',
        body: 'Review body',
        reactionGroups: [{ content: 'EYES', users: { totalCount: 2 } }],
      },
      {
        id: 'PRR_2',
        url: 'https://github.com/owner/repo/pull/123#pullrequestreview-2',
        author: { login: 'reviewer' },
        state: 'COMMENTED',
        submittedAt: '2026-02-12T11:00:00.000Z',
        body: '   ',
        reactionGroups: [],
      },
    ],
    issueComments: [
      {
        id: 'IC_PARENT',
        createdAt: '2026-02-12T09:00:00.000Z',
        body: 'Parent',
        author: { login: 'owner' },
        reactionGroups: [],
      },
      {
        id: 'IC_CHILD',
        createdAt: '2026-02-12T09:01:00.000Z',
        body: 'Child',
        author: { login: 'owner' },
        reactionGroups: [],
      },
    ],
  });

  assert.strictEqual(normalized.reviewThreads.length, 1);
  assert.strictEqual(normalized.reviewThreads[0].nodeId, 'PRRT_2');
  assert.strictEqual(normalized.reviewThreads[0].comments[0].body, 'Body');
  assert.strictEqual(normalized.reviews.length, 1);
  assert.strictEqual(normalized.reviews[0].nodeId, 'PRR_1');
  assert.strictEqual(normalized.issueComments[0].nodeId, 'IC_PARENT');
  assert.strictEqual(normalized.issueComments[1].nodeId, 'IC_CHILD');
});

test('assertReviewStateV1 validates v1 schema and rejects unknown versions', () => {
  const validState = {
    version: 1,
    fetchedAt: '2026-02-12T00:00:00.000Z',
    sourceBranch: null,
    pr: {
      url: 'https://github.com/owner/repo/pull/123',
      nodeId: 'PR_1',
      number: 123,
      title: 'Title',
      state: 'OPEN',
      headRefName: 'feature',
      baseRefName: 'main',
      updatedAt: '2026-02-12T00:00:00.000Z',
    },
    reviewThreads: [],
    reviews: [],
    issueComments: [],
  };
  assert.doesNotThrow(() => assertReviewStateV1(validState));

  assert.throws(
    () => assertReviewStateV1({ ...validState, version: 2 }),
    /version must be 1/,
  );
});

test('assertReviewActionsV1 validates v1 schema and decision constraints', () => {
  const validActions = {
    version: 1,
    pr: {
      url: 'https://github.com/owner/repo/pull/123',
      nodeId: 'PR_1',
    },
    reviewState: {
      path: 'review-state.json',
      fetchedAt: '2026-02-12T00:00:00.000Z',
    },
    actions: [
      {
        actionId: 'A-001',
        target: {
          kind: 'review_thread',
          nodeId: 'PRRT_1',
        },
        decision: 'will_address',
        summary: 'Implement deterministic sorting',
        rationale: null,
        status: 'pending',
      },
      {
        actionId: 'A-002',
        target: {
          kind: 'issue_comment',
          nodeId: 'IC_1',
        },
        decision: 'wont_address',
        summary: 'Not in scope',
        rationale: 'The requested change is out of this PR scope',
        status: 'done',
      },
    ],
  };

  assert.doesNotThrow(() => assertReviewActionsV1(validActions));
  assert.throws(
    () =>
      assertReviewActionsV1({
        ...validActions,
        actions: [{ ...validActions.actions[1], rationale: '' }],
      }),
    /rationale must be a non-empty string/,
  );
});

test('formatCanonicalJson uses deterministic formatting', () => {
  const text = formatCanonicalJson({ b: 1, a: 2 });
  assert.strictEqual(text, '{\n  "b": 1,\n  "a": 2\n}\n');
});
