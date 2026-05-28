---
name: drive-run-retro
description: >
  Run a retro on a triggering event (dispatch failure / drift event / scope-
  shift escapee / WIP-inspection finding / operator-flagged surprise) OR at
  mandatory project close per invariant I10. Produces lessons that land in a
  memory-strong surface (canonical skill body / drive/<category>/README.md /
  ADR) — without the landed output, the retro is not done. Atomic skill;
  trigger-based, NOT cadence-based.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Outputs land in `projects/<current-project>/retros.md`, in the
> conversation surface, and (per § Step 5 landing surfaces below) in
> `drive/<category>/README.md`, canonical skill bodies via `drive-update-skills`,
> or ADRs — those writes are part of the retro's definition of done and are
> explicitly permitted. If the body would require running builds/tests or
> writing files outside those permitted paths — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Run Retro

Retros are **trigger-based, not cadence-based** — daily/weekly retros on a slow-firing team become ritual without learning. The triggers are the signal. And the retro's output must **land** in a surface the next dispatch reads — without the landed output, the lesson stays in the operator's head and the next dispatch repeats the failure.

The retro-entry template (for `projects/<project>/retros.md`) lives at [`./templates/retro-entry.template.md`](./templates/retro-entry.template.md). Fill it; don't author from scratch.

## Triggers

**Trigger-based (most retros):**

- **Dispatch failure** — a dispatch failed in a way that wasn't pre-named in the slice spec (would have been caught by a known failure-mode pattern), OR failed unexpectedly (the protocol didn't see it coming).
- **Drift event** — WIP inspection caught the implementer drifting off-brief; OR a dispatch turned out to fail dispatch-INVEST in flight (outcome fuzzier than the brief named, or scope expanded beyond it); OR a slice's coherence broke down (one reviewer can no longer hold the PR).
- **Scope-shift escapee** — a scope shift happened that the protocol should have caught earlier (via DoR / triage / health-check) but didn't.
- **WIP-inspection finding** — a pattern surfaced repeatedly across WIP inspections that's worth crystallising into the protocol.
- **Operator-flagged surprise** — operator notices something unexpected (a new failure mode; reviewer-verdict mis-calibration; an agent doing something wrong without being told).

**Mandatory at project close.** Per invariant I10, every project's DoD includes a final retro. `drive-close-project` refuses to close without it.

## Workflow

### Step 1 — Load context

Read `drive/retro/README.md` if it exists. Look for team-specific prompts, recurring patterns the team watches for, landing-surface preferences, the team's discipline around generalising (canonical) vs localising (project-context).

### Step 2 — Confirm the trigger

State the triggering event clearly. *"Dispatch 3 in slice X failed because the reviewer flagged an out-of-scope file edit that DoR's intent-validation should have caught at delegation."* *"At project close — final retro per invariant I10."*

If the trigger is *"operator-flagged surprise"* without a concrete artefact, skip — collect more context first; vague triggers produce vague lessons.

### Step 3 — Reconstruct the event

Read the relevant artefacts:

- The triggering dispatch's brief + delegation transcript + diff + reviewer verdict + `code-review.md` round entries.
- The slice spec + plan that the dispatch came from.
- Any heartbeat / WIP-inspection notes that surfaced the drift.

For mandatory-final retros: read the project spec + plan + all slice retros (if any) + close-out checklist + `projects/<project>/design-decisions.md`.

### Step 4 — Root-cause the event

Walk through:

- **What actually happened?** (the observable event)
- **What was supposed to happen?** (per the protocol / spec / plan / brief)
- **Where did the protocol fail?** (which gate didn't fire; which pattern wasn't in the catalogue; which assumption was wrong)
- **What information would have caught it earlier?** (a different DoR item; a failure-mode pattern in `drive/plan/README.md`; an edge case in the slice spec; a sizing reference in `drive/calibration/sizing.md`)

**Walk to root cause, not to first-plausible-cause.** The first explanation is usually proximate (*"the implementer touched the wrong file"*); the root is upstream (*"the brief didn't list the out-of-scope files explicitly, so the implementer didn't know which adjacent files to avoid"*).

