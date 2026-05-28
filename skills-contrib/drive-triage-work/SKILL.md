---
name: drive-triage-work
description: >
  Routes an incoming entry-point to one of three delivery shapes (direct change / slice /
  project) or four state-machine transitions (promote / demote / spike / defer). Use
  when picking up a Linear ticket, bug report, customer ask, or "I should do X" thought —
  at any fresh entry into Drive AND mid-flight when scope shifts. Returns a verdict + a
  one-paragraph rationale; the verdict's setup chain is executed by drive-start-workflow.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force.
>
> If the skill's body asks for work that requires reading source code, running builds/tests, or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Orchestrator role definition.

# Drive: Triage Work

Runs the triage decision tree on an incoming entry-point. Atomic skill — produces a verdict.

## The three delivery shapes (entry-point verdicts)

These are what work *becomes* once triaged:

| Verdict | What it means | Routes to |
|---|---|---|
| **Direct change** | One dispatch's worth; spec fits in working memory; ~30-second-verifiable diff. | `gh pr create` via `drive-pr-description` (direct-change framing). |
| **Slice** | One PR-sized unit (1–10 M-dispatches). Default: **orphan** (spec inline in PR description). If a parent project exists for this purpose: **in-project** (`projects/<project>/slices/<slice>/`). | `drive-specify-slice` → `drive-build-workflow`. |
| **Project** | Composition of 2–4 slices under one purpose. | `drive-create-project` → `drive-specify-project` → `drive-plan-project` → `drive-deliver-workflow`. |

**Orphan-first default for slice work.** Most slice-sized work should be orphan slices. A project is justified when the work composes 2+ slices, OR when a one-slice project is warranted because the design needs more than the PR description can carry — but the bar is "we're about to do design work that won't fit in the PR description," not "this work is important."

## The four state-machine transitions

These are state-changes you might make on a piece of work, whether or not it's been triaged yet:

| Transition | When | Routes to |
|---|---|---|
| **Promote** | An in-flight slice has grown beyond one PR. | Promotion ceremony (Linear MCP + `drive-create-project` + `drive-specify-project`). |
| **Demote** | An in-flight project has shrunk to one PR (or one slice). | Demotion ceremony (Linear MCP + on-disk migration + delete `projects/<project>/`). |
| **Spike** | The entry-point can't be sized without a probe. | `drive-build-workflow` with a spike-flavoured brief; re-triage on artefact. |
| **Defer** | Out-of-scope for now; don't lose. | Record in `projects/<x>/deferred.md` or operator scratch. |

**Promote** and **demote** only fire on in-flight work. **Spike** and **defer** can fire on either fresh entries or in-flight work.

## When to use

- A Linear ticket lands, a bug report or customer ask arrives, or the operator notices "I should do X" — fresh entry.
- An in-flight slice is growing beyond one PR (candidate for **promote**).
- An in-flight project's remaining scope is now one PR (candidate for **demote**).
- `drive-check-health` surfaces a scope-shift signal.

**Do not use this skill for:**

