import assert from 'node:assert';
import { test } from 'node:test';
import {
  buildCommentTrees,
  buildMarkdown,
  buildReviewStateJson,
  computeLineRange,
  parseCliArgs,
  parsePrUrl,
  quoteBody,
  renderReactions,
  sortIssueComments,
  sortReviews,
  sortThreadComments,
  sortThreads,
} from './fetch-review-state.mjs';

const MINIMAL_PR = {
  url: 'https://github.com/owner/repo/pull/1',
  title: 'Test PR',
  state: 'OPEN',
  headRefName: 'feature',
  baseRefName: 'main',
};

function makePayload(overrides = {}) {
  return {
    pr: MINIMAL_PR,
    threads: [],
    reviews: [],
    comments: [],
    ...overrides,
  };
}

test('CLI option parsing', () => {
  test('when unknown flag is passed', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script', '--unknown']),
      (e) => e.message?.includes('unknown flag') && e.code === 2,
    );
  });

  test('when --pr is passed without value', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script', '--pr']),
      (e) => e.message?.includes('requires a value') && e.code === 2,
    );
  });

  test('when --out is passed without value', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script', '--out']),
      (e) => e.message?.includes('requires a value') && e.code === 2,
    );
  });

  test('when --out-json is passed without value', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script', '--out-json']),
      (e) => e.message?.includes('requires a value') && e.code === 2,
    );
  });

  test('when --out file path does not end with .md', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script', '--out', 'foo.txt']),
      (e) => e.message?.includes('must end with .md') && e.code === 2,
    );
  });

  test('when --out-json file path does not end with .json', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script', '--out-json', 'foo.md']),
      (e) => e.message?.includes('must end with .json') && e.code === 2,
    );
  });

  test('when --out - is passed', () => {
    const result = parseCliArgs(['node', 'script', '--out', '-']);
    assert.strictEqual(result.outPath, '-');
  });

  test('when valid options are passed', () => {
    const result = parseCliArgs([
      'node',
      'script',
      '--pr',
      'https://github.com/owner/repo/pull/123',
      '--out',
      'out.md',
      '--out-json',
      'out.json',
    ]);
    assert.strictEqual(result.prUrl, 'https://github.com/owner/repo/pull/123');
    assert.strictEqual(result.outPath, 'out.md');
    assert.strictEqual(result.outJsonPath, 'out.json');
  });

  test('when no args are passed', () => {
    const result = parseCliArgs(['node', 'script']);
    assert.strictEqual(result.prUrl, null);
    assert.strictEqual(result.outPath, null);
  });
});

test('PR URL parsing', () => {
  test('when URL is invalid', () => {
    assert.strictEqual(parsePrUrl(''), null);
    assert.strictEqual(parsePrUrl('not-a-url'), null);
    assert.strictEqual(parsePrUrl('https://gitlab.com/owner/repo'), null);
  });

  test('when URL is valid GitHub PR', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/123');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', number: 123 });
  });

  test('when URL has trailing slash and hash', () => {
    const result = parsePrUrl('https://github.com/foo/bar/pull/456/#files');
    assert.deepStrictEqual(result, { owner: 'foo', repo: 'bar', number: 456 });
  });
});

test('Reaction rendering', () => {
  test('when no reaction groups exist', () => {
    assert.strictEqual(renderReactions([]), '--');
    assert.strictEqual(renderReactions(null), '--');
  });

  test('when all reaction counts are zero', () => {
    const groups = [
      { content: 'THUMBS_UP', users: { totalCount: 0 } },
      { content: 'HEART', users: { totalCount: 0 } },
    ];
    assert.strictEqual(renderReactions(groups), '--');
  });

  test('when reactions have counts', () => {
    const groups = [
      { content: 'HEART', users: { totalCount: 1 } },
      { content: 'THUMBS_UP', users: { totalCount: 2 } },
    ];
    assert.strictEqual(renderReactions(groups), 'HEART×1, THUMBS_UP×2');
  });
});

