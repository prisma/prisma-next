# PR utilities

Scripts for working with GitHub pull requests, optimized for deterministic, agent-friendly review workflows.

## Responsibilities

- Fetch PR review state from GitHub (unresolved review threads, review bodies, and PR issue comments)
- Render deterministic Markdown suitable for offline review and agent parsing
- Fail fast with operational errors (auth/tooling) vs CLI usage errors

## Dependencies

- Node.js (>= 20)
- `git` (used for branch → PR discovery)
- GitHub CLI `gh` (must be authenticated via `gh auth login`)

### TLS notes (Cursor sandbox)

If `gh` fails with TLS/certificate errors in a sandboxed shell, re-run the failing `gh` command outside the sandbox using the system cert store (do not disable TLS verification). See `.cursor/rules/github-cli-tls-in-sandbox.mdc`.

## fetch-review-state

Fetches PR review state (unresolved threads, reviews, issue comments) and writes deterministic Markdown.

```bash
# Discover PR from current branch
node scripts/pr/fetch-review-state.mjs

# Explicit PR URL
node scripts/pr/fetch-review-state.mjs --pr https://github.com/OWNER/REPO/pull/123

# Write to file
node scripts/pr/fetch-review-state.mjs --pr <url> --out review-state.md

# Stdout
node scripts/pr/fetch-review-state.mjs --pr <url> --out -
```

Requires `git` and `gh` (authenticated). See `agent-os/specs/2026-02-12-fetch-pr-review-state-to-md/spec.md` for full spec.

**Tests**: `node --test scripts/pr/fetch-review-state.test.mjs`

### Output characteristics

- **Deterministic timestamps**: formatted in UTC
- **Stable markdown tables**: PR metadata is escaped to avoid `|` and newline table breakage
- **Issue comments are rendered flat**: GitHub PR issue comments are not modeled as threaded replies

## Architecture

```mermaid
flowchart LR
  Caller["Developer / Agent"] -->|runs| Script["scripts/pr/fetch-review-state.mjs"]
  Script -->|gh (GraphQL)| GitHub["GitHub API"]
  Script -->|writes| Out["review-state.md (stdout or file)"]
```

## Related docs

- `agent-os/specs/2026-02-12-fetch-pr-review-state-to-md/spec.md`
- `agent-os/specs/review-framework/spec.md`