- Re-checking a verdict that hasn't had a scope-shift signal.
- Picking *which slice to work next* within a project (that's `drive-deliver-workflow`'s pick-next-slice logic).
- Sizing dispatches inside a slice plan (that's `drive-plan-slice`).

## Pre-conditions

- An entry-point input: ticket text / bug description / "I should do X" sentence / scope-shift signal.
- For mid-flight invocations: the in-flight unit (slice path, project path, Linear ID) identified.
- Optional: `drive/triage/README.md` exists with team-specific triage heuristics and calibration.

## Post-conditions

- Exactly one verdict emitted.
- A one-paragraph rationale (which decision-tree branches fired; what evidence supports the choice).
- For verdicts with operator-authorisation requirements (**promote**, **demote**, and **project** when the spec sketch suggests significantly more work than the ticket text implied): a "needs operator authorisation" flag set.

## Workflow

### Step 1 — Load project context

Read `drive/triage/README.md` if it exists.

### Step 2 — Check for discussion-mode signals

Before running the decision tree, check whether the entry-point fires any of these signals:

- **Design ambiguity in the ticket.** The ask is underspecified in a way that affects sizing or shape.
- **Surface uncertainty.** First-grep on the obvious entry-point returns more files than expected, OR the work touches an unfamiliar area of the codebase.
- **Parent-project assumption at risk.** For mid-flight scope-shifts, the project's purpose statement may no longer hold given what this work implies.

If any signal fires, route to `drive-discussion` first. The discussion may sharpen the entry-point enough that triage produces a different verdict than it would have on the raw ticket text. Otherwise, proceed to Step 3.

### Step 3 — Run the decision tree

In order — first branch that fires wins.

```text
Q0. Is this a mid-flight scope-shift signal (rather than a fresh entry)?
    │
    ├─ Growing past one PR → PROMOTE
    │
    ├─ Shrinking to one PR/slice → DEMOTE
    │
    └─ No (fresh entry) → continue to Q1

Q1. Is the entry-point so unclear that no sizing is possible?
    │
    ├─ Yes → SPIKE
    │
    └─ No → continue to Q2

Q2. Is the work out-of-scope for now?
    │
    ├─ Yes → DEFER
    │
    └─ No → continue to Q3

Q3. Is the diff ~30-second-verifiable and the spec fits in working memory?
    │
    ├─ Yes → DIRECT CHANGE
    │
    └─ No → continue to Q4

Q4. Does the work fit in one PR (≤ 10 M-dispatches)?
    │
    ├─ Yes → SLICE (default: orphan; in-project iff parent project exists
    │                 AND slice spec needs that context)
    │
    └─ No → continue to Q5

Q5. Does the work compose 2–4 slices?
    │
    ├─ Yes → PROJECT
    │
    └─ No (5+ slices) → re-decompose into two projects;
                        flag for operator authorisation
```

### Step 4 — Sanity check the verdict

Cross-check the candidate verdict against team-context calibration in `drive/triage/README.md` if present. The team's calibration may override default heuristics (e.g. "one-line message edits in user-visible surfaces are slices not direct changes due to localisation review").

### Step 5 — Emit the verdict + rationale

Output:

- The verdict (one of the three delivery shapes or four transitions).
- A one-paragraph rationale explaining which decision-tree branches fired and what evidence supports them.
- The "operator authorisation required" flag (true for **promote**, **demote**, and any **project** verdict where the spec sketch hints at significantly more work than the ticket implied; false otherwise).
- The recommended next skill / setup chain (for callers, especially `drive-start-workflow`).

## Sizing heuristics

Defaults; teams should override / extend in `drive/triage/README.md`.

**Q1 — Spike-shaped?**

- The ask references "investigate / figure out / find out whether…" without a clear deliverable.
- The agent or operator can't answer "what file or test would change?" within a couple of minutes of reading.
- Likely scope ranges across multiple orders of magnitude depending on what's discovered.

**Q3 — Direct-change-shaped?**

- Diff would be 1–3 files; the change pattern is obvious from reading any one chunk.
- Reviewer time: ~30 seconds to ~2 minutes.
- No new design decisions; no new tests; no migration of existing call sites.
- The spec for the change fits in working memory — if you'd need to write it down for the executor, it's a slice.

**Q4 — One PR?**

- PR-cap test: would the resulting PR be reviewable in one sitting (~30 min) and rollback-able as one unit?
- If the work spans more than ~3 logical layers (contract IR + emitter + fixtures + adapter), it's project-sized.
- If you'd need to stack 2+ PRs to deliver the value end-to-end, it's project-sized.
- Spikes are slice-sized by default (single-dispatch slice plan), not project-sized.

**Q4 sub-question — Orphan or in-project?**

- **Default: orphan.** Most slice-sized work is orphan; spec inline in the PR description.
- Choose in-project only when (a) a parent `projects/<project>/` already exists for this purpose AND (b) the slice's spec relies on context from the project spec to make sense.

**Q5 — Project sizing.**

- 2–4 slices is the project sweet spot.
- 5+ slices probably means two projects — the coordination overhead and branch-stacking cost of a long project chain dominate the value.
- 1 slice can be a project iff the slice warrants project-level spec capture (the design needs more than the PR description can carry; the operator wants discussion-mode + design-decisions log).

**Promote / demote.**

- **Promote:** the slice's PR diff would be too big to review in one sitting, OR the slice plan now lists 5+ dispatches with cross-area dependencies, OR new work has surfaced that's clearly inside the same purpose.
- **Demote:** of the project's remaining slices, only one is non-trivial; the rest are done or no longer needed; remaining work fits one PR.

## Pitfalls

1. **Defaulting to "project" because the work feels important.** Triage is about *size and shape*, not importance. A single-line copy fix to a critical user-visible string is still a direct change; a six-PR refactor of a non-critical internal helper is still a project (or two).
2. **Routing trivial-but-risky work as direct change.** "Trivial" is about diff size + verifiability, not blast radius. A one-line config change that flips behaviour for all users should be a slice so it goes through DoR + DoD + review.
3. **Defaulting slice work to in-project when it could be orphan.** Orphan-first; only choose in-project when a parent project actually exists and the slice spec needs the project's context. The instinct to "tidy this slice into a project" is project bias — resist.
4. **Defaulting work to project when it could be a slice.** The methodology rewards keeping work small. If you're uncertain between slice and project, draft the slice spec first; if it grows past one PR you can promote.
5. **Triage that consults calibration but ignores operator context.** The operator may know things calibration doesn't (e.g. "this user-visible string is being deprecated next week" → defer). Treat calibration as one input.
6. **Promote / demote without operator authorisation.** Linear side-effects are visible. Always set the authorisation flag.
7. **Spike that becomes implementation by stealth.** Spike DoD is "the artefact answers the planning question," not "code committed."
8. **Skipping Step 2 (discussion-mode signal check).** If a signal fires and the agent triages on the raw ticket text anyway, the verdict will reflect uninformed reading. The discussion-mode step exists precisely to sharpen the input before triage runs.

## Checklist

- [ ] Loaded `drive/triage/README.md` (if exists)
- [ ] Checked discussion-mode signals; routed to `drive-discussion` first if any fired
- [ ] Read the entry-point input
- [ ] Ran the decision tree; first-firing branch wins
- [ ] Sanity-checked against team-context calibration anchors
- [ ] Emitted verdict + one-paragraph rationale
- [ ] Set "operator authorisation required" flag where applicable
- [ ] Recommended next skill / setup chain for the caller

## Related skills

- `drive-start-workflow` — pilots triage + the verdict's setup chain
- `drive-build-workflow` — what the verdict routes to for slice-sized work
- `drive-deliver-workflow` — what the verdict routes to for project-sized work
- `drive-discussion` — fires when triage Step 2 detects a signal (design ambiguity, surface uncertainty, parent-project assumption at risk)
- `drive-pr-description` (direct-change framing) — what the verdict routes to for direct-change work

## References

- [`docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md) — the redesign that introduced the 3-shape + 4-transition split, the orphan-first default, and the 1–4-slices-per-project anchor
- [`drive/triage/README.md`](../../drive/triage/README.md) — team-specific triage protocol, calibration anchors, spike-first conventions
- [`drive/plan/README.md`](../../drive/plan/README.md) — sizing discipline this skill enforces
