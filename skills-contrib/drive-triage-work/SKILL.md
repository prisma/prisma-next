---
name: drive-triage-work
description: >
  Routes an incoming entry-point to one of three delivery shapes (direct change /
  slice / project) or four state-machine transitions (promote / demote / spike /
  defer). Use at every fresh entry into Drive — Linear ticket, bug report, customer
  ask, "I should do X" thought — and mid-flight when scope shifts. Returns a verdict
  + one-paragraph rationale + operator-authorisation flag. The verdict's setup chain
  is executed by the caller (typically `drive-start-workflow`).
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Running it does NOT change the Orchestrator's role. If the skill's body
> would require reading source code, running builds/tests, or writing files outside
> `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Triage Work

Triage routes work into the smallest shape it fits in. The bias is **down**: direct change before slice; slice before project; orphan slice before in-project slice. The methodology rewards keeping work small; resist the instinct to "tidy this into a project."

## The seven verdicts

Three **delivery shapes** (what work *becomes* once triaged):

| Verdict | Meaning |
|---|---|
| **Direct change** | One dispatch's worth; ~30-second-verifiable diff; spec fits in working memory. |
| **Slice** | One PR-sized unit. Test = slice-INVEST, in particular *Small* = manageable in a single code review. Default **orphan** (spec inline in PR body); in-project iff a parent project exists AND the slice spec needs that context. |
| **Project** | 2–4 slices under one purpose. 1-slice project is rare-but-OK when the design needs more than the PR description can carry. |

Four **state-machine transitions** (state-changes on a piece of work, fresh or in-flight):

| Verdict | Meaning |
|---|---|
| **Promote** | In-flight slice no longer passes slice-INVEST — split into a project. |
| **Demote** | In-flight project's remaining work fits one PR — collapse to a slice or direct change. |
| **Spike** | Entry-point can't be sized without a probe. Single-dispatch slice with spike-flavoured brief; re-triage on the artifact. |
| **Defer** | Out-of-scope for now; record so it isn't lost. |

## Workflow

### Step 1 — Discussion-mode signal check

Before running the tree, check whether any of these fire on the entry-point:

- **Design ambiguity.** The ask is underspecified in a way that affects sizing or shape.
- **Surface uncertainty.** First-grep on the obvious entry-point returns more files than expected, OR the work touches an unfamiliar area.
- **Parent-project assumption at risk.** For mid-flight scope-shifts, the parent project's purpose may no longer hold given what this work implies.

If any fires, route to `drive-discussion` first. Triage on the post-discussion summary, not the raw entry-point.

### Step 2 — Run the decision tree

First branch that fires wins.

```text
Q0. Is this a mid-flight scope-shift signal (not a fresh entry)?
    ├─ Growing past one PR              → PROMOTE
    ├─ Shrinking to one PR/slice         → DEMOTE
    └─ Fresh entry                       → Q1

Q1. So unclear that no sizing is possible? → SPIKE.   else Q2.
Q2. Out-of-scope for now?                  → DEFER.   else Q3.
Q3. ~30-second-verifiable diff
    AND spec fits in working memory?       → DIRECT CHANGE.   else Q4.
Q4. Passes slice-INVEST — in particular,
    manageable in a single code review?    → SLICE.   else Q5.
Q5. Composes 2–4 slices?                   → PROJECT.
                                             5+ slices → re-decompose into two
                                             projects; flag for operator authorisation.
```

Sizing tests at each Q live in [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) and the per-altitude INVEST rubric for this codebase in [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md).

### Step 3 — Sanity-check against team calibration

Read `drive/triage/README.md` if it exists. Team-specific overrides may apply (e.g. *"one-line user-visible string edits go through slice DoR/DoD due to localisation review"*).

### Step 4 — Emit verdict

Return three things to the caller:

- **Verdict** — one of the seven verbs above.
- **Rationale** — one paragraph: which branches fired, what evidence supports the choice.
- **Operator authorisation required** — `true` for PROMOTE, DEMOTE, and any PROJECT verdict where the scope hints at more work than the entry-point implied; `false` otherwise.

The rationale is consumed in the conversation or by the verdict's downstream skill (which folds it into the spec / plan / PR body). Triage produces no on-disk artifact.

> **Emit `triage-verdict`** (once per triage call — every invocation fires exactly one event; re-triages on the same Linear ticket emit again with the same `input_ref`). Map the skill's seven verdicts to the vocab enum: `Direct change` → `"direct-change"`; `Slice` → `"orphan-slice"` when no parent project exists, else `"in-project-slice"`; `Project` on a fresh entry → `"new-project"` (distinct from mid-flight `Promote` → `"promote"`); `Demote` → `"demote"`; `Spike` → `"spike-first"`; `Defer` → `"defer"`. Payload: `verdict`, `input_shape` (`"linear-ticket"` / `"chat-ask"` / `"customer-ask"` / `"bug-report"` / `"mid-flight-scope-signal"` for re-triage / `"i-should-do-x-thought"`), `input_ref` (Linear ticket ID when available, else `null`), plus envelope fields. See the `drive-record-traces` skill — `events.md` § `triage-verdict` for the payload schema and `emission.md` § Append protocol for file-append mechanics.

## Pitfalls

1. **Defaulting to project because the work feels important.** Triage is about size and shape, not importance.
2. **Defaulting slice work to in-project when it could be orphan.** Orphan-first. In-project only when a parent project actually exists AND the slice spec needs that context.
3. **Routing trivial-but-risky work as direct change.** "Trivial" is about diff verifiability, not blast radius. A one-line config flip that changes behaviour for all users is a slice so it goes through DoR + DoD + review.
4. **Promote/demote without operator authorisation.** Linear side-effects are visible. Always set the flag.
5. **Spike that becomes implementation by stealth.** Spike DoD is "the artifact answers the planning question," not "code committed."
6. **Skipping Step 1.** If a discussion-mode signal fires and the agent triages on the raw entry-point anyway, the verdict reflects uninformed reading.

## References

- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — the sizing principle (logical coherence; INVEST at three altitudes).
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — this codebase's per-altitude INVEST rubric.
- [`drive/triage/README.md`](../../drive/triage/README.md) — team-specific triage overrides and calibration.
