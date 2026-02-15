---
name: github-review-iteration
description: Orchestrates a GitHub PR review loop by delegating triage and implementation to dedicated sub-agents, then repeating until actionable review items are cleared. Use when the user says “address PR review”, “triage review comments”, or “iterate until review is clean”.
argument-hint: "[triage|implement|iterate] [pr-url] [output-dir]"
disable-model-invocation: true
---

# GitHub Review Iteration

Run an iterative PR review loop: **fetch state → render/summarize → triage actions → implement (code + Done + resolve) → re-fetch** until the PR has no remaining actionable items.

This skill is an **orchestrator**. It delegates:

- triage to `.claude/agents/agent-os/review-triager.md`
- implementation to `.claude/agents/agent-os/review-implementer.md`

The orchestrator owns sequencing, handoff, and loop control. It does not perform triage or implementation directly when delegation is available.

## Usage

This skill supports subcommands:
- `triage`: fetch + triage into structured actions
- `implement`: execute the triaged actions and update status
- `iterate`: loop `triage` → `implement` until clear (default)

```
/github-review-iteration iterate <PR_URL> [output-dir]
```

When `output-dir` is omitted, use the standard layout: `agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/` (derived from PR URL).

Example:

```
/github-review-iteration iterate https://github.com/OWNER/REPO/pull/123
```

## Files written (deterministic layout)

Store artifacts under:

`agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/`

Canonical artifacts:

- `review-state.json` (canonical v1)
- `review-actions.json` (canonical v1)

Derived artifacts:

- `review-state.md`
- `summary.txt` (or JSON summary)
- `review-actions.md`
- `apply-log.json` (optional)

When you need a thin wrapper for path setup + standard script calls, run:

```bash
node scripts/pr/review-iterate.mjs --pr <PR_URL>
```

Use `--apply` only when ready to execute GitHub mutations.

For phase-specific execution without full orchestration, use:

- `/agent-os/review-fetch-phase <PR_URL> [output-dir]`
- `/agent-os/review-triage-phase <PR_URL> [output-dir]`
- `/agent-os/review-implement-phase <PR_URL> [output-dir]`

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

## Operational reliability notes (Cursor)

### `gh api` TLS / cert failures in sandboxed shells

If GitHub administration fails with an error like:

- `x509: OSStatus -26276` (or similar TLS/certificate verification failures)

Treat it as an **environment/sandbox cert-store mismatch**, not a script bug.

Recovery:

- Re-run the affected `gh` calls **outside** the sandbox (use a shell mode that uses the system cert store).
- Do **not** disable TLS verification (no `GH_NO_VERIFY_SSL`, no custom curl flags).
- After re-running, continue the loop normally (fetch → triage → implement → resolve → repeat).

### JSON-first deterministic commands

1. Fetch canonical JSON:

```bash
node scripts/pr/fetch-review-state.mjs --pr <PR_URL> --out-json <review-dir>/review-state.json
```

2. Render and summarize from JSON (pure scripts):

```bash
node scripts/pr/render-review-state.mjs --in <review-dir>/review-state.json --out <review-dir>/review-state.md
node scripts/pr/summarize-review-state.mjs --in <review-dir>/review-state.json --format text --out <review-dir>/summary.txt
```

3. Render triage plan from canonical actions JSON:

```bash
node scripts/pr/render-review-actions.mjs --in <review-dir>/review-actions.json --out <review-dir>/review-actions.md
```

4. Optional recovery-only admin actions:

```bash
# default behavior is dry-run
node scripts/pr/apply-review-actions.mjs --in <review-dir>/review-actions.json --review-state <review-dir>/review-state.json --format text

# execute only after reviewing dry-run output
node scripts/pr/apply-review-actions.mjs --in <review-dir>/review-actions.json --review-state <review-dir>/review-state.json --apply --format text --log-out <review-dir>/apply-log.json
```

## Data exchange format (triager → implementer)

`review-actions.json` is the contract between the triager and implementer.

Minimum v1 shape:

```json
{
  "version": 1,
  "pr": { "url": "https://github.com/OWNER/REPO/pull/123", "nodeId": "PR_kw..." },
  "reviewState": { "path": "review-state.json", "fetchedAt": "..." },
  "actions": [
    {
      "actionId": "A-001",
      "target": { "kind": "review_thread", "nodeId": "PRRT_xxx", "url": "..." },
      "decision": "will_address",
      "summary": "One-line description of what will be done",
      "rationale": null,
      "targetFiles": ["path/to/file.ts"],
      "acceptance": "How to tell it's done",
      "status": "pending",
      "done": null
    }
  ]
}
```

Rules:

- Use **node ids only** for targets (`target.nodeId`).
- Preserve `actions[]` order intentionally (do not reorder).
- Implementer updates `status` (`pending|in_progress|done`) and `done` records in place.

## Procedure

### `triage`

1. **Delegate to triage sub-agent**

Invoke the review triager agent at `.claude/agents/agent-os/review-triager.md` and pass:

- PR URL
- output paths:
  - `<output-dir>/review-state.md`
  - `<output-dir>/review-state.json`
  - `<output-dir>/review-actions.md`
  - `<output-dir>/review-actions.json`
- optional scope constraints

2. **Require triage outputs**

The triager must:

- fetch review state (via `scripts/pr/fetch-review-state.mjs`)
- triage review threads into `review-actions.json` decisions/status
- write/update `review-actions.md` and `review-actions.json`

3. **Validate handoff contract**

Before returning from `triage`, verify that `<output-dir>/review-actions.json` exists and is valid for implementer consumption (`version`, PR metadata, and `actions[]` with `target.kind` + `target.nodeId`).

### `implement`

1. **Delegate to implementation sub-agent**

Invoke the review implementer agent at `.claude/agents/agent-os/review-implementer.md` and pass:

- PR URL
- `<output-dir>/review-actions.md`
- `<output-dir>/review-actions.json`
- optional scope constraints

2. **Require implementation outputs**

The implementer must:

- work through pending `will_address` actions
- make focused, explicit-staging commits
- run smallest relevant checks per action
- reply "On it" when starting, then "Done" and resolve the thread when complete
- update `review-actions.json` in-place (`status`, `done`)
- re-fetch review state at the end to verify remaining actionable items

Responsibility note:
- Posting "Done" and resolving completed threads belongs to the implementer phase and is part of marking actions done.
- `apply-review-actions` is an optional idempotent safety net for exceptional recovery, not the default loop.

### `iterate`

Repeat delegated `triage` → delegated `implement` until there are no remaining actionable review items.

Loop contract:

1. Run `triage` delegation and read resulting `review-actions.json`.
2. If no pending `will_address` actions remain, stop and report completion.
3. Run `implement` delegation.
4. Re-run `triage` delegation to refresh state and determine next iteration.
5. Continue until clear.

## Optional shortcuts (repo-specific)

If this repo provides dedicated slash commands or subagents for triage/implementation, prefer them to reduce manual steps.
