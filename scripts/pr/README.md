# PR Utilities

Deterministic GitHub PR review tooling for the review-framework workflow. JSON artifacts are canonical; Markdown outputs are derived.

Primary contract doc: `agent-os/specs/review-framework/spec.md`.

## Workflow

1. Fetch canonical state (`review-state.json`) from GitHub.
2. Render derived state Markdown (`review-state.md`) and optional summary.
3. Author/update canonical action plan (`review-actions.json`).
4. Render derived actions Markdown (`review-actions.md`).
5. Plan admin mutations (`--dry-run`, default), then apply explicitly with `--apply`.

For a thin wrapper over this loop, use `scripts/pr/review-iterate.mjs`.

## Artifact Contract Quick Reference

- **Identifiers:** GraphQL `nodeId` only; no `databaseId` assumptions.
- **Canonical artifacts:** `review-state.json` and `review-actions.json` (both `version: 1`).
- **Derived artifacts:** `review-state.md`, `review-actions.md`, `summary.txt`/summary JSON, optional `apply-log.json`.
- **Determinism:** stable sorting + `JSON.stringify(value, null, 2) + "\n"` for canonical JSON outputs.
- **Markers:** automation uses hidden markers like `<!-- review-framework:actionId=A-001 kind=done -->`; marker text is stripped from fetched state JSON bodies.

## CLI Contracts

All scripts support `--help` (stdout, exit `0`). Usage errors exit `2`. Operational errors exit `1`.

### fetch-review-state (network)

```bash
node scripts/pr/fetch-review-state.mjs [--pr <url>] [--out <path.md>|-] [--out-json <path.json>|-] [--help]
```

- Fetches unresolved review threads, submitted review bodies, and PR issue comments.
- Emits canonical `review-state.json` (v1, node-id-only).
- Markdown output is derived.
- If `--out` is omitted, markdown is written to stdout.
- If `--out-json` is omitted and `--out` is a file path, JSON defaults to the same path with `.json`.
- Requires `git` and authenticated `gh`.

Examples:

```bash
node scripts/pr/fetch-review-state.mjs --pr https://github.com/OWNER/REPO/pull/123 --out-json review-state.json
node scripts/pr/fetch-review-state.mjs --pr <url> --out review-state.md --out-json review-state.json
node scripts/pr/fetch-review-state.mjs --pr <url> --out - --out-json -
```

### render-review-state (pure)

```bash
node scripts/pr/render-review-state.mjs --in <review-state.json> [--out <review-state.md>|-] [--help]
```

### summarize-review-state (pure)

```bash
node scripts/pr/summarize-review-state.mjs --in <review-state.json> [--format text|json] [--out <path>|-] [--help]
```

- `--format` defaults to `text`.
- `--out` defaults to stdout.

### render-review-actions (pure)

```bash
node scripts/pr/render-review-actions.mjs --in <review-actions.json> [--out <review-actions.md>|-] [--help]
```

### apply-review-actions (network, idempotent)

```bash
node scripts/pr/apply-review-actions.mjs --in <review-actions.json> [--review-state <review-state.json>] [--apply] [--dry-run] [--format text|json] [--log-out <apply-log.json>] [--help]
```

- `--dry-run` is the default mode.
- `--apply` enables mutations explicitly.
- `--format` defaults to `text`.
- Planner/executor operate on node ids and ensure no duplicate done replies/reactions.
- TLS/certificate failures fail fast with rerun guidance for non-sandbox shells; TLS verification must stay enabled.

Examples:

```bash
node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --review-state <review-state.json> --format text
node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --review-state <review-state.json> --apply --format json --log-out <apply-log.json>
```

### review-iterate (network wrapper)

```bash
node scripts/pr/review-iterate.mjs --pr <url> [--reviews-root <dir>] [--apply] [--help]
```

- Runs fetch, render, summarize, optional actions render, and apply planning in one deterministic wrapper.
- Writes artifacts under `<reviews-root>/<owner>_<repo>_pr-<number>/`.
- Uses dry-run apply by default; `--apply` executes mutations.

## review-artifacts Utilities

`scripts/pr/review-artifacts.mjs` provides canonical TG1 artifact logic:

- runtime validators (`assertReviewStateV1`, `assertReviewActionsV1`)
- marker stripping (`stripReviewFrameworkMarkers`)
- deterministic normalization/sorting helpers for review-state v1
- deterministic JSON formatting (`formatCanonicalJson`)

## Fixtures and Tests

Fixtures in `scripts/pr/fixtures/`:

- `review-state.v1.json`
- `review-actions.v1.json`

Run tests:

```bash
node --test scripts/pr/**/*.test.mjs
```
