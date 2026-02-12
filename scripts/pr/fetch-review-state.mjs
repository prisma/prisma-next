#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { prUrl: null, outPath: null };
  const knownFlags = new Set(['--pr', '--out']);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    const flag = arg;
    if (!knownFlags.has(flag)) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${flag}"` };
    }
    i++;
    if (i >= args.length) {
      throw {
        code: EXIT_CLI,
        message: `error: ${flag} requires a value`,
      };
    }
    const value = args[i];
    i++;
    if (flag === '--pr') {
      result.prUrl = value;
    } else if (flag === '--out') {
      result.outPath = value;
    }
  }
  if (result.outPath !== null && result.outPath !== '-') {
    if (!result.outPath.endsWith('.md')) {
      throw {
        code: EXIT_CLI,
        message: 'error: --out file path must end with .md',
      };
    }
  }
  return result;
}

function parsePrUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/)?(?:#.*)?$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    number: Number.parseInt(match[3], 10),
  };
}

function renderReactions(groups) {
  if (!groups || groups.length === 0) return '--';
  const withCount = groups
    .filter((g) => g?.users?.totalCount > 0)
    .map((g) => `${g.content}×${g.users.totalCount}`);
  if (withCount.length === 0) return '--';
  withCount.sort((a, b) => {
    const contentA = a.split('×')[0];
    const contentB = b.split('×')[0];
    return contentA.localeCompare(contentB);
  });
  return withCount.join(', ');
}

function stripInternalState(body) {
  const s = body ?? '';
  return s.replace(/<!-- internal state start -->[\s\S]*?<!-- internal state end -->/g, '');
}

function quoteBody(body) {
  const s = stripInternalState(body ?? '');
  const lines = s.split(/\r?\n/);
  return lines.map((line) => `> ${line}`).join('\n');
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function computeLineRange(thread) {
  const start = thread.startLine ?? thread.originalStartLine;
  const end = thread.line ?? thread.originalLine;
  if (start != null && end != null && start !== end) {
    return `L${start}-L${end}`;
  }
  if (end != null) return `L${end}`;
  if (start != null) return `L${start}`;
  return 'L?';
}

function threadStartLine(thread) {
  return thread.startLine ?? thread.originalStartLine ?? thread.line ?? thread.originalLine;
}

function threadSortKey(t) {
  const path = t.path ?? '';
  const start = t.startLine ?? t.originalStartLine;
  const lineNum = start != null ? start : Number.MAX_SAFE_INTEGER;
  const comments = t.comments?.nodes ?? [];
  const earliest =
    comments.length > 0
      ? Math.min(...comments.map((c) => new Date(c.createdAt ?? 0).getTime()))
      : 0;
  return [path, lineNum, earliest];
}

function sortThreads(threads) {
  return [...threads].sort((a, b) => {
    const [pathA, lineA, timeA] = threadSortKey(a);
    const [pathB, lineB, timeB] = threadSortKey(b);
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    if (lineA !== lineB) return lineA - lineB;
    return timeA - timeB;
  });
}

function sortThreadComments(comments) {
  return [...comments].sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
  );
}

function sortReviews(reviews) {
  return [...reviews].sort((a, b) => {
    const tsA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const tsB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    if (tsA !== tsB) return tsA - tsB;
    return (a.databaseId ?? 0) - (b.databaseId ?? 0);
  });
}

function sortIssueComments(comments) {
  return [...comments].sort((a, b) => {
    const tsA = new Date(a.createdAt ?? 0).getTime();
    const tsB = new Date(b.createdAt ?? 0).getTime();
    if (tsA !== tsB) return tsA - tsB;
    return (a.databaseId ?? 0) - (b.databaseId ?? 0);
  });
}

function runSync(cmd, args, input) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    input: input ?? undefined,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function checkPreconditions() {
  const git = runSync('which', ['git']);
  if (git.status !== 0) {
    return { ok: false, message: 'error: git not found on PATH', code: EXIT_OPERATIONAL };
  }
  const gh = runSync('which', ['gh']);
  if (gh.status !== 0) {
    return { ok: false, message: 'error: gh not found on PATH', code: EXIT_OPERATIONAL };
  }
  const auth = runSync('gh', ['auth', 'status']);
  if (auth.status !== 0) {
    return {
      ok: false,
      message: 'error: gh is not authenticated; run "gh auth login" and try again',
      code: EXIT_OPERATIONAL,
    };
  }
  return { ok: true };
}

