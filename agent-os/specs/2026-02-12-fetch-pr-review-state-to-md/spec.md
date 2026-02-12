# Fetch PR review state to Markdown (unresolved threads + reviews + reactions)

## Summary

Create a **deterministic CLI script** that fetches the **current branch’s associated GitHub Pull Request** review state and writes it to **Markdown** (either to a file or to stdout).

“Review state” in this spec means:

- **Unresolved review threads** (inline review comment threads where `isResolved === false`)
- **All submitted reviews** (the “summary comment” body that accompanies a review submission, including approvals/changes-requested/comment-only)
- **All PR conversation comments** (a.k.a. issue comments) because they are **not resolvable** on GitHub; in this script they are treated as “unresolved” by definition
- **All replies and emoji reactions** for every included item (reactions are required signal, not decoration)

The output is intended to be used locally to address review feedback without manually opening GitHub.

## Goals

- Fetch comments/reviews **deterministically** (stable algorithm + stable output ordering).
- Support the two discovery modes:
  - **Explicit PR URL** provided on CLI
  - **Implicit PR discovery** from the **current local git branch**
- Produce Markdown that contains, for every included item:
  - a link to the comment/review
  - a numeric ID usable with GitHub APIs / `gh api` operations
  - full text content (verbatim, safely fenced)
  - file path and line range **when attached** (inline review threads)
  - all replies and all reactions (with counts)
- Fail with **clear, actionable errors** and non-zero exit codes when discovery/fetching is impossible.

## Non-goals

- Posting comments, resolving threads, dismissing reviews, or mutating GitHub state.
- Inferring “what to do next” or generating a plan to address comments.
- Trying to map comments onto the local working tree if the PR diff has shifted (the script reports GitHub’s thread metadata as-is).

## CLI interface (no ambiguity)

### Command and file location

- Implement the script at: `scripts/pr/fetch-review-state.mjs`
- The script is invoked via Node:

```bash
node scripts/pr/fetch-review-state.mjs [--pr <prUrl>] [--out <outputPath>] [--out-json <outputJsonPath>]
```

### Inputs

- `--pr <prUrl>` (optional)
  - A full GitHub PR URL (example: `https://github.com/OWNER/REPO/pull/123`)
- `--out <outputPath>` (optional)
  - If provided:
    - If `outputPath` is `-`, write to stdout
    - Otherwise, write to the specified file path
  - If `outputPath` is a file path ending in `.md` and `--out-json` is not provided, the script also writes a sibling JSON file by replacing `.md` with `.json`.
- `--out-json <outputJsonPath>` (optional)
  - If provided, write a structured JSON representation of the fetched review state.
  - If omitted, JSON is written automatically when `--out` is a `.md` file path.
  - If omitted, write to stdout

### Strict option parsing

- Unknown flags cause an error and exit code `2`.
- `--pr` and `--out` must be followed by a value; missing values cause an error and exit code `2`.

### Output destination rules

- If `--out` is a file path (not `-`), it **must** end with `.md`. Otherwise, error + exit code `2`.
- When writing a file:
  - Create parent directories if they do not exist.
  - Write UTF-8 with a trailing newline.

### Exit codes

- `0`: success
- `1`: operational failure (auth/network/API/git state)
- `2`: invalid CLI usage

## PR resolution logic (deterministic)

### 1) If `--pr` is provided

- Parse the URL and extract:
  - `owner`
  - `repo`
  - `number`
- If parsing fails, error (exit `2`) with message:

```
error: invalid --pr value (expected GitHub PR URL like https://github.com/OWNER/REPO/pull/123)
```

### 2) If `--pr` is not provided (discover PR for current branch)

The script must discover the PR by **listing PRs attached to the current local branch**:

- Determine the current branch name:
  - `git rev-parse --abbrev-ref HEAD`
  - If result is `HEAD` (detached), error (exit `1`) with message:

```
error: cannot discover PR when in detached HEAD state; pass --pr <url>
```

- Fetch PR list by head branch (must use list + match; do not guess):
  - `gh pr list --head <branchName> --state all --json url,number,state,updatedAt`
  - If `gh` is not authenticated, error (exit `1`) with message:

```
error: gh is not authenticated; run "gh auth login" and try again
```

- Selection rules:
  - If **0** PRs returned, error (exit `1`):

```
error: no pull request found for current branch "<branchName>"; pass --pr <url>
```

  - If **>1** PRs returned, **do not pick one** (avoid bad decisions). Error (exit `1`) and list the URLs returned, instructing the user to pass `--pr`:

