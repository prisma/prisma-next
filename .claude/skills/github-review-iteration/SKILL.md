---
name: github-review-iteration
description: Shepherds a GitHub PR through review by fetching review state, triaging threads into an action plan, implementing fixes with granular commits, and resolving threads. Use when the user says “address PR review”, “triage review comments”, or “iterate until review is clean”.
argument-hint: "[triage|implement|iterate] [pr-url] [output-dir]"
disable-model-invocation: true
---

# GitHub Review Iteration

Run an iterative PR review loop: **fetch review state → triage → implement → resolve → repeat** until the PR has no remaining actionable review items.

## Usage

This skill supports subcommands:
- `triage`: fetch + triage into structured actions
- `implement`: execute the triaged actions and update status
- `iterate`: loop `triage` → `implement` until clear (default)

```
/github-review-iteration iterate <PR_URL> <output-dir>
```

Example:

```
/github-review-iteration iterate https://github.com/OWNER/REPO/pull/123 agent-os/specs/2026-02-10-postgres-one-liner-lazy-client/reviews/
```

## Files written (by default)

Given an output directory `<output-dir>/`:

- **Fetch output (human + machine)**:
  - `<output-dir>/review-state.md`
  - `<output-dir>/review-state.json`
- **Triage / action plan (human + machine)**:
  - `<output-dir>/review-actions.md`
  - `<output-dir>/review-actions.json`

## Behavioral rules

- **WILL ADDRESS** items:
  - reply + 👍
  - leave unresolved until fixed
- **Not addressed in this PR** items:
  - reply with rationale + 👎
  - resolve the thread
- **Implementation**:
  - granular, intent-driven commits
  - explicit staging only (never `git add -A` / `git add .`)
  - reply “Done” and resolve when complete

## Data exchange format (triager → implementer)

`review-actions.json` is the contract between the triager and implementer.

Minimum schema (versioned):

```json
{
  "version": 1,
  "pr": { "url": "https://github.com/OWNER/REPO/pull/123" },
  "reviewState": { "path": "review-state.json", "fetchedAt": "..." },
  "actions": [
    {
      "actionId": "A-001",
      "thread": { "threadId": "PRRT_xxx", "commentDatabaseId": 123, "url": "..." },
      "decision": "will_address",
      "summary": "One-line description of what will be done",
      "targetFiles": ["path/to/file.ts"],
      "acceptance": "How to tell it's done",
      "status": "pending",
      "doneSummary": null,
      "commits": []
    }
  ]
}
```

The implementer updates `status`, `doneSummary`, and `commits` in-place as work proceeds.

## Procedure

### `triage`

1. **Fetch review state**

Use the repo script when available:

```bash
node scripts/pr/fetch-review-state.mjs --pr <PR_URL> --out <output-dir>/review-state.md
```

2. **Triage into actions**

Create `<output-dir>/review-actions.md` containing only **WILL ADDRESS** items, each with:
- the thread/comment identifier
- a link to the thread/comment
- the action to take + target files
- an acceptance check
- a resolve marker (so the implementer can resolve the right thread)

Also write `<output-dir>/review-actions.json` following the schema above.

Administer threads while triaging:
- WILL ADDRESS → reply intention + 👍, leave unresolved
- NOT ADDRESSED → reply rationale + 👎, resolve

### `implement`

Work through `review-actions.md`, making focused commits. For each action/thread:
- when starting: reply “On it” + 👍 (leave unresolved)
- when done: reply “Done” + resolve thread

Update `<output-dir>/review-actions.json` in-place:
- set `status: in_progress` when starting
- set `status: done`, `doneSummary`, and `commits` when finished

### `iterate`

Repeat `triage` → `implement` until there are no remaining actionable review items.

## Optional shortcuts (repo-specific)

If this repo provides dedicated slash commands or subagents for triage/implementation, prefer them to reduce manual steps.
