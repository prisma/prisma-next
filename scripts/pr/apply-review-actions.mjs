#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertReviewActionsV1, assertReviewStateV1, formatCanonicalJson } from './review-artifacts.mjs';
import { planReviewActionOperations } from './apply-review-actions-planner.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

const TLS_ERROR_PATTERNS = [
  /x509:/i,
  /OSStatus -26276/i,
  /certificate/i,
  /SSL routines/i,
  /unable to get local issuer certificate/i,
  /CERTIFICATE_VERIFY_FAILED/i,
];

function getHelpText() {
  return [
    'Usage:',
    '  apply-review-actions.mjs --in <review-actions.json> [--review-state <review-state.json>] [--apply] [--dry-run] [--format text|json] [--log-out <apply-log.json>] [--help]',
    '',
    'Purpose:',
    '  Plan and optionally apply idempotent GitHub review admin actions.',
    '',
    'Flags:',
    '  --in <path.json>           Input path to review-actions.json.',
    '  --review-state <path.json> Optional review-state.json for planner state.',
    '  --dry-run                  Plan only (default).',
    '  --apply                    Execute planned GitHub mutations.',
    '  --format text|json         Output format. Defaults to text.',
    '  --log-out <path.json>      Optional apply-log.json output path.',
    '  --help                     Show this help text and exit.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = {
    inPath: null,
    reviewStatePath: null,
    apply: false,
    format: 'text',
    logOutPath: null,
    help: false,
  };

  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--apply') {
      result.apply = true;
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      result.apply = false;
      index += 1;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    if (index + 1 >= args.length) {
      throw { code: EXIT_CLI, message: `error: ${arg} requires a value` };
    }
    const value = args[index + 1];
    if (arg === '--in') {
      result.inPath = value;
    } else if (arg === '--review-state') {
      result.reviewStatePath = value;
    } else if (arg === '--format') {
      result.format = value;
    } else if (arg === '--log-out') {
      result.logOutPath = value;
    } else {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    index += 2;
  }

  if (!result.inPath) {
    throw { code: EXIT_CLI, message: 'error: --in is required' };
  }
  if (result.inPath !== '-' && !result.inPath.endsWith('.json')) {
    throw { code: EXIT_CLI, message: 'error: --in file path must end with .json' };
  }
  if (
    result.reviewStatePath !== null &&
    result.reviewStatePath !== '-' &&
    !result.reviewStatePath.endsWith('.json')
  ) {
    throw { code: EXIT_CLI, message: 'error: --review-state file path must end with .json' };
  }
  if (result.format !== 'text' && result.format !== 'json') {
    throw { code: EXIT_CLI, message: 'error: --format must be text or json' };
  }
  if (
    result.logOutPath !== null &&
    result.logOutPath !== '-' &&
    !result.logOutPath.endsWith('.json')
  ) {
    throw { code: EXIT_CLI, message: 'error: --log-out file path must end with .json' };
  }
  return result;
}

function isTlsCertError(stderrOrMessage) {
  const text = String(stderrOrMessage ?? '');
  return TLS_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function getTlsGuidanceMessage() {
  return [
    'error: GitHub API TLS/certificate validation failed in this environment.',
    'rerun outside the sandbox so gh can use the system certificate store.',
    'do not disable TLS verification (no GH_NO_VERIFY_SSL, no curl -k).',
  ].join('\n');
}

function runGhGraphql(query, variables) {
  const payload = JSON.stringify({ query, variables });
  const result = spawnSync('gh', ['api', 'graphql', '--input', '-'], {
    encoding: 'utf-8',
    input: payload,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ?? '';
    if (isTlsCertError(stderr)) {
      throw new Error(getTlsGuidanceMessage());
    }
    throw new Error(stderr.trim() || 'error: gh api graphql failed');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('error: gh api graphql returned invalid JSON');
  }
}

function assertNoGraphqlErrors(response) {
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    const message = response.errors
      .map((entry) => String(entry?.message ?? 'unknown GraphQL error'))
      .join('; ');
    throw new Error(`error: GitHub GraphQL error: ${message}`);
  }
}

function parseReviewStateToPlannerState(reviewState) {
  const reviewThreads = reviewState.reviewThreads.map((thread) => ({
    nodeId: thread.nodeId,
    isResolved: thread.isResolved === true,
    comments: thread.comments.map((comment) => ({
      nodeId: comment.nodeId,
      authorLogin: comment.author?.login ?? null,
      body: comment.body ?? '',
      reactionGroups: [],
    })),
  }));

  const standaloneTargets = [];
  for (const review of reviewState.reviews) {
    standaloneTargets.push({
      nodeId: review.nodeId,
      replies: [],
      reactionGroups: [],
    });
  }
  for (const issueComment of reviewState.issueComments) {
    standaloneTargets.push({
      nodeId: issueComment.nodeId,
      replies: (issueComment.replies ?? []).map((reply) => ({
        nodeId: reply.nodeId,
        authorLogin: reply.author?.login ?? null,
        body: reply.body ?? '',
        reactionGroups: [],
      })),
      reactionGroups: [],
    });
  }

  return { reviewThreads, standaloneTargets };
}

function groupActionTargetsByKind(reviewActions) {
  const reviewThreadIds = [];
  const standaloneIds = [];
  for (const action of reviewActions.actions) {
    if (action.decision !== 'will_address' || action.status !== 'done') {
      continue;
    }
    if (action.target.kind === 'review_thread') {
      reviewThreadIds.push(action.target.nodeId);
    } else {
      standaloneIds.push(action.target.nodeId);
    }
  }
  return {
    reviewThreadIds: [...new Set(reviewThreadIds)],
    standaloneIds: [...new Set(standaloneIds)],
  };
}

const TARGET_STATE_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on PullRequestReviewThread {
        id
        isResolved
        comments(first: 100) {
          nodes {
            id
            body
            author { login }
            reactionGroups {
              content
              viewerHasReacted
            }
          }
        }
      }
      ... on PullRequestReviewComment {
        id
        body
        author { login }
        reactionGroups {
          content
          viewerHasReacted
        }
      }
      ... on PullRequestReview {
        id
        body
        author { login }
        reactionGroups {
          content
          viewerHasReacted
        }
      }
      ... on IssueComment {
        id
        body
        author { login }
        reactionGroups {
          content
          viewerHasReacted
        }
      }
    }
  }
