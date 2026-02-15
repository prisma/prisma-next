import assert from 'node:assert';
import { test } from 'node:test';

import {
  getTlsGuidanceMessage,
  isTlsCertError,
  parseCliArgs,
  updateReviewActionsWithGithubAdmin,
} from './apply-review-actions.mjs';

test('parseCliArgs defaults to dry-run text mode', () => {
  const parsed = parseCliArgs(['node', 'script', '--in', 'review-actions.json']);
  assert.deepStrictEqual(parsed, {
    inPath: 'review-actions.json',
    reviewStatePath: null,
    apply: false,
    format: 'text',
    logOutPath: null,
    help: false,
  });
});

test('parseCliArgs supports apply mode with optional flags', () => {
  const parsed = parseCliArgs([
    'node',
    'script',
    '--in',
    'review-actions.json',
    '--review-state',
    'review-state.json',
    '--apply',
    '--format',
    'json',
    '--log-out',
    'apply-log.json',
  ]);
  assert.deepStrictEqual(parsed, {
    inPath: 'review-actions.json',
    reviewStatePath: 'review-state.json',
    apply: true,
    format: 'json',
    logOutPath: 'apply-log.json',
    help: false,
  });
});

test('parseCliArgs validates expected file extensions and format', () => {
  assert.throws(
    () => parseCliArgs(['node', 'script', '--in', 'review-actions.md']),
    (error) => error?.code === 2 && String(error.message).includes('--in file path must end with .json'),
  );
  assert.throws(
    () => parseCliArgs(['node', 'script', '--in', 'review-actions.json', '--format', 'yaml']),
    (error) => error?.code === 2 && String(error.message).includes('--format must be text or json'),
  );
});

test('isTlsCertError detects gh sandbox certificate failures', () => {
  assert.strictEqual(isTlsCertError('x509: OSStatus -26276'), true);
  assert.strictEqual(isTlsCertError('SSL routines:tls_process_server_certificate'), true);
  assert.strictEqual(isTlsCertError('some unrelated error'), false);
});

test('getTlsGuidanceMessage provides fail-fast rerun guidance', () => {
  const guidance = getTlsGuidanceMessage();
  assert.match(guidance, /rerun outside the sandbox/i);
  assert.match(guidance, /do not disable TLS verification/i);
});

test('updateReviewActionsWithGithubAdmin records apply metadata for done actions', () => {
  const reviewActions = {
    version: 1,
    pr: { url: 'https://github.com/owner/repo/pull/123' },
    reviewState: { path: 'review-state.json', fetchedAt: '2026-02-12T00:00:00.000Z' },
    actions: [
      {
        actionId: 'A-001',
        target: { kind: 'review_thread', nodeId: 'PRRT_1' },
        decision: 'will_address',
        summary: 'fix',
        rationale: null,
        status: 'done',
        done: { doneAt: '2026-02-12T00:30:00.000Z' },
      },
      {
        actionId: 'A-002',
        target: { kind: 'review_thread', nodeId: 'PRRT_2' },
        decision: 'defer',
        summary: 'later',
        rationale: null,
        status: 'pending',
        done: null,
      },
    ],
  };

  const summary = {
    mode: 'apply',
    viewerLogin: 'wmadden',
    operations: [],
    results: [
      { actionId: 'A-001', kind: 'reply', targetNodeId: 'PRRT_1', state: 'applied', message: null },
      { actionId: 'A-001', kind: 'react', targetNodeId: 'PRRT_1', state: 'applied', message: null },
      { actionId: 'A-001', kind: 'resolve_thread', targetNodeId: 'PRRT_1', state: 'applied', message: null },
      { actionId: 'A-002', kind: 'noop', targetNodeId: 'PRRT_2', state: 'noop', message: 'skip' },
    ],
  };

  const next = updateReviewActionsWithGithubAdmin(
    reviewActions,
    summary,
    '2026-02-12T01:00:00.000Z',
  );

  assert.strictEqual(
    next.actions[0].done.githubAdmin.appliedAt,
    '2026-02-12T01:00:00.000Z',
  );
  assert.deepStrictEqual(next.actions[0].done.githubAdmin.operations, [
    { kind: 'reply', targetNodeId: 'PRRT_1', state: 'applied', message: null },
    { kind: 'react', targetNodeId: 'PRRT_1', state: 'applied', message: null },
    { kind: 'resolve_thread', targetNodeId: 'PRRT_1', state: 'applied', message: null },
  ]);
  assert.strictEqual(next.actions[1].done, null);
});
