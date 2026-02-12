---
name: github-review-iteration
description: Shepherds a GitHub PR through review by fetching review state, triaging threads into an action plan, implementing fixes with granular commits, and resolving threads. Use when the user says “address PR review”, “triage review comments”, or “iterate until review is clean”.
argument-hint: "[pr-url] [agent-os/specs/<spec>/]"
disable-model-invocation: true
---

# GitHub Review Iteration

Run the PR review loop using the repo’s `agent-os` commands and review archetypes.

## Usage

Preferred (full loop):

```
/agent-os/iterate-review <PR_URL> agent-os/specs/<spec>/
```

Or step-by-step:

```
/agent-os/triage-review agent-os/specs/<spec>/
/agent-os/address-review-actions agent-os/specs/<spec>/
```

## Files written (by default)

Given a spec folder `agent-os/specs/<spec>/`:

- `agent-os/specs/<spec>/reviews/pr-review.md`
- `agent-os/specs/<spec>/reviews/review-actions.md`

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