```
error: multiple pull requests found for current branch "<branchName>"; pass --pr <url>
<url1>
<url2>
...
```

  - If **exactly 1** PR returned, use it.

### 3) Canonical PR metadata fetch (required)

After choosing a PR URL (from either path above), fetch canonical metadata using `gh pr view`:

- `gh pr view <prUrl> --json url,number,title,state,headRefName,baseRefName,updatedAt`
- If the PR is not accessible, error (exit `1`):

```
error: failed to fetch pull request metadata for <prUrl>
```

## Data to fetch (required)

The script must fetch **all pages** for each connection (no missing data).

### A) Unresolved review threads (inline)

Fetch `reviewThreads` from GraphQL and include only threads where:

- `isResolved === false`

For each included thread, capture:

- thread identity:
  - `id` (GraphQL node id)
  - `isResolved`
  - `isOutdated`
- location:
  - `path`
  - `diffSide`
  - `startLine` / `line` (or `originalStartLine` / `originalLine` if the former are null)
- comments in thread:
  - include **all** comments in the thread (these represent the root comment and replies)
  - for each comment:
    - `databaseId` (numeric; used for REST/`gh api` operations)
    - `id` (GraphQL node id)
    - `url`
    - `author.login` (or literal `unknown` if missing)
    - `createdAt`
    - `body` (verbatim)
    - `reactionGroups { content, users.totalCount }`

### B) Reviews (summary comments)

Fetch `reviews` from GraphQL and include every review node where:

- `submittedAt != null` (i.e. exclude pending reviews)

For each included review, capture:

- `databaseId` (numeric)
- `id` (GraphQL node id)
- `url`
- `author.login` (or `unknown`)
- `state` (APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED)
- `submittedAt`
- `body` (verbatim, even if empty)
- `reactionGroups { content, users.totalCount }`

### C) PR conversation comments (issue comments)

Fetch PR `comments` (issue comments) from GraphQL and include **all**.

For each included issue comment, capture:

- `databaseId` (numeric)
- `id` (GraphQL node id)
- `url`
- `author.login` (or `unknown`)
- `createdAt`
- `body` (verbatim)
- `reactionGroups { content, users.totalCount }`

## GitHub API implementation (required, exact approach)

### Use `gh api graphql` with pagination

Implementation must use `gh api graphql` and paginate until all items are fetched.

#### Required GraphQL query shape

Use a GraphQL query that returns:

- PR identity/metadata
- `reviewThreads(first: 100, after: $threadsCursor)`
- `reviews(first: 100, after: $reviewsCursor)`
- `comments(first: 100, after: $issueCommentsCursor)`

Each connection must include `pageInfo { hasNextPage endCursor }`.

#### Pagination rules

- Each of the three connections paginates independently.
- The script must fetch all pages for:
  - threads
  - reviews
  - issue comments
- The final result must be equivalent to “fetch everything” regardless of PR size.

## Markdown output format (stable and parseable)

### Top matter (required)

The Markdown output must begin with:

- Title line:
  - `# PR review state`
- A metadata table (exact keys required; values computed at runtime):
  - `PR` (URL)
  - `Title`
  - `State`
  - `Head`
  - `Base`
  - `FetchedAt` (UTC ISO-8601, e.g. `2026-02-12T20:15:30.123Z`)
  - `SourceBranch` (current git branch name if discovered; otherwise `N/A`)

### Section ordering (required)

The document must contain these sections in this exact order:

1. `## Unresolved review threads (<count>)`
2. `## Reviews (<count>)`
3. `## PR conversation comments (<count>)`

### Item ordering (required for determinism)

- **Threads**:
  - Primary sort: `path` ascending (lexicographic)
  - Secondary sort: computed numeric line start ascending (see “line range” below; nulls sort last)
  - Tertiary sort: earliest comment `createdAt` ascending
- **Comments within a thread**:
  - sort by `createdAt` ascending
- **Reviews**:
  - sort by `submittedAt` ascending (nulls excluded)
  - if ties, sort by `databaseId` ascending
- **PR conversation comments**:
  - sort by `createdAt` ascending
  - if ties, sort by `databaseId` ascending

### Line range rendering (required)

For an inline thread, compute a display range:

- Prefer GitHub diff line fields:
  - `startLine` and `line`
- If either is null, fall back to:
  - `originalStartLine` and `originalLine`
