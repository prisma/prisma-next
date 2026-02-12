# Address PR Review Actions

This command implements the actionable review items produced by `/agent-os/triage-review`.

It delegates implementation to the **review-implementer** subagent, which will make granular commits and resolve GitHub review threads with “Done” replies when finished.

## PHASE 1: Locate the action plan

You need the spec folder path. If not provided, ask and WAIT:

```
Please point me to the spec folder for this PR.

Preferred: agent-os/specs/<spec>/
```

Read:
- `agent-os/specs/[this-spec]/reviews/review-actions.md`

If it says “Complete / No remaining actionable review items”, stop and report completion.

## PHASE 2: Delegate to review-implementer

Delegate to **review-implementer** with:

- PR URL
- `agent-os/specs/[this-spec]/reviews/review-actions.md`

Instruct it to:

- For each action row:
  - Post a short “On it” reply with 👍 (leave unresolved)
  - Implement the change
  - Run the smallest relevant checks
  - Commit a focused change (explicit staging; no `git add -A` / `git add .`; no amend)
  - Reply “Done” and resolve the thread
- Do not commit unrelated untracked directories (review snapshots, script scaffolding, scratch work).

## PHASE 3: Report

After delegation completes, report:

- Commits created (sha + message)
- Threads resolved
- Any remaining unresolved actionable threads