function getCurrentBranch() {
  const r = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function discoverPrUrl(branchName) {
  const r = runSync('gh', ['pr', 'list', '--head', branchName, '--state', 'all', '--json', 'url']);
  if (r.status !== 0) {
    return { error: 'gh pr list failed', stderr: r.stderr };
  }
  let list;
  try {
    list = JSON.parse(r.stdout);
  } catch {
    return { error: 'gh pr list returned invalid JSON' };
  }
  if (list.length === 0) {
    return {
      error: `error: no pull request found for current branch "${branchName}"; pass --pr <url>`,
      code: EXIT_OPERATIONAL,
    };
  }
  if (list.length > 1) {
    const urls = list.map((p) => p.url).join('\n');
    return {
      error: `error: multiple pull requests found for current branch "${branchName}"; pass --pr <url>\n${urls}`,
      code: EXIT_OPERATIONAL,
    };
  }
  return { url: list[0].url };
}

function fetchPrMetadata(prUrl) {
  const r = runSync('gh', [
    'pr',
    'view',
    prUrl,
    '--json',
    'url,number,title,state,headRefName,baseRefName,updatedAt',
  ]);
  if (r.status !== 0) {
    return {
      error: `error: failed to fetch pull request metadata for ${prUrl}`,
      code: EXIT_OPERATIONAL,
    };
  }
  try {
    return { data: JSON.parse(r.stdout) };
  } catch {
    return {
      error: `error: failed to fetch pull request metadata for ${prUrl}`,
      code: EXIT_OPERATIONAL,
    };
  }
}

const THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $threadsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        url
        number
        title
        state
        headRefName
        baseRefName
        reviewThreads(first: 100, after: $threadsCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            diffSide
            startLine
            line
            originalStartLine
            originalLine
            comments(first: 100) {
              nodes {
                databaseId
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
        url
        number
        title
        state
        headRefName
        baseRefName
        reviews(first: 100, after: $reviewsCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            databaseId
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
        url
        number
        title
        state
        headRefName
        baseRefName
        comments(first: 100, after: $commentsCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            databaseId
            id
            url
            author { login }
            createdAt
            body
            reactionGroups { content users { totalCount } }
            replyTo { id }
          }
        }
      }
    }
  }
`;

function fetchGraphQL(_owner, _repo, _number, query, variables) {
  const body = JSON.stringify({ query, variables });
  const r = spawnSync('gh', ['api', 'graphql', '--input', '-'], {
    encoding: 'utf-8',
    input: body,
  });
  if (r.status !== 0) {
    return { error: r.stderr, code: EXIT_OPERATIONAL };
  }
  try {
    return { data: JSON.parse(r.stdout) };
  } catch {
    return { error: r.stderr, code: EXIT_OPERATIONAL };
  }
}

function paginateConnection(owner, repo, number, query, cursorVar, cursorValue) {
  const variables = { owner, repo, number, [cursorVar]: cursorValue || null };
  const res = fetchGraphQL(owner, repo, number, query, variables);
  if (res.error) return res;
  const pr = res.data?.data?.repository?.pullRequest;
  if (!pr) return { error: 'No pull request in response', code: EXIT_OPERATIONAL };
  return { pr, data: res.data };
}

function paginateAll(owner, repo, number) {
  let prData = null;
  let threads = [];
  let threadCursor = null;
  for (;;) {
    const res = paginateConnection(
      owner,
      repo,
      number,
      THREADS_QUERY,
      'threadsCursor',
      threadCursor,
    );
    if (res.error) return res;
    prData = res.pr;
    const conn = res.pr?.reviewThreads;
    const nodes = conn?.nodes ?? [];
    threads = threads.concat(nodes);
    const pageInfo = conn?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    threadCursor = pageInfo.endCursor;
  }

  let reviews = [];
  let reviewCursor = null;
  for (;;) {
    const res = paginateConnection(
      owner,
      repo,
      number,
      REVIEWS_QUERY,
      'reviewsCursor',
      reviewCursor,
    );
    if (res.error) return res;
    const conn = res.pr?.reviews;
    const nodes = conn?.nodes ?? [];
    reviews = reviews.concat(nodes);
    const pageInfo = conn?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    reviewCursor = pageInfo.endCursor;
  }

  let comments = [];
  let commentCursor = null;
  for (;;) {
    const res = paginateConnection(
      owner,
      repo,
      number,
      COMMENTS_QUERY,
      'commentsCursor',
      commentCursor,
    );
    if (res.error) return res;
    const conn = res.pr?.comments;
    const nodes = conn?.nodes ?? [];
    comments = comments.concat(nodes);
    const pageInfo = conn?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    commentCursor = pageInfo.endCursor;
  }

  const unresolvedThreads = threads.filter((t) => t.isResolved === false);
  const submittedReviews = reviews.filter(
    (r) =>
      r.submittedAt != null &&
      r.state !== 'DISMISSED' &&
      (r.body ?? '').trim().length > 0,
  );

  return {
    pr: prData,
    threads: unresolvedThreads,
    reviews: submittedReviews,
    comments,
  };
}

function threadEarliestDate(thread) {
  const comments = thread.comments?.nodes ?? [];
  if (comments.length === 0) return '';
  return comments.reduce((earliest, c) => {
    const d = c.createdAt ?? '';
    return !earliest || (d && d < earliest) ? d : earliest;
  }, null);
}

function buildCommentTrees(comments) {
  const byId = new Map();
  for (const c of comments) {
    byId.set(c.id, { ...c, replies: [] });
  }
  const roots = [];
  for (const c of comments) {
    const entry = byId.get(c.id);
    const parentId = c.replyTo?.id;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).replies.push(entry);
    } else {
      roots.push(entry);
    }
  }
  for (const r of roots) {
    r.replies.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  return roots;
}

function buildThreadBlock(thread) {
  const lines = [];
  const lineRange = computeLineRange(thread);
  const path = thread.path ?? '?';
  const startLine = threadStartLine(thread);
  const linkTarget = startLine != null ? `${path}:${startLine}` : path;
  lines.push(`# [${path} ${lineRange}](${linkTarget})`);
  lines.push(`<!-- ThreadId: ${thread.id} -->`);
  lines.push('');
  const threadComments = sortThreadComments(thread.comments?.nodes ?? []);
  for (const c of threadComments) {
    const login = c.author?.login ?? 'unknown';
    const reactions = renderReactions(c.reactionGroups);
    const url = c.url ?? '';
    lines.push(`## [${formatTimestamp(c.createdAt)} @${login}](${url})`);
    lines.push('');
    lines.push('<!--');
    lines.push(`- DatabaseId: ${c.databaseId ?? 'unknown'}`);
    lines.push(`- NodeId: ${c.id ?? ''}`);
    lines.push('-->');
    lines.push('');
    lines.push(quoteBody(c.body));
    lines.push('');
    if (reactions !== '--') lines.push(`- Reactions: ${reactions}`);
    lines.push('');
  }
  return lines;
}