- Rendering:
  - if only a single line is available: `L<line>`
  - if both start and end are available and differ: `L<start>-L<end>`
  - if all line fields are null: `L?`

### Per-item schema (required)

#### Thread heading

Each thread must be rendered as:

- `### <path> <lineRange>`

Immediately followed by a metadata bullet list:

- `- ThreadId: <threadNodeId>`
- `- Resolved: false`
- `- Outdated: <true|false>`
- `- DiffSide: <LEFT|RIGHT|...|unknown>`

Then the thread’s comments, each rendered as a `#### Comment <n>` subsection.

#### Comment block (review thread comments + issue comments)

For each comment, include this exact key set in this exact order:

- `- Url: <commentUrl>`
- `- DatabaseId: <number|unknown>`
- `- NodeId: <graphqlNodeId>`
- `- Author: <login|unknown>`
- `- CreatedAt: <isoTimestamp>`
- `- Reactions: <renderedReactionSummary>`
- `- Location: <path lineRange | N/A>`

Then a verbatim body block.

#### Review block (review summary comment)

For each review, include this exact key set in this exact order:

- `### Review <n>`
- `- Url: <reviewUrl>`
- `- DatabaseId: <number|unknown>`
- `- NodeId: <graphqlNodeId>`
- `- Author: <login|unknown>`
- `- State: <APPROVED|CHANGES_REQUESTED|COMMENTED|DISMISSED>`
- `- SubmittedAt: <isoTimestamp>`
- `- Reactions: <renderedReactionSummary>`
- `- Location: N/A`

Then a verbatim body block.

### Reactions rendering (required)

Reactions must be rendered as a single line:

- If there are no reaction groups with `totalCount > 0`:
  - `none`
- Otherwise render as a comma-separated list in **stable order**:
  - Order by reaction `content` ascending (lexicographic)
  - Format: `<content>×<count>` (example: `THUMBS_UP×2, HEART×1`)

### Verbatim body rendering (required; must be safe)

Comment/review bodies must be emitted **verbatim** (no transformation) in a fenced block that cannot be broken by the body’s own backticks.

Required algorithm:

- Find the maximum consecutive backtick run length in the body (`maxRun`).
  - If none, `maxRun = 0`.
- Choose fence length: `fenceLen = max(3, maxRun + 1)`.
- Fence delimiter is `` ` `` repeated `fenceLen` times.
- Emit:

```
<fence>
<body>
<fence>
```

If the body is empty, emit an empty body (still fenced):

```
<fence>
<empty>
<fence>
```

## Operational requirements

### Preconditions checks (must happen before API calls)

- Verify `git` is available; otherwise error (exit `1`): `error: git not found on PATH`
- Verify `gh` is available; otherwise error (exit `1`): `error: gh not found on PATH`
- Verify `gh auth status` succeeds; otherwise error as specified above.

### Rate limiting / robustness

- If GitHub API returns an error, print:
  - `error: GitHub API request failed`
  - include the `gh` stderr payload
  - exit `1`

## Testing plan (required; pure + deterministic)

Add Node test coverage for the deterministic parts (no network):

- `scripts/pr/fetch-review-state.test.mjs` using Node’s built-in `node:test` runner.
- Tests must cover:
  - CLI option parsing (unknown flags, missing values, `--out` must end with `.md`, `--out -` means stdout)
  - PR URL parsing (`--pr` invalid vs valid)
  - Sorting rules:
    - threads sorted by `path`, then line, then earliest comment timestamp
    - comments/reviews sorted by timestamp then id
  - Reaction rendering:
    - `none` when all counts are zero
    - stable ordering and formatting `CONTENT×N`
  - Verbatim fence selection:
    - body containing ``` uses a longer fence and round-trips correctly

Run command:

```bash
node --test scripts/pr/fetch-review-state.test.mjs
```

## Acceptance criteria (must be met)

- Running with `--pr <url>` prints/writes a Markdown document containing:
  - all unresolved review threads (and all comments within them, including replies and reactions)
  - all submitted reviews (summary bodies + reactions)
  - all PR conversation comments (bodies + reactions)
- Running with no `--pr` on a branch with exactly one associated PR produces the same result as passing that PR’s URL explicitly.
- Running on a branch with no associated PR fails with the specified error message.
- Running on a branch with multiple associated PRs fails with the specified error message and lists the PR URLs.
- Output ordering is stable across repeated runs when GitHub data is unchanged.

