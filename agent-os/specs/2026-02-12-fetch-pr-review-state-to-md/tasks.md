# Tasks — Fetch PR review state to Markdown

Date: 2026-02-12  
Spec: `agent-os/specs/2026-02-12-fetch-pr-review-state-to-md/spec.md`

Principles:
- **Determinism**: stable output ordering and algorithm; reproducible across runs
- **Pure-first tests**: test sorting, parsing, reactions, fence logic without network
- **Fail fast**: clear, actionable errors with correct exit codes

---

## Milestone 1 — CLI scaffolding and option parsing

### Script file and CLI interface

1. [ ] Create `scripts/pr/fetch-review-state.mjs` with Node shebang and basic structure
2. [ ] Implement option parsing for:
   - `--pr <prUrl>` (optional)
   - `--out <outputPath>` (optional)
3. [ ] Enforce strict parsing:
   - Unknown flags → error + exit code `2`
   - `--pr` / `--out` without value → error + exit code `2`
4. [ ] Enforce `--out` rules:
   - If file path: must end with `.md`, else error + exit code `2`
   - `--out -` → stdout
5. [ ] Output destination:
   - No `--out` → stdout
   - `--out <path>` → create parent dirs if needed; write UTF-8 with trailing newline

### Precondition checks (before any API calls)

6. [ ] Verify `git` on PATH; else `error: git not found on PATH` + exit `1`
7. [ ] Verify `gh` on PATH; else `error: gh not found on PATH` + exit `1`
8. [ ] Verify `gh auth status` succeeds; else `error: gh is not authenticated; run "gh auth login" and try again` + exit `1`

---

## Milestone 2 — PR resolution logic

### Explicit PR mode (`--pr` provided)

1. [ ] Parse `--pr` URL to extract `owner`, `repo`, `number`
2. [ ] On parse failure, emit:
   ```
   error: invalid --pr value (expected GitHub PR URL like https://github.com/OWNER/REPO/pull/123)
   ```
   and exit `2`

### Implicit PR discovery (branch-based)

3. [ ] Resolve current branch via `git rev-parse --abbrev-ref HEAD`
4. [ ] If result is `HEAD` (detached): error `error: cannot discover PR when in detached HEAD state; pass --pr <url>` + exit `1`
5. [ ] Fetch PR list via `gh pr list --head <branchName> --state all --json url,number,state,updatedAt`
6. [ ] Handle 0 PRs: error `error: no pull request found for current branch "<branchName>"; pass --pr <url>` + exit `1`
7. [ ] Handle >1 PRs: error with message listing URLs, instruct user to pass `--pr` + exit `1`
8. [ ] If exactly 1 PR, use it

### Canonical metadata fetch (after PR chosen)

9. [ ] Call `gh pr view <prUrl> --json url,number,title,state,headRefName,baseRefName,updatedAt`
10. [ ] On failure: `error: failed to fetch pull request metadata for <prUrl>` + exit `1`

---

## Milestone 3 — GraphQL data fetching

### Query design

1. [ ] Implement GraphQL query returning:
   - PR identity/metadata
   - `reviewThreads(first: 100, after: $threadsCursor)` with `pageInfo { hasNextPage endCursor }`
   - `reviews(first: 100, after: $reviewsCursor)` with `pageInfo { hasNextPage endCursor }`
   - `comments(first: 100, after: $issueCommentsCursor)` with `pageInfo { hasNextPage endCursor }`

### Unresolved review threads (A)

2. [ ] Fetch all pages of `reviewThreads` via `gh api graphql`
3. [ ] Filter to threads where `isResolved === false`
4. [ ] For each thread capture: `id`, `isResolved`, `isOutdated`, `path`, `diffSide`, `startLine`/`line` (or `originalStartLine`/`originalLine` fallback)
5. [ ] For each comment in thread capture: `databaseId`, `id`, `url`, `author.login`, `createdAt`, `body`, `reactionGroups { content, users.totalCount }`

### Reviews (B)

6. [ ] Fetch all pages of `reviews` via GraphQL pagination
7. [ ] Filter to nodes where `submittedAt != null`
8. [ ] For each review capture: `databaseId`, `id`, `url`, `author.login`, `state`, `submittedAt`, `body`, `reactionGroups { content, users.totalCount }`