function buildReviewBlock(rev) {
  const lines = [];
  const login = rev.author?.login ?? 'unknown';
  const reactions = renderReactions(rev.reactionGroups);
  const url = rev.url ?? '';
  lines.push(`# [${formatTimestamp(rev.submittedAt)} @${login}](${url})`);
  lines.push(`- State: ${rev.state ?? 'COMMENTED'}`);
  lines.push('');
  lines.push('<!--');
  lines.push(`- DatabaseId: ${rev.databaseId ?? 'unknown'}`);
  lines.push(`- NodeId: ${rev.id ?? ''}`);
  lines.push('-->');
  lines.push('');
  lines.push(quoteBody(rev.body));
  lines.push('');
  if (reactions !== '--') lines.push(`- Reactions: ${reactions}`);
  lines.push('');
  return lines;
}

function buildCommentBlock(c) {
  const lines = [];
  const login = c.author?.login ?? 'unknown';
  const reactions = renderReactions(c.reactionGroups);
  const url = c.url ?? '';
  lines.push(`# [${formatTimestamp(c.createdAt)} @${login}](${url})`);
  lines.push('');
  lines.push('<!--');
  lines.push(`- DatabaseId: ${c.databaseId ?? 'unknown'}`);
  lines.push(`- NodeId: ${c.id ?? ''}`);
  lines.push('-->');
  lines.push('');
  lines.push(quoteBody(c.body));
  lines.push('');
  if (reactions !== '--') lines.push(`- Reactions: ${reactions}`);
  lines.push('');
  for (const reply of c.replies ?? []) {
    const rLogin = reply.author?.login ?? 'unknown';
    const rReactions = renderReactions(reply.reactionGroups);
    const rUrl = reply.url ?? '';
    lines.push(`## [${formatTimestamp(reply.createdAt)} @${rLogin}](${rUrl})`);
    lines.push('');
    lines.push('<!--');
    lines.push(`- DatabaseId: ${reply.databaseId ?? 'unknown'}`);
    lines.push(`- NodeId: ${reply.id ?? ''}`);
    lines.push('-->');
    lines.push('');
    lines.push(quoteBody(reply.body));
    lines.push('');
    if (rReactions !== '--') lines.push(`- Reactions: ${rReactions}`);
    lines.push('');
  }
  return lines;
}

