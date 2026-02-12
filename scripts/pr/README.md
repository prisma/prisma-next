# PR utilities

Scripts for deterministic GitHub PR review artifacts and rendering workflows.

## fetch-review-state

Fetches PR review state (unresolved review threads, submitted reviews with bodies, PR issue comments), then emits canonical `review-state.json` v1 (node-id-only) plus derived Markdown output.

```bash
# Discover PR from current branch
node scripts/pr/fetch-review-state.mjs

# Explicit PR URL
node scripts/pr/fetch-review-state.mjs --pr https://github.com/OWNER/REPO/pull/123

# Write to file (Markdown + inferred JSON path)
node scripts/pr/fetch-review-state.mjs --pr <url> --out review-state.md

# Also write JSON explicitly
node scripts/pr/fetch-review-state.mjs --pr <url> --out review-state.md --out-json review-state.json

# Stdout (both derived Markdown + canonical JSON)
node scripts/pr/fetch-review-state.mjs --pr <url> --out - --out-json -
```

Requires `git` and authenticated `gh`.

## review-artifacts utilities

`scripts/pr/review-artifacts.mjs` contains TG1 canonical artifact logic:

- v1 runtime validators (`assertReviewStateV1`, `assertReviewActionsV1`)
- marker stripping (`stripReviewFrameworkMarkers`)
- deterministic normalization/sorting helpers for review-state v1
- deterministic artifact formatting (`formatCanonicalJson`)

## Fixtures

Small stable v1 fixtures live in `scripts/pr/fixtures/`:

- `review-state.v1.json`
- `review-actions.v1.json`

## Tests

Run all PR script tests:

```bash
node --test scripts/pr/**/*.test.mjs
```

## render-review-actions

Renders deterministic `review-actions.md` from `review-actions.json` (a pure transformation).

```bash
node scripts/pr/render-review-actions.mjs --in agent-os/specs/.../reviews/review-actions.json --out agent-os/specs/.../reviews/review-actions.md
```

## apply-review-actions

Plans idempotent review admin operations and optionally applies GitHub mutations. Default mode is `--dry-run`.

```bash
# Dry-run plan (default)
node scripts/pr/apply-review-actions.mjs --in agent-os/specs/.../reviews/review-actions.json --review-state agent-os/specs/.../reviews/review-state.json --format text

# Execute mutations explicitly
node scripts/pr/apply-review-actions.mjs --in agent-os/specs/.../reviews/review-actions.json --review-state agent-os/specs/.../reviews/review-state.json --apply --format json --log-out agent-os/specs/.../reviews/apply-log.json
```

Behavior:

- Uses a pure planner (`apply-review-actions-planner.mjs`) to compute deterministic operations.
- Uses ensure semantics for reply/reaction/resolve operations with node IDs only.
- Fails fast on TLS/certificate failures and instructs rerun outside sandbox (never disable TLS verification).
- Records execution output as a derived apply log (`--log-out`).

### Manual verification checklist (real PR required)

Run these checks against a real pull request and keep the output in your implementation notes:

```bash
# 1) Dry-run plan
node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --review-state <review-state.json> --dry-run --format json

# 2) Apply
node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --review-state <review-state.json> --apply --format json --log-out <apply-log.json>

# 3) Re-run apply to confirm idempotent no-op behavior
node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --review-state <review-state.json> --apply --format json --log-out <apply-log.json>
```

See `agent-os/specs/review-framework/spec.md` for framework contracts.