### Step 5 — Pick the landing surface(s)

| Surface | When |
|---|---|
| **Canonical skill body** (e.g. `drive-build-workflow/SKILL.md`) | The lesson generalises across teams / repos. Tighten an existing rule; add a missing rule; clarify wording that misled. |
| **Project-context README** (e.g. `drive/plan/README.md`, `drive/triage/README.md`) | The lesson is team-specific. Add a failure-mode entry; tighten the team's DoR overlay; add a sizing reference case. |
| **ADR** (`docs/architecture docs/adrs/...`) | The lesson is a durable architectural decision the team / org commits to. |

A retro can land in multiple surfaces (tighten the canonical body AND add a team-specific overlay).

**If the lesson can't land in any surface, ask: is this actually a lesson?** Unlandable lessons either (a) need more incidents to crystallise — defer until pattern emerges; (b) belong somewhere we don't have a surface for — propose creating one; or (c) aren't really lessons — operator preference dressed up as protocol.

### Step 6 — Write the update(s)

- **Canonical body update**: edit the relevant skill body via `drive-update-skills` so the change is visible to other repos that pull from canonical.
- **Project-context update**: edit `drive/<category>/README.md` directly. Include a date + a one-line trigger reference so future readers know why the entry exists.
- **ADR**: use `drive-create-adr` (or comparable) to draft.

### Step 7 — Record the retro entry

Append to `projects/<project>/retros.md` (create if missing) using [`./templates/retro-entry.template.md`](./templates/retro-entry.template.md).

### Step 8 — Mandatory-final-retro specifics

When invoked as the mandatory final retro at project close:

- The retro covers the project as a whole: protocol failures and successes; learnings about the team's calibration; surprises that warrant catalogue entries.
- Landing surfaces include at minimum **one** of (a) project-context README update, (b) canonical update, (c) ADR. If the operator claims *"no lessons to land,"* push back once explicitly: *"the retro is mandatory by invariant I10; landing-zero-lessons would be a first — confirm there's genuinely nothing?"*
- Recorded in `projects/<project>/retros.md` AND referenced in the project-DoD checklist (the PDoD item naming the retro is marked done with a link to the retro entry).
- `drive-close-project` checks this before allowing close.

## Pitfalls

1. **Retro without a landed output.** *"We talked about it"* is not a retro — it's a conversation. Without the landing, the lesson stays in the operator's head and the next dispatch repeats the failure.
2. **Retro at the wrong level.** A dispatch-failure retro that lands as an ADR is over-cooking; an architectural-shift retro that lands as a one-line README entry is under-cooking. Pick the landing surface that matches the lesson's scope.
3. **Root-causing to "the implementer made a mistake."** That's proximate, not root. The root is upstream: which gate / pattern / brief item would have caught it. Stay upstream.
4. **Cadence-based retros.** *"Friday retros"* become ritual without learning when nothing triggered them that week. The principle is trigger-based; deviations should be a deliberate operator choice with documented rationale.
5. **Mandatory-final retro skipped.** Invariant I10. `drive-close-project` enforces; bypassing the gate breaks the protocol-as-memory loop and the next project doesn't inherit the lessons.
6. **Lessons that generalise landed only in project-context.** If the lesson would help other teams / repos, land it canonical (via `drive-update-skills`) so it propagates. Project-context-only burial loses cross-repo leverage.

## References

- [`./templates/retro-entry.template.md`](./templates/retro-entry.template.md) — the fillable retro-entry template.
- [`drive/retro/README.md`](../../drive/retro/README.md) — team retro conventions and landing-surface preferences.
- [`docs/drive/principles/protocol-as-memory.md`](../../docs/drive/principles/protocol-as-memory.md) — why landed retros matter.
- [`docs/drive/model.md`](../../docs/drive/model.md) § Layer 5 — invariant I10 (mandatory final retro at project close).
- `skills-contrib/drive-update-skills/`, `drive-close-project/`, `drive-build-workflow/`, `drive-deliver-workflow/` — the skills that fire / consume / enforce this skill.