test('Body quoting', () => {
  test('when body has multiple lines', () => {
    const result = quoteBody('Line one\nLine two');
    assert.strictEqual(result, '> Line one\n> Line two');
  });

  test('when body contains backticks', () => {
    const body = '```javascript\nconst x = 1;\n```';
    const result = quoteBody(body);
    assert.strictEqual(result, '> ```javascript\n> const x = 1;\n> ```');
  });

  test('when body is empty', () => {
    const result = quoteBody('');
    assert.strictEqual(result, '> ');
  });

  test('when body contains internal state block', () => {
    const body =
      'Before\n<!-- internal state start -->\nsecret\n<!-- internal state end -->\nAfter';
    const result = quoteBody(body);
    assert.strictEqual(result, '> Before\n> \n> After');
  });
});

test('Sorting', () => {
  test('threads by path then line then earliest comment', () => {
    const threads = [
      {
        path: 'b.txt',
        startLine: 5,
        comments: { nodes: [{ createdAt: '2024-01-02T00:00:00Z' }] },
      },
      {
        path: 'a.txt',
        startLine: 10,
        comments: { nodes: [{ createdAt: '2024-01-01T00:00:00Z' }] },
      },
      {
        path: 'a.txt',
        startLine: 3,
        comments: { nodes: [{ createdAt: '2024-01-03T00:00:00Z' }] },
      },
    ];
    const sorted = sortThreads(threads);
    assert.strictEqual(sorted[0].path, 'a.txt');
    assert.strictEqual(sorted[0].startLine, 3);
    assert.strictEqual(sorted[1].path, 'a.txt');
    assert.strictEqual(sorted[1].startLine, 10);
    assert.strictEqual(sorted[2].path, 'b.txt');
  });

  test('thread comments by createdAt', () => {
    const comments = [
      { createdAt: '2024-01-03T00:00:00Z', databaseId: 3 },
      { createdAt: '2024-01-01T00:00:00Z', databaseId: 1 },
      { createdAt: '2024-01-02T00:00:00Z', databaseId: 2 },
    ];
    const sorted = sortThreadComments(comments);
    assert.strictEqual(sorted[0].databaseId, 1);
    assert.strictEqual(sorted[1].databaseId, 2);
    assert.strictEqual(sorted[2].databaseId, 3);
  });

  test('reviews by submittedAt then databaseId', () => {
    const reviews = [
      { submittedAt: '2024-01-02T00:00:00Z', databaseId: 2 },
      { submittedAt: '2024-01-01T00:00:00Z', databaseId: 1 },
      { submittedAt: '2024-01-01T00:00:00Z', databaseId: 3 },
    ];
    const sorted = sortReviews(reviews);
    assert.strictEqual(sorted[0].databaseId, 1);
    assert.strictEqual(sorted[1].databaseId, 3);
    assert.strictEqual(sorted[2].databaseId, 2);
  });

  test('issue comments by createdAt then databaseId', () => {
    const comments = [
      { createdAt: '2024-01-02T00:00:00Z', databaseId: 2 },
      { createdAt: '2024-01-01T00:00:00Z', databaseId: 1 },
      { createdAt: '2024-01-01T00:00:00Z', databaseId: 3 },
    ];
    const sorted = sortIssueComments(comments);
    assert.strictEqual(sorted[0].databaseId, 1);
    assert.strictEqual(sorted[1].databaseId, 3);
    assert.strictEqual(sorted[2].databaseId, 2);
  });
});

test('Line range computation', () => {
  test('when all line fields are null', () => {
    assert.strictEqual(computeLineRange({}), 'L?');
  });

  test('when single line is available', () => {
    assert.strictEqual(
      computeLineRange({ startLine: 5, line: 5, originalStartLine: 5, originalLine: 5 }),
      'L5',
    );
    assert.strictEqual(computeLineRange({ line: 10 }), 'L10');
  });

  test('when start and end differ', () => {
    assert.strictEqual(computeLineRange({ startLine: 3, line: 7 }), 'L3-L7');
  });
});