### PR conversation comments (C)

9. [ ] Fetch all pages of `comments` (issue comments)
10. [ ] For each comment capture: `databaseId`, `id`, `url`, `author.login`, `createdAt`, `body`, `reactionGroups { content, users.totalCount }`

### Error handling

11. [ ] On GitHub API error: print `error: GitHub API request failed` + gh stderr payload + exit `1`

---

## Milestone 4 — Markdown output construction

### Top matter

1. [ ] Emit title: `# PR review state`
2. [ ] Emit metadata table with keys: `PR`, `Title`, `State`, `Head`, `Base`, `FetchedAt` (UTC ISO-8601), `SourceBranch` (current branch or `N/A`)

### Section structure and ordering

3. [ ] Emit sections in order:
   - `## Unresolved review threads (<count>)`
   - `## Reviews (<count>)`
   - `## PR conversation comments (<count>)`

### Item ordering (determinism)

4. [ ] **Threads**: sort by `path` ascending, then computed line start ascending (nulls last), then earliest comment `createdAt` ascending
5. [ ] **Comments within thread**: sort by `createdAt` ascending
6. [ ] **Reviews**: sort by `submittedAt` ascending (nulls excluded), ties by `databaseId` ascending
7. [ ] **PR conversation comments**: sort by `createdAt` ascending, ties by `databaseId` ascending

### Line range rendering

8. [ ] Prefer `startLine`/`line`; fall back to `originalStartLine`/`originalLine` if null
9. [ ] Render: single line → `L<line>`; range → `L<start>-L<end>`; all null → `L?`

### Per-item schema

10. [ ] **Thread heading**: `### <path> <lineRange>` + metadata bullets: `ThreadId`, `Resolved: false`, `Outdated`, `DiffSide`
11. [ ] **Comment block** (thread comments + issue comments): keys in order: `Url`, `DatabaseId`, `NodeId`, `Author`, `CreatedAt`, `Reactions`, `Location`; then verbatim body
12. [ ] **Review block**: `### Review <n>` + keys: `Url`, `DatabaseId`, `NodeId`, `Author`, `State`, `SubmittedAt`, `Reactions`, `Location: N/A`; then verbatim body

### Reactions rendering

13. [ ] If no reaction groups with `totalCount > 0`: render `none`
14. [ ] Else: comma-separated list ordered by `content` ascending, format `<content>×<count>` (e.g. `THUMBS_UP×2, HEART×1`)

### Verbatim body fencing

15. [ ] Implement fence selection: find max consecutive backtick run in body; `fenceLen = max(3, maxRun + 1)`
16. [ ] Emit body in fenced block (empty body still fenced)

---

## Milestone 5 — Unit tests (pure, no network)

### Test file and runner

1. [ ] Create `scripts/pr/fetch-review-state.test.mjs` using Node `node:test` runner
2. [ ] Run via: `node --test scripts/pr/fetch-review-state.test.mjs`

### CLI tests

3. [ ] Unknown flags → error
4. [ ] Missing value for `--pr` / `--out` → error
5. [ ] `--out` file path must end with `.md`
6. [ ] `--out -` means stdout

### PR URL parsing tests

7. [ ] Invalid `--pr` value → error
8. [ ] Valid URL parses to `owner`, `repo`, `number`

### Sorting tests

9. [ ] Threads: sort by path, then line, then earliest comment timestamp
10. [ ] Comments/reviews: sort by timestamp then id

### Reactions tests

11. [ ] All counts zero → `none`
12. [ ] Stable ordering and format `CONTENT×N`

### Verbatim fence tests

13. [ ] Body containing ``` uses longer fence and round-trips correctly

---

## Milestone 6 — Acceptance validation

1. [ ] `--pr <url>` produces full Markdown with all unresolved threads, reviews, issue comments (and replies/reactions)
2. [ ] No `--pr` on branch with exactly one PR produces same result as passing that PR URL
3. [ ] Branch with no PR fails with specified error
4. [ ] Branch with multiple PRs fails with specified error and lists URLs
5. [ ] Output ordering stable across repeated runs when data unchanged
