#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = {
    help: false,
    repo: null,
    prNumber: null,
    commentNodeId: null,
    body: null,
    bodyFile: null,
  };

  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      arg !== '--repo' &&
      arg !== '--pr' &&
      arg !== '--comment-node-id' &&
      arg !== '--body' &&
      arg !== '--body-file'
    ) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: `error: ${arg} requires a value` };
    }
    const value = args[index];
    if (arg === '--repo') result.repo = value;
    if (arg === '--pr') result.prNumber = value;
    if (arg === '--comment-node-id') result.commentNodeId = value;
    if (arg === '--body') result.body = value;
    if (arg === '--body-file') result.bodyFile = value;
  }

  if (!result.repo) {
    throw { code: EXIT_CLI, message: 'error: --repo is required (OWNER/REPO)' };
  }
  if (!result.prNumber || Number.isNaN(Number.parseInt(result.prNumber, 10))) {
    throw { code: EXIT_CLI, message: 'error: --pr is required (integer pull request number)' };
  }
  if (!result.commentNodeId) {
    throw { code: EXIT_CLI, message: 'error: --comment-node-id is required' };
  }
  if (!result.body && !result.bodyFile) {
    throw { code: EXIT_CLI, message: 'error: provide exactly one of --body or --body-file' };
  }
  if (result.body && result.bodyFile) {
    throw { code: EXIT_CLI, message: 'error: provide only one of --body or --body-file' };
  }

  return result;
}

function getHelpText() {
  return [
    'Usage:',
    '  post-review-thread-reply.mjs --repo <OWNER/REPO> --pr <NUMBER> --comment-node-id <NODE_ID> (--body <TEXT> | --body-file <PATH>)',
    '',
    'Purpose:',
    '  Post a reply to the top-level review comment for a review thread target.',
    '  Resolves PullRequestReviewComment node ID to database ID using gh + jq.',
  ].join('\n');
}

function run(command, args, input = null) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: input ?? undefined,
  });
  if (result.error) {
    throw new Error(`error: failed to execute ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`error: ${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout;
}

function assertCommandAvailable(command, installHint) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `error: required dependency "${command}" is not available. Install ${installHint} and retry.`,
    );
  }
}

function jqRead(jsonText, query) {
  return run('jq', ['-r', query], jsonText).trim();
}

function resolveCommentDatabaseId(commentNodeId) {
  const query = [
    'query($id:ID!){',
    '  node(id:$id){',
    '    ... on PullRequestReviewComment {',
    '      databaseId',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const response = run('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `id=${commentNodeId}`]);
  const databaseIdText = jqRead(response, '.data.node.databaseId // empty');
  if (!databaseIdText) {
    throw new Error('error: failed to resolve PullRequestReviewComment.databaseId from node ID');
  }
  const databaseId = Number.parseInt(databaseIdText, 10);
  if (Number.isNaN(databaseId)) {
    throw new Error(`error: invalid databaseId received from API: ${databaseIdText}`);
  }
  return databaseId;
}

function readBody(body, bodyFile) {
  if (body !== null) {
    return body;
  }
  return readFileSync(resolve(bodyFile), 'utf8');
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  assertCommandAvailable('gh', 'GitHub CLI (`gh`)');
  assertCommandAvailable('jq', '`jq` (for example: `brew install jq`)');

  const commentDatabaseId = resolveCommentDatabaseId(args.commentNodeId);
  const body = readBody(args.body, args.bodyFile);

  const postResponse = run('gh', [
    'api',
    `repos/${args.repo}/pulls/${args.prNumber}/comments`,
    '--method',
    'POST',
    '-f',
    `body=${body}`,
    '-F',
    `in_reply_to=${commentDatabaseId}`,
  ]);

  const replyId = jqRead(postResponse, '.id // empty');
  if (!replyId) {
    throw new Error('error: reply was posted but response did not include a comment id');
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      replyCommentId: Number.parseInt(replyId, 10),
      inReplyTo: commentDatabaseId,
      commentNodeId: args.commentNodeId,
    }) + '\n',
  );
}

const isMain =
  (() => {
    try {
      const invokedScriptPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null;
      const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
      return invokedScriptPath !== null && invokedScriptPath === currentModulePath;
    } catch {
      return false;
    }
  })();

if (isMain) {
  main().catch((error) => {
    const code = typeof error?.code === 'number' ? error.code : EXIT_OPERATIONAL;
    const message = error?.message ? String(error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}