test('buildCommentTrees', () => {
  test('when all comments have no replyTo', () => {
    const comments = [
      { id: 'c1', createdAt: '2024-01-01Z', replyTo: null },
      { id: 'c2', createdAt: '2024-01-02Z', replyTo: null },
    ];
    const roots = buildCommentTrees(comments);
    assert.strictEqual(roots.length, 2);
    assert.strictEqual(roots[0].replies.length, 0);
    assert.strictEqual(roots[1].replies.length, 0);
  });

  test('when comment has replyTo referencing another comment', () => {
    const comments = [
      { id: 'parent', createdAt: '2024-01-01Z', replyTo: null },
      { id: 'child', createdAt: '2024-01-02Z', replyTo: { id: 'parent' } },
    ];
    const roots = buildCommentTrees(comments);
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].id, 'parent');
    assert.strictEqual(roots[0].replies.length, 1);
    assert.strictEqual(roots[0].replies[0].id, 'child');
  });

  test('when replies are out of order, sorts by createdAt', () => {
    const comments = [
      { id: 'parent', createdAt: '2024-01-01Z', replyTo: null },
      { id: 'r2', createdAt: '2024-01-03Z', replyTo: { id: 'parent' } },
      { id: 'r1', createdAt: '2024-01-02Z', replyTo: { id: 'parent' } },
    ];
    const roots = buildCommentTrees(comments);
    assert.strictEqual(roots[0].replies[0].id, 'r1');
    assert.strictEqual(roots[0].replies[1].id, 'r2');
  });
});

