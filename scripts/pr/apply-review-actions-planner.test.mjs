import assert from 'node:assert';
import { test } from 'node:test';

import { buildDoneReplyBody, hasDonePrefix, planReviewActionOperations } from './apply-review-actions-planner.mjs';

function createReviewActions(actions) {
  return {
    version: 1,
    pr: {
      url: 'https://github.com/owner/repo/pull/123',
      nodeId: 'PR_NODE_1',
    },
    reviewState: {
      path: 'review-state.json',
      fetchedAt: '2026-02-12T00:00:00.000Z',
    },
    actions,
  };
}

test('hasDonePrefix detects standalone done semantics', () => {
  assert.strictEqual(hasDonePrefix('Done'), true);
  assert.strictEqual(hasDonePrefix('Done\nwith context'), true);
  assert.strictEqual(hasDonePrefix('Done with context'), true);
  assert.strictEqual(hasDonePrefix('Not done'), false);
});

test('plans deterministic thread operations for unresolved thread', () => {
  const reviewActions = createReviewActions([
    {
      actionId: 'A-001',
      target: { kind: 'review_thread', nodeId: 'PRRT_1' },
      decision: 'will_address',
      summary: 'Fix issue',
      rationale: null,
      status: 'done',
    },
  ]);

  const operations = planReviewActionOperations({
    reviewActions,
    viewerLogin: 'wmadden',
    githubState: {
      reviewThreads: [
        {
          nodeId: 'PRRT_1',
          isResolved: false,
          comments: [
            {
              nodeId: 'PRRC_1',
              authorLogin: 'reviewer',
              body: 'Please fix',
              reactionGroups: [],
            },
          ],
        },
      ],
      standaloneTargets: [],
    },
  });

  assert.deepStrictEqual(
    operations.map((operation) => operation.kind),
    ['reply', 'react', 'resolve_thread'],
  );
  assert.strictEqual(operations[0].body, buildDoneReplyBody('A-001'));
  assert.strictEqual(operations[1].subjectNodeId, 'PRRC_1');
});

test('emits noop operations when ensure conditions are already met', () => {
  const reviewActions = createReviewActions([
    {
      actionId: 'A-002',
      target: { kind: 'review_thread', nodeId: 'PRRT_2' },
      decision: 'will_address',
      summary: 'Fix issue',
      rationale: null,
      status: 'done',
    },
  ]);

  const operations = planReviewActionOperations({
    reviewActions,
    viewerLogin: 'wmadden',
    githubState: {
      reviewThreads: [
        {
          nodeId: 'PRRT_2',
          isResolved: true,
          comments: [
            {
              nodeId: 'PRRC_2',
              authorLogin: 'wmadden',
              body: buildDoneReplyBody('A-002'),
              reactionGroups: [{ content: 'THUMBS_UP', viewerHasReacted: true }],
            },
          ],
        },
      ],
      standaloneTargets: [],
    },
  });

  assert.deepStrictEqual(
    operations.map((operation) => operation.reason),
    ['done_reply_exists', 'reaction_exists', 'thread_resolved'],
  );
});

test('applies standalone done detection from current user replies', () => {
  const reviewActions = createReviewActions([
    {
      actionId: 'A-003',
      target: { kind: 'issue_comment', nodeId: 'IC_1' },
      decision: 'will_address',
      summary: 'Mark done',
      rationale: null,
      status: 'done',
    },
  ]);

  const operations = planReviewActionOperations({
    reviewActions,
    viewerLogin: 'wmadden',
    githubState: {
      reviewThreads: [],
      standaloneTargets: [
        {
          nodeId: 'IC_1',
          replies: [
            {
              nodeId: 'IC_REPLY_1',
              authorLogin: 'wmadden',
              body: 'Done with implementation details',
            },
          ],
          reactionGroups: [{ content: 'THUMBS_UP', viewerHasReacted: false }],
        },
      ],
    },
  });

  assert.deepStrictEqual(
    operations.map((operation) => operation.kind),
    ['noop', 'react'],
  );
  assert.strictEqual(operations[0].reason, 'standalone_done_reply_exists');
});

test('keeps stable operation ordering by action order', () => {
  const reviewActions = createReviewActions([
    {
      actionId: 'A-010',
      target: { kind: 'review_thread', nodeId: 'PRRT_A' },
      decision: 'will_address',
      summary: 'first',
      rationale: null,
      status: 'done',
    },
    {
      actionId: 'A-009',
      target: { kind: 'review_thread', nodeId: 'PRRT_B' },
      decision: 'will_address',
      summary: 'second',
      rationale: null,
      status: 'done',
    },
  ]);

  const operations = planReviewActionOperations({
    reviewActions,
    viewerLogin: 'wmadden',
    githubState: {
      reviewThreads: [
        {
          nodeId: 'PRRT_A',
          isResolved: false,
          comments: [{ nodeId: 'PRRC_A', authorLogin: 'reviewer', body: 'a', reactionGroups: [] }],
        },
        {
          nodeId: 'PRRT_B',
          isResolved: false,
          comments: [{ nodeId: 'PRRC_B', authorLogin: 'reviewer', body: 'b', reactionGroups: [] }],
        },
      ],
      standaloneTargets: [],
    },
  });

  assert.deepStrictEqual(
    operations.map((operation) => operation.actionId),
    ['A-010', 'A-010', 'A-010', 'A-009', 'A-009', 'A-009'],
  );
});

test('returns noop for non-done and non-will_address actions', () => {
  const reviewActions = createReviewActions([
    {
      actionId: 'A-020',
      target: { kind: 'review_thread', nodeId: 'PRRT_A' },
      decision: 'defer',
      summary: 'not now',
      rationale: null,
      status: 'pending',
    },
    {
      actionId: 'A-021',
      target: { kind: 'review_thread', nodeId: 'PRRT_B' },
      decision: 'will_address',
      summary: 'in progress',
      rationale: null,
      status: 'in_progress',
    },
  ]);

  const operations = planReviewActionOperations({
    reviewActions,
    viewerLogin: 'wmadden',
    githubState: {
      reviewThreads: [],
      standaloneTargets: [],
    },
  });

  assert.deepStrictEqual(
    operations.map((operation) => operation.reason),
    ['decision_not_will_address', 'status_not_done'],
  );
});
