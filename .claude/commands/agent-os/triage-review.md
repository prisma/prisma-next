# PR Review Triage (Iterative)

This command fetches the current GitHub PR review state for the **current branch**, triages review comments into an action list, and administers review threads (reply/react/resolve) to keep the PR moving.

It delegates the triage work to the **review-triager** subagent.

## PHASE 1: Determine the PR + output location

You need:

- PR URL (preferred), or enough context to discover it from the current branch.
- The spec folder to write review artifacts into.

If the spec folder path is not provided, ask and WAIT:

```
Please point me to the spec folder for this PR so I can write review artifacts.

Preferred: agent-os/specs/<spec>/
```

Once you have `agent-os/specs/[this-spec]/`, define:

- `pr-review.md`: `agent-os/specs/[this-spec]/reviews/pr-review.md`
- `review-actions.md`: `agent-os/specs/[this-spec]/reviews/review-actions.md`

## PHASE 2: Fetch review state

Run:

```bash
node scripts/pr/fetch-review-state.mjs --pr <PR_URL> --out agent-os/specs/[this-spec]/reviews/pr-review.md
```

## PHASE 3: Delegate to review-triager

Delegate to **review-triager** with:

- PR URL
- `agent-os/specs/[this-spec]/reviews/pr-review.md`
- `agent-os/specs/[this-spec]/reviews/review-actions.md`

Instruct it to:

- Triaging rules:
  - For items that will be addressed: reply + 👍 and leave unresolved
  - For items not addressed in this PR: reply with rationale + 👎 and resolve
- Write `review-actions.md` containing only **WILL ADDRESS** items with resolve markers.

## PHASE 4: Report

After delegation completes, report:

- Path to `pr-review.md`
- Path to `review-actions.md`
- Count of remaining unresolved threads to address
