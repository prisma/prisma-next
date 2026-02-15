# Review Fetch Phase (State Acquisition)

Run only the **state acquisition** phase of the review-framework loop:

**fetch canonical review state JSON → render derived markdown → write summary**

Use this when the user wants to execute or delegate only the "fetch/read current PR review state" part of the workflow, without triage/implementation/apply.

## Inputs

- Required:
  - PR URL (for example: `https://github.com/OWNER/REPO/pull/123`)
- Optional:
  - output directory

If output directory is omitted, derive:

`agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/`

## Behavior

1. Validate/parse PR URL and compute deterministic output paths:
   - `<output-dir>/review-state.json`
   - `<output-dir>/review-state.md`
   - `<output-dir>/summary.txt`
2. Ensure `<output-dir>` exists.
3. Run fetch script to produce canonical JSON:

```bash
node scripts/pr/fetch-review-state.mjs --pr <PR_URL> --out-json <output-dir>/review-state.json
```

4. Render markdown from canonical JSON:

```bash
node scripts/pr/render-review-state.mjs --in <output-dir>/review-state.json --out <output-dir>/review-state.md
```

5. Generate text summary from canonical JSON:

```bash
node scripts/pr/summarize-review-state.mjs --in <output-dir>/review-state.json --format text --out <output-dir>/summary.txt
```

## Error handling / reliability

- Treat fetch failures as operational errors.
- If `gh api` fails with TLS/cert errors in sandbox (`x509` / `OSStatus -26276` patterns), fail fast and instruct rerun outside sandbox.
- Never disable TLS verification.

## Output to user

Return the concrete artifact paths written:

- `review-state.json`
- `review-state.md`
- `summary.txt`

If the user wants, suggest next phase command:

- `/agent-os/review-apply-phase <PR_URL> [output-dir]`
