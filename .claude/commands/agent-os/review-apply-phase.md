# Review Apply Phase (Action Administration)

Run only the **action administration** phase of the review-framework loop:

**render actions markdown (if present) → plan dry-run operations → optionally apply operations**

Use this when the user wants to execute or delegate only the "act on triaged review actions" part of the workflow.

## Inputs

- Required:
  - PR URL (for context and path derivation)
  - existing `review-actions.json` in output dir
- Optional:
  - output directory
  - apply mode (`--apply`) or dry-run (default)

If output directory is omitted, derive:

`agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/`

## Preconditions

`<output-dir>/review-actions.json` must exist and be valid v1.

If missing, instruct user to run:

- `/agent-os/review-fetch-phase <PR_URL> [output-dir]`
- then triage to produce/update `review-actions.json`
- then implement to complete code changes and mark actions done

## Behavior

1. Compute deterministic paths:
   - `<output-dir>/review-actions.json`
   - `<output-dir>/review-actions.md`
   - `<output-dir>/review-state.json` (optional but preferred if present)
   - `<output-dir>/apply-log.json` (when applying with JSON log)
2. If actions JSON exists, render markdown for review:

```bash
node scripts/pr/render-review-actions.mjs --in <output-dir>/review-actions.json --out <output-dir>/review-actions.md
```

3. Plan actions with dry-run (default):

```bash
node scripts/pr/apply-review-actions.mjs --in <output-dir>/review-actions.json --review-state <output-dir>/review-state.json --dry-run --format text
```

If `review-state.json` is absent, omit `--review-state`.

4. Only when explicitly requested, execute apply:

```bash
node scripts/pr/apply-review-actions.mjs --in <output-dir>/review-actions.json --review-state <output-dir>/review-state.json --apply --format text --log-out <output-dir>/apply-log.json
```

If `review-state.json` is absent, omit `--review-state`.

5. After apply, re-run fetch + triage before any subsequent apply run.
   - This prevents acting on stale historical `done` actions.
   - `apply-review-actions` now records `done.githubAdmin` metadata in `review-actions.json`, and planner treats those actions as already administered.

## Error handling / reliability

- Keep behavior idempotent and retry-safe.
- Completed actions with `done.githubAdmin` are treated as already applied (noop).
- Treat API errors as operational failures.
- If `gh api` fails with TLS/cert errors in sandbox (`x509` / `OSStatus -26276` patterns), fail fast and instruct rerun outside sandbox.
- Never disable TLS verification.

## Output to user

Always report:

- whether run was dry-run or apply
- operation summary (planned/executed/no-op)
- paths written (`review-actions.md`, optional `apply-log.json`)

If needed, suggest refresh:

- `/agent-os/review-fetch-phase <PR_URL> [output-dir]`
