# Review Triage Phase (Action Planning)

Run only the **triage** phase of the review-framework loop:

**read current review state artifacts → produce/update canonical review-actions.json → render review-actions.md**

Use this when the user wants to decide what to do about review feedback without executing implementation or GitHub admin mutations.

## Inputs

- Required:
  - PR URL (for context and path derivation)
- Optional:
  - output directory

If output directory is omitted, derive:

`agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/`

## Preconditions

Expected inputs in output dir:

- `<output-dir>/review-state.json`
- `<output-dir>/review-state.md` (optional but useful for human inspection)
- `<output-dir>/summary.txt` (optional)

If `review-state.json` is missing, instruct user to run:

- `/agent-os/review-fetch-phase <PR_URL> [output-dir]`

## Behavior

1. Compute deterministic paths:
   - `<output-dir>/review-state.json`
   - `<output-dir>/review-actions.json`
   - `<output-dir>/review-actions.md`
2. Delegate triage to the dedicated subagent:
   - `.claude/agents/agent-os/review-triager.md`
3. Require triager output contract:
   - `review-actions.json` must be valid v1
   - targets use node ids only
   - actions are ordered intentionally and not re-ordered
4. Render markdown from canonical actions JSON:

```bash
node scripts/pr/render-review-actions.mjs --in <output-dir>/review-actions.json --out <output-dir>/review-actions.md
```

## Output to user

Return the concrete artifact paths written:

- `review-actions.json`
- `review-actions.md`

Suggest next phase command when appropriate:

- `/agent-os/review-apply-phase <PR_URL> [output-dir]`