test('buildMarkdown document hierarchy', () => {
  test('when payload is empty', () => {
    const payload = makePayload();
    const md = buildMarkdown(payload, 'main');
    assert.ok(md.startsWith('# Review\n'));
    assert.ok(md.includes('| PR | Title | State |'));
    assert.ok(md.includes(MINIMAL_PR.url));
  });

  test('when payload contains an inline review thread (PullRequestReviewThread)', () => {
    const thread = {
      id: 'PRRT_xxx',
      path: 'src/foo.ts',
      startLine: 16,
      line: 18,
      comments: {
        nodes: [
          {
            id: 'PRRC_1',
            databaseId: 1001,
            url: 'https://github.com/o/r/pull/1#discussion_r1001',
            author: { login: 'alice' },
            createdAt: '2024-01-15T10:00:00Z',
            body: 'Change this',
            reactionGroups: [],
          },
        ],
      },
    };
    const payload = makePayload({ threads: [thread] });
    const md = buildMarkdown(payload, 'main');

    assert.ok(md.includes('# [src/foo.ts L16-L18](src/foo.ts:16)'));
    assert.ok(md.includes('<!-- ThreadId: PRRT_xxx -->'));
    assert.match(
      md,
      /## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @alice\]\(https:\/\/github\.com\/o\/r\/pull\/1#discussion_r1001\)/,
    );
    assert.ok(md.includes('> Change this'));
  });

  test('when payload contains a submitted review (PullRequestReview)', () => {
    const review = {
      id: 'PRR_xxx',
      databaseId: 2001,
      url: 'https://github.com/o/r/pull/1#pullrequestreview-2001',
      author: { login: 'bob' },
      state: 'APPROVED',
      submittedAt: '2024-01-16T12:00:00Z',
      body: 'LGTM',
      reactionGroups: [],
    };
    const payload = makePayload({ reviews: [review] });
    const md = buildMarkdown(payload, 'main');

    assert.match(
      md,
      /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @bob\]\(https:\/\/github\.com\/o\/r\/pull\/1#pullrequestreview-2001\)/,
    );
    assert.ok(md.includes('- State: APPROVED'));
    assert.ok(md.includes('> LGTM'));
  });

  test('when payload contains a review with empty body, review is not displayed', () => {
    const review = {
      id: 'PRR_empty',
      databaseId: 2002,
      url: 'https://github.com/o/r/pull/1#pullrequestreview-2002',
      author: { login: 'ghost' },
      state: 'COMMENTED',
      submittedAt: '2024-01-16T14:00:00Z',
      body: '',
      reactionGroups: [],
    };
    const payload = makePayload({ reviews: [review] });
    const md = buildMarkdown(payload, 'main');

    assert.ok(!md.includes('@ghost'));
    const withWhitespace = makePayload({
      reviews: [{ ...review, body: '   \n\t  ', author: { login: 'blank' } }],
    });
    const md2 = buildMarkdown(withWhitespace, 'main');
    assert.ok(!md2.includes('@blank'));
  });

  test('when payload contains a standalone PR comment without replies (IssueComment, replyTo null)', () => {
    const comment = {
      id: 'IC_xxx',
      databaseId: 3001,
      url: 'https://github.com/o/r/pull/1#issuecomment-3001',
      author: { login: 'charlie' },
      createdAt: '2024-01-17T14:00:00Z',
      body: 'Nice work',
      reactionGroups: [],
      replyTo: null,
    };
    const payload = makePayload({ comments: [comment] });
    const md = buildMarkdown(payload, 'main');

    assert.match(
      md,
      /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @charlie\]\(https:\/\/github\.com\/o\/r\/pull\/1#issuecomment-3001\)/,
    );
    assert.ok(md.includes('> Nice work'));
  });

  test('when payload contains a standalone PR comment with replies (IssueComment with replyTo)', () => {
    const parent = {
      id: 'IC_parent',
      databaseId: 4001,
      url: 'https://github.com/o/r/pull/1#issuecomment-4001',
      author: { login: 'dave' },
      createdAt: '2024-01-18T09:00:00Z',
      body: 'Initial thought',
      reactionGroups: [],
      replyTo: null,
    };
    const reply = {
      id: 'IC_reply',
      databaseId: 4002,
      url: 'https://github.com/o/r/pull/1#issuecomment-4002',
      author: { login: 'eve' },
      createdAt: '2024-01-18T10:00:00Z',
      body: 'I agree',
      reactionGroups: [],
      replyTo: { id: 'IC_parent' },
    };
    const payload = makePayload({ comments: [parent, reply] });
    const md = buildMarkdown(payload, 'main');

    assert.match(md, /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @dave\]/);
    assert.ok(md.includes('> Initial thought'));
    assert.match(md, /## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @eve\]/);
    assert.ok(md.includes('> I agree'));
  });
  test('when payload contains mixed blocks, orders chronologically', () => {
    const thread = {
      id: 'PRRT_1',
      path: 'a.ts',
      startLine: 1,
      comments: {
        nodes: [
          {
            id: 'c1',
            databaseId: 1,
            url: 'https://x/x',
            author: { login: 'a' },
            createdAt: '2024-01-20T00:00:00Z',
            body: 't1',
            reactionGroups: [],
          },
        ],
      },
    };
    const review = {
      id: 'PRR_1',
      databaseId: 2,
      url: 'https://x/x',
      author: { login: 'b' },
      state: 'COMMENTED',
      submittedAt: '2024-01-19T00:00:00Z',
      body: 'r1',
      reactionGroups: [],
    };
    const comment = {
      id: 'IC_1',
      databaseId: 3,
      url: 'https://x/x',
      author: { login: 'c' },
      createdAt: '2024-01-18T00:00:00Z',
      body: 'c1',
      reactionGroups: [],
      replyTo: null,
    };
    const payload = makePayload({
      threads: [thread],
      reviews: [review],
      comments: [comment],
    });
    const md = buildMarkdown(payload, 'main');

    const commentMatch = md.match(/# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @c\]/);
    const reviewMatch = md.match(/# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @b\]/);
    const threadIndex = md.indexOf('# [a.ts L1]');

    assert.ok(commentMatch && reviewMatch, 'comment and review blocks present');
    const firstIndex = md.indexOf(commentMatch[0]);
    const reviewIndex = md.indexOf(reviewMatch[0]);
    assert.ok(firstIndex < reviewIndex, 'standalone comment (earliest) appears before review');
    assert.ok(reviewIndex < threadIndex, 'review appears before thread');
  });

  test('when payload has all block types with full hierarchy, output is chronologically ordered despite non-chronological input', () => {
    const thread = {
      id: 'PRRT_1',
      path: 'src/bar.ts',
      startLine: 10,
      line: 12,
      comments: {
        nodes: [
          {
            id: 'tc1',
            databaseId: 101,
            url: 'https://x/thread#tc1',
            author: { login: 'threader' },
            createdAt: '2024-01-20T08:00:00Z',
            body: 'First thread comment',
            reactionGroups: [],
          },
          {
            id: 'tc2',
            databaseId: 102,
            url: 'https://x/thread#tc2',
            author: { login: 'reviewer' },
            createdAt: '2024-01-20T09:00:00Z',
            body: 'Second thread comment',
            reactionGroups: [],
          },
        ],
      },
    };
    const review1 = {
      id: 'PRR_1',
      databaseId: 201,
      url: 'https://x/review1',
      author: { login: 'alice' },
      state: 'APPROVED',
      submittedAt: '2024-01-19T12:00:00Z',
      body: 'Review one',
      reactionGroups: [],
    };
    const review2 = {
      id: 'PRR_2',
      databaseId: 202,
      url: 'https://x/review2',
      author: { login: 'bob' },
      state: 'COMMENTED',
      submittedAt: '2024-01-21T14:00:00Z',
      body: 'Review two',
      reactionGroups: [],
    };
    const standalone1 = {
      id: 'IC_1',
      databaseId: 301,
      url: 'https://x/comment1',
      author: { login: 'charlie' },
      createdAt: '2024-01-18T06:00:00Z',
      body: 'Standalone comment',
      reactionGroups: [],
      replyTo: null,
    };
    const parentWithReply = {
      id: 'IC_parent',
      databaseId: 401,
      url: 'https://x/parent',
      author: { login: 'dave' },
      createdAt: '2024-01-22T10:00:00Z',
      body: 'Parent with reply',
      reactionGroups: [],
      replyTo: null,
    };
    const reply = {
      id: 'IC_reply',
      databaseId: 402,
      url: 'https://x/reply',
      author: { login: 'eve' },
      createdAt: '2024-01-22T11:00:00Z',
      body: 'Reply to parent',
      reactionGroups: [],
      replyTo: { id: 'IC_parent' },
    };

    const payload = makePayload({
      threads: [thread],
      reviews: [review2, review1],
      comments: [parentWithReply, standalone1, reply],
    });

    const md = buildMarkdown(payload, 'main');

    assert.ok(md.includes('# Review\n'));
    assert.ok(md.includes('| PR | Title | State |'));

    assert.ok(md.includes('# [src/bar.ts L10-L12]'));
    assert.ok(md.includes('<!-- ThreadId: PRRT_1 -->'));
    assert.match(md, /## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @threader\].*thread/);
    assert.ok(md.includes('> First thread comment'));
    assert.match(md, /## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @reviewer\].*thread/);
    assert.ok(md.includes('> Second thread comment'));

    assert.match(md, /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @alice\]/);
    assert.ok(md.includes('> Review one'));
    assert.ok(md.includes('- State: APPROVED'));

    assert.match(md, /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @charlie\]/);
    assert.ok(md.includes('> Standalone comment'));

    assert.match(md, /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @bob\]/);
    assert.ok(md.includes('> Review two'));
    assert.ok(md.includes('- State: COMMENTED'));

    assert.match(md, /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @dave\]/);
    assert.ok(md.includes('> Parent with reply'));
    assert.match(md, /## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @eve\]/);
    assert.ok(md.includes('> Reply to parent'));

    const blockOrder = [
      { pattern: /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @charlie\]/, name: 'standalone (Jan 18)' },
      { pattern: /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @alice\]/, name: 'review1 (Jan 19)' },
      { pattern: /# \[src\/bar\.ts L10-L12\]/, name: 'thread (Jan 20)' },
      { pattern: /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @bob\]/, name: 'review2 (Jan 21)' },
      { pattern: /# \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} @dave\]/, name: 'comment+reply (Jan 22)' },
    ];
    let lastIndex = -1;
    for (const { pattern, name } of blockOrder) {
      const match = md.match(pattern);
      assert.ok(match, `${name} block present`);
      const idx = md.indexOf(match[0]);
      assert.ok(idx > lastIndex, `${name} appears after previous block (chronological order)`);
      lastIndex = idx;
    }
  });
});

test('buildReviewStateJson', () => {
  test('includes pr metadata and empty arrays', () => {
    const payload = makePayload();
    const fetchedAt = '2026-02-12T00:00:00.000Z';
    const json = buildReviewStateJson(payload, 'main', fetchedAt);

    assert.strictEqual(json.version, 1);
    assert.strictEqual(json.fetchedAt, fetchedAt);
    assert.strictEqual(json.sourceBranch, 'main');
    assert.strictEqual(json.pr.url, MINIMAL_PR.url);
    assert.deepStrictEqual(json.threads, []);
    assert.deepStrictEqual(json.reviews, []);
    assert.deepStrictEqual(json.issueComments, []);
  });
});
