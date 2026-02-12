# PR utilities

Scripts for working with GitHub pull requests.

## fetch-review-state

Fetches PR review state (unresolved threads, reviews, issue comments) and writes deterministic Markdown.

```bash
# Discover PR from current branch
node scripts/pr/fetch-review-state.mjs

# Explicit PR URL
node scripts/pr/fetch-review-state.mjs --pr https://github.com/OWNER/REPO/pull/123

# Write to file
node scripts/pr/fetch-review-state.mjs --pr <url> --out review-state.md

# Also write JSON (defaults to review-state.json when --out ends in .md)
node scripts/pr/fetch-review-state.mjs --pr <url> --out review-state.md --out-json review-state.json

# Stdout
node scripts/pr/fetch-review-state.mjs --pr <url> --out -
```

Requires `git` and `gh` (authenticated). See `agent-os/specs/2026-02-12-fetch-pr-review-state-to-md/spec.md` for full spec.

**Tests**: `node --test scripts/pr/fetch-review-state.test.mjs`