`;

const VIEWER_QUERY = `
  query {
    viewer {
      login
    }
  }
`;

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function normalizeTargetNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const nodeId = typeof node.id === 'string' ? node.id : null;
  if (!nodeId) {
    return null;
  }

  if (node.__typename === 'PullRequestReviewThread') {
    return {
      kind: 'review_thread',
      nodeId,
      isResolved: node.isResolved === true,
      comments: (node.comments?.nodes ?? []).map((comment) => ({
        nodeId: comment?.id ?? null,
        authorLogin: comment?.author?.login ?? null,
        body: comment?.body ?? '',
        reactionGroups: (comment?.reactionGroups ?? []).map((group) => ({
          content: group?.content ?? null,
          viewerHasReacted: group?.viewerHasReacted === true,
        })),
      })),
    };
  }

  return {
    kind: 'standalone',
    nodeId,
    replies: [],
    reactionGroups: (node.reactionGroups ?? []).map((group) => ({
      content: group?.content ?? null,
      viewerHasReacted: group?.viewerHasReacted === true,
    })),
  };
}

function mergePlannerStates(baseState, liveState) {
  const reviewThreads = [...(baseState?.reviewThreads ?? [])];
  const standaloneTargets = [...(baseState?.standaloneTargets ?? [])];

  const threadById = new Map(reviewThreads.map((thread) => [thread.nodeId, thread]));
  const standaloneById = new Map(standaloneTargets.map((target) => [target.nodeId, target]));

  for (const thread of liveState.reviewThreads) {
    threadById.set(thread.nodeId, thread);
  }
  for (const target of liveState.standaloneTargets) {
    standaloneById.set(target.nodeId, target);
  }

  return {
    reviewThreads: [...threadById.values()],
    standaloneTargets: [...standaloneById.values()],
  };
}

function fetchLivePlannerState(reviewActions, existingState) {
  const targetGroups = groupActionTargetsByKind(reviewActions);
  const allTargetIds = [...targetGroups.reviewThreadIds, ...targetGroups.standaloneIds];
  if (allTargetIds.length === 0) {
    return existingState;
  }

  const liveState = { reviewThreads: [], standaloneTargets: [] };
  const chunks = chunkArray(allTargetIds, 50);
  for (const ids of chunks) {
    const response = runGhGraphql(TARGET_STATE_QUERY, { ids });
    assertNoGraphqlErrors(response);
    const nodes = Array.isArray(response?.data?.nodes) ? response.data.nodes : [];
    for (const node of nodes) {
      const normalized = normalizeTargetNode(node);
      if (!normalized) {
        continue;
      }
      if (normalized.kind === 'review_thread') {
        liveState.reviewThreads.push(normalized);
      } else {
        liveState.standaloneTargets.push(normalized);
      }
    }
  }

  return mergePlannerStates(existingState, liveState);
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

function formatTextOutput(summary) {
  const lines = [];
  lines.push('Apply Review Actions');
  lines.push(`Mode: ${summary.mode}`);
  lines.push(`Viewer: ${summary.viewerLogin}`);
  lines.push(`Total operations: ${summary.operations.length}`);
  lines.push(`Mutations attempted: ${summary.results.filter((result) => result.state !== 'noop').length}`);
  lines.push('');
  for (const operation of summary.operations) {
    const base = `[${operation.actionId}] ${operation.kind} ${operation.targetNodeId}`;
    if (operation.kind === 'noop') {
      lines.push(`${base} (${operation.reason})`);
    } else {
      lines.push(base);
    }
  }
  lines.push('');
  lines.push('Results');
  for (const result of summary.results) {
    lines.push(
      `- [${result.actionId}] ${result.kind} ${result.targetNodeId}: ${result.state}${result.message ? ` (${result.message})` : ''}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function writeOutput(path, text) {
  if (!path || path === '-') {
    process.stdout.write(text);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

function readViewerLogin() {
  const response = runGhGraphql(VIEWER_QUERY, {});
  assertNoGraphqlErrors(response);
  const login = response?.data?.viewer?.login;
  if (typeof login !== 'string' || login.length === 0) {
    throw new Error('error: unable to determine gh viewer login');
  }
  return login;
}

const MUTATION_REPLY_THREAD = `
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(
      input: {
        pullRequestReviewThreadId: $threadId
        body: $body
      }
    ) {
      comment { id }
    }
  }
`;

const MUTATION_REACT = `
  mutation($subjectId: ID!, $content: ReactionContent!) {
    addReaction(
      input: {
        subjectId: $subjectId
        content: $content
      }
    ) {
      reaction { content }
    }
  }
`;

const MUTATION_RESOLVE_THREAD = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;

const MUTATION_ADD_COMMENT = `
  mutation($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      comment { id }
    }
  }
`;

function executeOperation(operation) {
  if (operation.kind === 'noop') {
    return { state: 'noop', message: operation.reason ?? null };
  }

  if (operation.kind === 'reply') {
    if (operation.mutationTargetKind === 'review_thread') {
      const response = runGhGraphql(MUTATION_REPLY_THREAD, {
        threadId: operation.targetNodeId,
        body: operation.body,
      });
      assertNoGraphqlErrors(response);
      return { state: 'applied', message: null };
    }
    if (
      (operation.mutationTargetKind === 'issue_comment' ||
        operation.mutationTargetKind === 'pull_request_review') &&
      typeof operation.subjectIdForComment === 'string' &&
      operation.subjectIdForComment.length > 0
    ) {
      const response = runGhGraphql(MUTATION_ADD_COMMENT, {
        subjectId: operation.subjectIdForComment,
        body: operation.body,
      });
      assertNoGraphqlErrors(response);
      return { state: 'applied', message: null };
    }
    return { state: 'skipped', message: 'reply_missing_subject_or_unsupported_target' };
  }

  if (operation.kind === 'react') {
    const response = runGhGraphql(MUTATION_REACT, {
      subjectId: operation.subjectNodeId,
      content: operation.reaction,
    });
    assertNoGraphqlErrors(response);
    return { state: 'applied', message: null };
  }

  if (operation.kind === 'resolve_thread') {
    const response = runGhGraphql(MUTATION_RESOLVE_THREAD, {
      threadId: operation.targetNodeId,
    });
    assertNoGraphqlErrors(response);
    return { state: 'applied', message: null };
  }

  return { state: 'skipped', message: 'unknown_operation_kind' };
}

function buildSummary({ mode, viewerLogin, operations, results }) {
  return {
    version: 1,
    mode,
    viewerLogin,
    operations,
    results,
  };
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const reviewActions = await readJson(args.inPath);
  assertReviewActionsV1(reviewActions);

  let plannerState = { reviewThreads: [], standaloneTargets: [] };
  if (args.reviewStatePath) {
    const reviewState = await readJson(args.reviewStatePath);
    assertReviewStateV1(reviewState);
    plannerState = parseReviewStateToPlannerState(reviewState);
  }

  const viewerLogin = readViewerLogin();
  plannerState = fetchLivePlannerState(reviewActions, plannerState);

  const operations = planReviewActionOperations({
    reviewActions,
    viewerLogin,
    githubState: plannerState,
  });

  const mode = args.apply ? 'apply' : 'dry-run';
  const results = [];
  for (const operation of operations) {
    if (!args.apply) {
      results.push({
        actionId: operation.actionId,
        kind: operation.kind,
        targetNodeId: operation.targetNodeId,
        state: operation.kind === 'noop' ? 'noop' : 'planned',
        message: operation.kind === 'noop' ? operation.reason ?? null : null,
      });
      continue;
    }

    const executionResult = executeOperation(operation);
    results.push({
      actionId: operation.actionId,
      kind: operation.kind,
      targetNodeId: operation.targetNodeId,
      state: executionResult.state,
      message: executionResult.message,
    });
  }

  const summary = buildSummary({ mode, viewerLogin, operations, results });
  const output =
    args.format === 'json' ? formatCanonicalJson(summary) : formatTextOutput(summary);
  process.stdout.write(output);

  if (args.logOutPath) {
    await writeOutput(args.logOutPath, formatCanonicalJson(summary));
  }
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    const message = error?.message ? String(error.message) : String(error);
    if (isTlsCertError(message)) {
      process.stderr.write(`${getTlsGuidanceMessage()}\n`);
      process.exit(EXIT_OPERATIONAL);
    }
    const code = typeof error?.code === 'number' ? error.code : EXIT_OPERATIONAL;
    process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}

export { getTlsGuidanceMessage, isTlsCertError, parseCliArgs };