function buildMarkdown(payload, sourceBranch) {
  const { pr, threads, reviews, comments } = payload;
  const sortedThreads = sortThreads(threads);
  const sortedReviews = sortReviews(reviews).filter(
    (r) => (r.body ?? '').trim().length > 0,
  );
  const commentTrees = buildCommentTrees(comments).sort((a, b) =>
    (a.createdAt || '').localeCompare(b.createdAt || ''),
  );

  const blocks = [
    ...sortedThreads.map((t) => ({ type: 'thread', date: threadEarliestDate(t), data: t })),
    ...sortedReviews.map((r) => ({ type: 'review', date: r.submittedAt ?? '', data: r })),
    ...commentTrees.map((c) => ({ type: 'comment', date: c.createdAt ?? '', data: c })),
  ];
  blocks.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const fetchedAt = new Date().toISOString();
  const lines = [];
  lines.push('# Review');
  lines.push('');
  lines.push('| PR | Title | State | Head | Base | FetchedAt | SourceBranch |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  lines.push(
    `| ${pr.url} | ${pr.title ?? ''} | ${pr.state ?? ''} | ${pr.headRefName ?? ''} | ${pr.baseRefName ?? ''} | ${fetchedAt} | ${sourceBranch ?? 'N/A'} |`,
  );
  lines.push('');

  for (const block of blocks) {
    if (block.type === 'thread') {
      lines.push(...buildThreadBlock(block.data));
    } else if (block.type === 'review') {
      lines.push(...buildReviewBlock(block.data));
    } else {
      lines.push(...buildCommentBlock(block.data));
    }
  }

  return `${lines.join('\n')}\n`;
}

function normalizeReactionGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((g) => ({
    content: g?.content ?? '',
    users: { totalCount: g?.users?.totalCount ?? 0 },
  }));
}

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    process.exit(e.code ?? EXIT_CLI);
  }

  const pre = checkPreconditions();
  if (!pre.ok) {
    console.error(pre.message);
    process.exit(pre.code);
  }

  let prUrl = opts.prUrl;
  let sourceBranch = null;

  if (!prUrl) {
    const branch = getCurrentBranch();
    if (!branch || branch === 'HEAD') {
      console.error('error: cannot discover PR when in detached HEAD state; pass --pr <url>');
      process.exit(EXIT_OPERATIONAL);
    }
    sourceBranch = branch;
    const discovered = discoverPrUrl(branch);
    if (discovered.error) {
      console.error(discovered.error);
      process.exit(discovered.code ?? EXIT_OPERATIONAL);
    }
    prUrl = discovered.url;
  } else {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      console.error(
        'error: invalid --pr value (expected GitHub PR URL like https://github.com/OWNER/REPO/pull/123)',
      );
      process.exit(EXIT_CLI);
    }
  }

  const metaResult = fetchPrMetadata(prUrl);
  if (metaResult.error) {
    console.error(metaResult.error);
    process.exit(metaResult.code);
  }

  if (!sourceBranch) {
    sourceBranch = getCurrentBranch();
    if (sourceBranch === 'HEAD') sourceBranch = 'N/A';
  }

  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    console.error('error: invalid PR URL after resolution');
    process.exit(EXIT_OPERATIONAL);
  }

  const fetchResult = paginateAll(parsed.owner, parsed.repo, parsed.number);
  if (fetchResult.error) {
    console.error('error: GitHub API request failed');
    if (fetchResult.error) console.error(fetchResult.error);
    process.exit(fetchResult.code ?? EXIT_OPERATIONAL);
  }

  const payload = {
    pr: fetchResult.pr,
    threads: fetchResult.threads,
    reviews: fetchResult.reviews,
    comments: fetchResult.comments,
  };

  for (const t of payload.threads) {
    for (const c of t.comments?.nodes ?? []) {
      c.reactionGroups = normalizeReactionGroups(c.reactionGroups);
    }
  }
  for (const r of payload.reviews) {
    r.reactionGroups = normalizeReactionGroups(r.reactionGroups);
  }
  for (const c of payload.comments) {
    c.reactionGroups = normalizeReactionGroups(c.reactionGroups);
  }

  const markdown = buildMarkdown(payload, sourceBranch);

  if (opts.outPath === null || opts.outPath === '-') {
    process.stdout.write(markdown);
  } else {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, markdown, 'utf-8');
  }

  process.exit(EXIT_SUCCESS);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith('fetch-review-state.mjs');
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(EXIT_OPERATIONAL);
  });
}

export {
  buildCommentTrees,
  buildMarkdown,
  computeLineRange,
  parseCliArgs,
  parsePrUrl,
  quoteBody,
  renderReactions,
  sortIssueComments,
  sortReviews,
  sortThreadComments,
  sortThreads,
  threadSortKey,
};
