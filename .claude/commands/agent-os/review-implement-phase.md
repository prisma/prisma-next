# Review Implement Phase (Code Changes + Thread Updates)

Run only the **implementation** phase of the review-framework loop:

**take triaged `will_address` actions → make code changes → commit in small logical steps → post "On it"/"Done" updates on GitHub → update action status fields**

Use this when the user wants to execute or delegate fixing triaged review items without running full iterate orchestration.

## Inputs

- Required:
  - PR URL
  - existing `review-actions.json` in output dir
- Optional:
  - output directory
  - scope constraints (specific action IDs or files)

If output directory is omitted, derive:

`agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/`

## Preconditions

`<output-dir>/review-actions.json` must exist and be valid v1.

If missing, instruct user to run:

- `/agent-os/review-fetch-phase <PR_URL> [output-dir]`
- `/agent-os/review-triage-phase <PR_URL> [output-dir]`

## Behavior

1. Read canonical actions JSON and select actionable items:
   - `decision: will_address`
   - `status: pending | in_progress`
2. Delegate to `.claude/agents/agent-os/review-implementer.md` with:
   - PR URL
   - `<output-dir>/review-actions.json`
   - `<output-dir>/review-actions.md` (if present)
3. Require implementer responsibilities:
   - make the code changes
   - run relevant checks
   - create focused commits
   - post "On it" when starting each action
   - post "Done" and resolve thread when finished
   - only set action `status: done` after GitHub "Done" + thread resolution succeeds
   - update `review-actions.json` (`status`, `done.doneAt`, `done.summary`, `done.commits`) in the same completion step
4. Render latest actions markdown for visibility:

```bash
node scripts/pr/render-review-actions.mjs --in <output-dir>/review-actions.json --out <output-dir>/review-actions.md
```

## Ownership (important)

- The **implement phase** is responsible for actual fixes and posting "Done" updates tied to completed code changes.
- The **apply phase** is optional fallback tooling for exceptional cleanup/recovery, not part of the default loop.

## Output to user

Return:

- commits created
- actions transitioned to done
- paths written (`review-actions.json`, `review-actions.md`)

Suggest next step:

- `/agent-os/review-fetch-phase <PR_URL> [output-dir]` to refresh state
- then `/agent-os/review-triage-phase <PR_URL> [output-dir]` to decide if another implementation pass is needed
