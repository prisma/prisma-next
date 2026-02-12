#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertReviewStateV1,
  formatCanonicalJson,
  normalizeReviewStateV1,
} from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

const THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $threadsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        url
        number
        title
        state
        headRefName
        baseRefName
        updatedAt
        reviewThreads(first: 100, after: $threadsCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            startLine
            line
            originalStartLine
            originalLine
            comments(first: 100) {
              nodes {
                id
                url
                author { login }
                createdAt
                body
                reactionGroups { content users { totalCount } }
              }
            }
          }
        }
      }
    }
  }
`;

const REVIEWS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $reviewsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviews(first: 100, after: $reviewsCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            url
            author { login }
            state
            submittedAt
            body
            reactionGroups { content users { totalCount } }
          }
        }
      }
    }
  }
`;

const COMMENTS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $commentsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        comments(first: 100, after: $commentsCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            url
            author { login }
            createdAt
            body
            reactionGroups { content users { totalCount } }
          }
        }
      }
    }
  }
`;

function getHelpText() {
  return [
    'Usage:',
    '  fetch-review-state.mjs [--pr <url>] [--out <path.md>|-] [--out-json <path.json>|-] [--help]',
    '',
    'Purpose:',
    '  Fetch unresolved review threads, submitted review bodies, and PR issue comments.',
    '  Emit canonical review-state.json (v1 node-id-only). Markdown is derived output.',
    '',
    'Flags:',
    '  --pr <url>          GitHub pull request URL (for example: https://github.com/OWNER/REPO/pull/123).',
    '                      If omitted, the script attempts to discover the PR for the current git branch.',
    '  --out <path.md>|-   Markdown output path. Use "-" (or omit) to write markdown to stdout.',
    '  --out-json <path.json>|-',
    '                      JSON output path. If omitted and --out is a file path, defaults to same path with .json.',
    '  --help              Show this help text and exit.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { prUrl: null, outPath: null, outJsonPath: null, help: false };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  const knownFlags = new Set(['--pr', '--out', '--out-json']);
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (!arg.startsWith('--') || !knownFlags.has(arg)) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }

    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: `error: ${arg} requires a value` };
    }

    const value = args[index];
    if (arg === '--pr') {
      result.prUrl = value;
    } else if (arg === '--out') {
      result.outPath = value;
    } else if (arg === '--out-json') {
      result.outJsonPath = value;
    }
    index += 1;
  }

  if (result.outPath !== null && result.outPath !== '-' && !result.outPath.endsWith('.md')) {
    throw { code: EXIT_CLI, message: 'error: --out file path must end with .md' };
  }
  if (
    result.outJsonPath !== null &&
    result.outJsonPath !== '-' &&
    !result.outJsonPath.endsWith('.json')
  ) {
    throw { code: EXIT_CLI, message: 'error: --out-json file path must end with .json' };
  }

  return result;
}

function parsePrUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    return null;
  }

  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/)?(?:#.*)?$/i);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    number: Number.parseInt(match[3], 10),
  };
}

function runSync(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    input: input ?? undefined,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function checkPreconditions() {
  const git = runSync('which', ['git']);
  if (git.status !== 0) {
    return { ok: false, code: EXIT_OPERATIONAL, message: 'error: git not found on PATH' };
  }

  const gh = runSync('which', ['gh']);
  if (gh.status !== 0) {
    return { ok: false, code: EXIT_OPERATIONAL, message: 'error: gh not found on PATH' };
  }

  const auth = runSync('gh', ['auth', 'status']);
  if (auth.status !== 0) {
    return {
      ok: false,
      code: EXIT_OPERATIONAL,
      message: 'error: gh is not authenticated; run "gh auth login" and try again',
    };
  }

  return { ok: true };
}

function getCurrentBranch() {
  const result = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function discoverPrUrl(branchName) {
  const result = runSync('gh', [
    'pr',
    'list',
    '--head',
    branchName,
    '--state',
    'all',
    '--json',
    'url',
  ]);

  if (result.status !== 0) {
    return { code: EXIT_OPERATIONAL, error: 'error: gh pr list failed' };
  }

  let list;
  try {
    list = JSON.parse(result.stdout);
  } catch {
    return { code: EXIT_OPERATIONAL, error: 'error: gh pr list returned invalid JSON' };
  }

  if (!Array.isArray(list) || list.length === 0) {
    return {
      code: EXIT_OPERATIONAL,
      error: `error: no pull request found for current branch "${branchName}"; pass --pr <url>`,
    };
  }

  if (list.length > 1) {
    return {
      code: EXIT_OPERATIONAL,
      error: `error: multiple pull requests found for current branch "${branchName}"; pass --pr <url>`,
    };
  }

  return { url: list[0].url };
}

function fetchGraphQL(query, variables) {
  const body = JSON.stringify({ query, variables });
  const result = runSync('gh', ['api', 'graphql', '--input', '-'], body);
  if (result.status !== 0) {
    return { code: EXIT_OPERATIONAL, error: result.stderr || 'error: GitHub API request failed' };
  }

  try {
    return { data: JSON.parse(result.stdout) };
  } catch {
    return { code: EXIT_OPERATIONAL, error: 'error: GitHub API returned invalid JSON' };
  }
}

function paginateConnection(owner, repo, number, query, cursorVar, cursorValue) {
  const response = fetchGraphQL(query, {
    owner,
    repo,
    number,
    [cursorVar]: cursorValue ?? null,
  });

  if (response.error) {
    return response;
  }

  const pr = response.data?.data?.repository?.pullRequest;
  if (!pr) {
    return { code: EXIT_OPERATIONAL, error: 'error: pull request not found in GraphQL response' };
  }

  return { pr };
}

function paginateAll(owner, repo, number) {
  let pr = null;
  let reviewThreads = [];
  let threadCursor = null;

  for (;;) {
    const page = paginateConnection(owner, repo, number, THREADS_QUERY, 'threadsCursor', threadCursor);
    if (page.error) {
      return page;
    }
    pr = page.pr;
    const connection = page.pr.reviewThreads;
    reviewThreads = reviewThreads.concat(connection?.nodes ?? []);
    if (!connection?.pageInfo?.hasNextPage) {
      break;
    }
    threadCursor = connection.pageInfo.endCursor;
  }

  let reviews = [];
  let reviewCursor = null;
  for (;;) {
    const page = paginateConnection(owner, repo, number, REVIEWS_QUERY, 'reviewsCursor', reviewCursor);
    if (page.error) {
      return page;
    }
    const connection = page.pr.reviews;
    reviews = reviews.concat(connection?.nodes ?? []);
    if (!connection?.pageInfo?.hasNextPage) {
      break;
    }
    reviewCursor = connection.pageInfo.endCursor;
  }

  let issueComments = [];
  let commentsCursor = null;
  for (;;) {
    const page = paginateConnection(owner, repo, number, COMMENTS_QUERY, 'commentsCursor', commentsCursor);
    if (page.error) {
      return page;
    }
    const connection = page.pr.comments;
    issueComments = issueComments.concat(connection?.nodes ?? []);
    if (!connection?.pageInfo?.hasNextPage) {
      break;
    }
    commentsCursor = connection.pageInfo.endCursor;
  }

  return {
    pr,
    reviewThreads,
    reviews,
    issueComments,
  };
}

function deriveOutJsonPath(outPath, outJsonPath) {
  if (outJsonPath) {
    return outJsonPath;
  }
  if (!outPath || outPath === '-') {
    return null;
  }
  return outPath.replace(/\.md$/i, '.json');
}

function renderReviewStateMarkdown(reviewState) {
  const lines = [];
  lines.push('# Review State');
  lines.push('');
  lines.push(`PR: ${reviewState.pr.url ?? ''}`);
  lines.push(`FetchedAt: ${reviewState.fetchedAt}`);
  lines.push(`SourceBranch: ${reviewState.sourceBranch ?? 'N/A'}`);
  lines.push('');
  lines.push(`Unresolved threads: ${reviewState.reviewThreads.length}`);
  lines.push(`Reviews with body: ${reviewState.reviews.length}`);
  lines.push(`Issue comments: ${reviewState.issueComments.length}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function writeOutput(outPath, text) {
  if (!outPath || outPath === '-') {
    process.stdout.write(text);
    return;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text, 'utf8');
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.code ?? EXIT_CLI);
  }

  if (options.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const preconditions = checkPreconditions();
  if (!preconditions.ok) {
    process.stderr.write(`${preconditions.message}\n`);
    process.exit(preconditions.code);
  }

  let prUrl = options.prUrl;
  let sourceBranch = null;
  if (!prUrl) {
    sourceBranch = getCurrentBranch();
    if (!sourceBranch || sourceBranch === 'HEAD') {
      process.stderr.write('error: cannot discover PR when in detached HEAD state; pass --pr <url>\n');
      process.exit(EXIT_OPERATIONAL);
    }
    const discovered = discoverPrUrl(sourceBranch);
    if (discovered.error) {
      process.stderr.write(`${discovered.error}\n`);
      process.exit(discovered.code ?? EXIT_OPERATIONAL);
    }
    prUrl = discovered.url;
  }

  const parsedPr = parsePrUrl(prUrl);
  if (!parsedPr) {
    process.stderr.write(
      'error: invalid --pr value (expected GitHub PR URL like https://github.com/OWNER/REPO/pull/123)\n',
    );
    process.exit(EXIT_CLI);
  }

  if (!sourceBranch) {
    sourceBranch = getCurrentBranch();
    if (sourceBranch === 'HEAD') {
      sourceBranch = null;
    }
  }

  const payload = paginateAll(parsedPr.owner, parsedPr.repo, parsedPr.number);
  if (payload.error) {
    process.stderr.write(`${payload.error}\n`);
    process.exit(payload.code ?? EXIT_OPERATIONAL);
  }

  const fetchedAt = new Date().toISOString();
  const reviewState = normalizeReviewStateV1({
    version: 1,
    fetchedAt,
    sourceBranch,
    pr: payload.pr,
    reviewThreads: payload.reviewThreads,
    reviews: payload.reviews,
    issueComments: payload.issueComments,
  });
  assertReviewStateV1(reviewState);

  const markdown = renderReviewStateMarkdown(reviewState);
  const jsonText = formatCanonicalJson(reviewState);
  const outJsonPath = deriveOutJsonPath(options.outPath, options.outJsonPath);

  await writeOutput(options.outPath, markdown);
  if (outJsonPath) {
    await writeOutput(outJsonPath, jsonText);
  }

  process.exit(EXIT_SUCCESS);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith('fetch-review-state.mjs');

if (isMain) {
  main().catch((error) => {
    const message = error?.message ? String(error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(EXIT_OPERATIONAL);
  });
}

export {
  deriveOutJsonPath,
  parseCliArgs,
  parsePrUrl,
  renderReviewStateMarkdown,
};
