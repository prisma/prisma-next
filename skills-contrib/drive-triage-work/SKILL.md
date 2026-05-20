---
name: drive-triage-work
description: >
  Routes an incoming ask (or mid-flight scope-shift signal) to one of eight triage
  verdicts: direct change / orphan slice / in-project slice / new project / promote /
  demote / spike first / defer. Use when picking up a Linear ticket, bug report, customer
  ask, or "I should do X" thought — at any fresh entry into Drive AND mid-flight when
  scope shifts. Returns a verdict + a one-paragraph rationale; the verdict's setup chain
  is executed by drive-start-workflow (or by the operator directly).
metadata:
  version: "2026.5.18"
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force. Outputs land in `projects/<current-project>/` (spec / plan / design notes), in Linear (via MCP), or in the conversation surface (verdicts, briefs, summaries).
>
> If the skill's body asks for work that requires reading source code, running builds/tests, or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Orchestrator role definition.

# Drive: Triage Work

Runs the triage decision tree on an incoming entry-point (or a mid-flight scope-shift signal). Atomic skill — does one thing: produces a verdict.

The eight verdicts:

| Verdict | What it means | Routes to |
|---|---|---|
| **Direct change** | One PR; no spec, no plan, no dispatch ceremony. Trivial enough that a reviewer can verify by reading the diff in ~30 seconds. | `gh pr create` via `drive-pr-description` (direct-change framing). |
| **Orphan slice** | One PR-sized unit, slice spec inline in the PR description; no `projects/<x>/`. | `drive-specify-slice` (orphan mode) → `drive-build-workflow`. |
| **In-project slice** | One PR-sized unit within an existing project's scope; slice spec under `projects/<project>/slices/<slice>/`. | `drive-specify-slice` (in-project mode) → `drive-build-workflow`. |
| **New project** | Composition of multiple slices under one purpose; full project ceremony. | `drive-create-project` → `drive-specify-project` → `drive-plan-project` → `drive-deliver-workflow`. |
| **Promote** | Mid-flight: an in-flight slice has grown beyond one PR; create a Linear Project and migrate. | Promotion ceremony (Linear MCP + `drive-create-project` + `drive-specify-project`). |
| **Demote** | Mid-flight: an in-flight project has shrunk to fit one PR; close down the project ceremony. | Demotion ceremony (Linear MCP + on-disk migration + delete `projects/<project>/`). |
| **Spike first** | The entry-point can't be sized without a probe; need an investigation dispatch. | `drive-build-workflow` with a spike-flavoured brief; re-triage on artefact. |
| **Defer** | Out-of-scope for current work; don't act, but don't lose. | Record in `projects/<x>/deferred.md` (in-project) or operator scratch (orphan). |

## When to use

Use **at every fresh entry into Drive** (typically called by `drive-start-workflow`, but invokable directly by the operator):

- A Linear ticket lands.
- A bug report or customer ask arrives.
- The operator notices "I should do X."

Use **mid-flight when scope shifts**:

- An in-flight slice is growing beyond one PR (candidate for **promote**).
- An in-flight project's remaining scope is now one PR (candidate for **demote**).
- Operator-initiated scope re-evaluation.
- `drive-check-health` surfaces a scope-shift signal.

**Do not use this skill for:**

- Re-checking a verdict that hasn't had a scope-shift signal. Triage is for entry + scope-shift, not for double-checking.
- Picking *which slice to work next* within a project — that's `drive-deliver-workflow`'s pick-next-slice logic, not triage.
- Sizing dispatches inside a slice plan — that's `drive-plan-slice`.

## Pre-conditions

- An entry-point input: ticket text / bug description / "I should do X" sentence / scope-shift signal.
- For mid-flight invocations: the in-flight unit (slice path, project path, Linear ID) identified.
- Optional: `drive/triage/README.md` exists with team-specific triage heuristics, sizing anchors, calibration.

## Post-conditions

- Exactly one of the eight verdicts emitted.
- A one-paragraph rationale explaining the verdict choice (which decision-tree branches fired; what evidence the operator should re-check if disagreeing).
- For verdicts with operator-authorisation requirements (promote / demote): a "needs operator authorisation" flag set.

## Project context

Load `drive/triage/README.md` at workflow step 1 if it exists. This is the team's accumulated triage protocol — reference tasks for sizing, ticket-shape patterns the team has learned to recognise, calibration ("what's a direct change in this repo vs an orphan slice"), Linear-sync conventions for promote / demote ceremonies.

## Workflow

### Step 1 — Load project context

Read `drive/triage/README.md` if it exists.

### Step 2 — Read the entry point

For fresh entries: read the Linear ticket / bug report / ask text. For mid-flight: read the in-flight slice spec / project spec + plan + current PR(s) in flight.

### Step 3 — Run the decision tree

In order — first branch that fires wins.

```text
Q0. Is this a mid-flight scope-shift signal (rather than a fresh entry)?
    │
    ├─ Yes → go to Q5 (promote/demote)
    │
    └─ No → continue to Q1

Q1. Is the entry-point so unclear or open-ended that no sizing is yet possible?
    │
    ├─ Yes → SPIKE FIRST
    │
    └─ No → continue to Q2

Q2. Is the work out-of-scope for what we'd want to do now?
    │
    ├─ Yes → DEFER
    │
    └─ No → continue to Q3

Q3. Is the work trivial enough that a reviewer can verify the diff in ~30 seconds?
    (One-line bugfix; config flip; copy change; small refactor whose
    correctness is obvious from reading the diff.)
    │
    ├─ Yes → DIRECT CHANGE
    │
    └─ No → continue to Q4

Q4. Does the work fit in one PR (i.e. is it slice-sized, not project-sized)?
    │
    ├─ Yes → continue to Q4a
    │
    └─ No  → continue to Q4b

Q4a. Does the work fit naturally inside an existing open project's scope?
    │
    ├─ Yes → IN-PROJECT SLICE
    │
    └─ No  → ORPHAN SLICE

Q4b. (Doesn't fit in one PR — therefore project-sized.) → NEW PROJECT

Q5. (Mid-flight scope-shift signal.) What's the direction of the shift?
    │
    ├─ Growing past one PR → PROMOTE
    │
    └─ Shrinking to one PR → DEMOTE
```

### Step 4 — Sanity check the verdict against team-context calibration

If `drive/triage/README.md` carries a reference-task table or sizing anchor: cross-check the candidate verdict against the anchors. (For example: "we said this is a direct change because it's a one-line message edit, but our reference says 'one-line message edits in user-visible surfaces are slices not direct changes due to localisation review' — re-route.")

### Step 5 — Emit the verdict + rationale

Output:

- The verdict (one of the eight).
- A one-paragraph rationale explaining which decision-tree branches fired and what evidence supports them.
- The "operator authorisation required" flag (true for promote / demote; false otherwise).
- The recommended next skill / setup chain (for callers, especially `drive-start-workflow`).

## Sizing heuristics

Default heuristics for the four "size" questions. Teams should override / extend in `drive/triage/README.md`.

**Q1 — Is the work spike-shaped?**

- The ask references "we should figure out…", "investigate…", "find out whether…" without a clear deliverable.
- The agent or operator can't answer "what file or test would change?" within a couple of minutes of reading.
- Likely scope ranges across multiple orders of magnitude depending on what's discovered.

**Q3 — Is the work direct-change-shaped?**

- The diff would be 1-3 files changed; the change pattern would be obvious from reading any one chunk.
- Reviewer time: ~30 seconds to ~2 minutes.
- No new design decisions; no new tests; no migration of existing call sites.
- Examples: typo fix; one-line condition flip; config value bump; doc clarification.

**Q4 — Does the work fit in one PR?**

- PR-cap test: would the resulting PR be reviewable in one sitting (~30 min) and rollback-able as one unit?
- If the work spans more than ~3 logical layers (e.g. contract IR + emitter + fixtures + adapter), it's likely project-sized.
- If you'd need to stack 2+ PRs to deliver the value end-to-end, it's project-sized.
- Spikes are slice-sized by default (single-dispatch slice plan), not project-sized.

**Q4a — Does it fit inside an existing open project?**

- Read the open project's spec: is the new work within the project's purpose statement?
- If yes: in-project slice.
- If no but adjacent: orphan slice or new project (depending on size).

**Q5 — Promote or demote?**

- Promote: the slice's PR diff would be too big to review in one sitting, OR the slice plan now lists 4+ dispatches with cross-area dependencies, OR new work has surfaced that's clearly inside the same purpose.
- Demote: of the project's remaining slices, only one is non-trivial; the rest are already done or no longer needed; the remaining work fits one PR.

## Pitfalls

1. **Defaulting to "new project" because the work feels important.** Triage is about *size and shape*, not importance. A single-line copy fix to a critical user-visible string is still a direct change; a six-PR refactor of a non-critical internal helper is still a project.
2. **Routing trivial-but-risky work as direct change.** "Trivial" is about diff size + verifiability, not blast radius. A one-line config change that flips behaviour for all users should be an orphan slice (or in-project slice) so it goes through DoR + DoD + review.
3. **Skipping the existing-project check (Q4a) and routing slice-sized work as a new project.** Every project has gravity; once a project exists for the purpose, additional same-purpose work is in-project, not a new project.
4. **Triage that consults the team's calibration but ignores the operator's context.** The operator may know things the calibration doesn't (e.g. "this user-visible string is going to be deprecated next week, so the bug isn't worth shipping a fix for" → defer, not direct-change). Treat calibration as one input, not the verdict.
5. **Promote / demote without operator authorisation.** Linear side-effects are visible. Always set the authorisation flag and let `drive-start-workflow` (or the operator) handle the confirmation step before any Linear changes happen.
6. **Spike-first verdict that becomes implementation by stealth.** The spike's DoD is "the artefact answers the planning question." If the spike turns into a code-committing dispatch, that's not a spike — re-triage the work properly.

## Checklist

- [ ] Loaded `drive/triage/README.md` (if exists)
- [ ] Read the entry-point input
- [ ] Ran the decision tree; first-firing branch wins
- [ ] Sanity-checked against team-context calibration anchors
- [ ] Emitted verdict + one-paragraph rationale
- [ ] Set "operator authorisation required" flag for promote / demote
- [ ] Recommended next skill / setup chain for the caller

## Related skills

- `drive-start-workflow` — pilots triage + the verdict's setup chain; this skill is its decision-making step
- `drive-build-workflow` — what the verdict routes to for slice-sized work
- `drive-deliver-workflow` — what the verdict routes to for project-sized work
- `drive-discussion` — fires when triage uncovers a question the operator needs to answer (e.g. unclear scope; ambiguous purpose)
- `drive-pr-description` (direct-change framing) — what the verdict routes to for direct-change work

## References

- [`drive/triage/README.md`](../../drive/triage/README.md) — triage workflow outputs, team calibration anchors, spike-first conventions
- [`drive/plan/README.md`](../../drive/plan/README.md) — sizing discipline this skill enforces
