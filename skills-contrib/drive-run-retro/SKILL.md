---
name: drive-run-retro
description: >
  Run a retro on a triggering event (dispatch failure / drift event / scope-shift escapee
  / WIP-inspection finding / operator-flagged surprise) OR at mandatory project close.
  Produces lessons that land in a memory-strong surface (canonical skill update /
  drive/<category>/README.md update / ADR) — without the landed output, the retro is not
  done. Atomic skill; trigger-based (NOT cadence-based). Called by drive-build-workflow,
  drive-deliver-workflow, or invoked directly by the operator.
metadata:
  version: "2026.5.18"
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force. Outputs land in `projects/<current-project>/` (spec / plan / design notes), in Linear (via MCP), or in the conversation surface (verdicts, briefs, summaries).
>
> **Exception for retro landing surfaces:** this skill's core outputs include writes to `drive/<category>/README.md` (project-context update) and canonical skill bodies (via `drive-update-skills`). These writes are part of the retro's definition of done and are explicitly permitted. If the skill's body asks for work that requires running builds/tests or writing files outside these permitted paths — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Orchestrator role definition.

# Drive: Run Retro

Run a retro on a triggering event or at mandatory project close. Produces lessons that land in a memory-strong surface.

Per `drive/retro/README.md` team overlays and the retro principle this skill embodies: retros are **trigger-based**, not cadence-based — daily/weekly retros on a slow-firing team becomes ritual without learning. The triggers are the signal. And the retro's output must **land** in a surface the next dispatch reads (canonical skill body / project-context README / ADR) — without the landed output, the lesson stays in the operator's head and the next dispatch repeats the failure.

## When to use

**Trigger-based (most retros):**

- **Dispatch failure.** A dispatch failed in a way that wasn't pre-named in the slice spec (would have been caught by a known failure-mode pattern), OR failed unexpectedly (the protocol didn't see it coming).
- **Drift event.** WIP inspection caught the implementer drifting off-brief; OR a dispatch crossed the M-cap unexpectedly; OR a slice's PR diff grew past the PR-cap.
- **Scope-shift escapee.** A scope shift happened that the protocol should have caught earlier (via DoR / triage / health-check) but didn't.
- **WIP-inspection finding.** A pattern surfaced repeatedly across WIP inspections that's worth crystallising into the protocol.
- **Operator-flagged surprise.** Operator notices something unexpected (a failure-mode they hadn't seen before; a reviewer-verdict mis-calibration; an agent doing something wrong without being told).

**Mandatory at project close:**

- Per invariant I10, every project's DoD includes a final retro. `drive-close-project` refuses to close the project without it.

**Do not use this skill for:**

- Routine "let's reflect" sessions without a trigger — those rarely produce landing-worthy lessons; the team's project-context surfaces stop maturing.
- Code review on a dispatch — that's the reviewer subagent in `drive-build-workflow`.
- Health check (rollup of project state) — that's `drive-check-health`.

## Pre-conditions

- A triggering event has occurred (or the project is at close).
- The triggering event has enough context to discuss: artefacts (the failed dispatch's diff, the drift-event WIP-inspection log, the scope-shift escapee's history) are available.
- Optional: `drive/retro/README.md` exists with team-specific retro conventions (extra prompts, landing-surface preferences, common patterns).

## Post-conditions

- Retro output landed in at least one memory-strong surface:
  - A canonical skill body updated (when the lesson generalises across teams).
  - A project-context `drive/<category>/README.md` updated (when the lesson is team-specific).
  - An ADR written (when the lesson is a durable architectural decision).
- The retro entry recorded in `projects/<project>/retros.md` (or comparable) with: trigger, what happened, root cause, landing surface(s) updated.
- For mandatory-final retros: project-DoD's retro condition (per invariant I10) is satisfied.

## Project context

Load `drive/retro/README.md` at workflow step 1 if it exists. Look for: team-specific prompts, recurring patterns the team watches for, landing-surface conventions, the team's discipline around generalising lessons (canonical) vs localising them (project-context).

## Workflow

### Step 1 — Load project context

Read `drive/retro/README.md` if it exists.

### Step 2 — Confirm the trigger

State the triggering event clearly. Examples:

- *"Dispatch 3 in slice X failed because the reviewer flagged an out-of-scope file edit that DoR's intent-validation should have caught at delegation."*
- *"At project close — final retro per invariant I10."*

If the trigger is "operator-flagged surprise" without a concrete artefact: skip — collect more context before running the retro, since vague triggers produce vague lessons.

### Step 3 — Reconstruct the event

Read the relevant artefacts:

- The triggering dispatch's brief + delegate-implement transcript + diff + reviewer verdict + code-review.md round entries.
- The slice spec + plan that the dispatch came from.
- Any heartbeat / WIP-inspection notes that surfaced the drift.

For mandatory-final retros: read the project spec + plan + all slice retros (if any) + close-out checklist + the project's design-decisions.md.

### Step 4 — Root-cause the event

Walk through:

- **What actually happened?** (the observable event)
- **What was supposed to happen?** (per the protocol / spec / plan / brief)
- **Where did the protocol fail?** (which gate didn't fire; which pattern wasn't in the catalogue; which assumption was wrong)
- **What information would have caught it earlier?** (a different DoR item; a failure-mode pattern in `drive/plan/README.md`; an example-mapping edge case in the slice spec; a sizing reference case in `drive/plan/README.md`)

Walk to root cause, not to first-plausible-cause. The first explanation is often the proximate ("the implementer touched the wrong file"); the root is usually upstream ("the brief didn't list the out-of-scope files explicitly, so the implementer didn't know which adjacent files to avoid").

### Step 5 — Pick the landing surface

Three default options:

- **Canonical skill body** (e.g. `drive-build-workflow/SKILL.md`): when the lesson generalises across teams / repos. Tighten an existing rule; add a missing rule; clarify wording that misled.
- **Project-context README** (e.g. `drive/plan/README.md`, `drive/triage/README.md`, `drive/spec/README.md`): when the lesson is team-specific. Add a failure-mode entry to the catalogue; tighten the team's DoR overlay; add a sizing reference case; add a ticket-shape pattern.
- **ADR** (`docs/architecture docs/adrs/...`): when the lesson is a durable architectural decision the team / org commits to.

A retro can land in multiple surfaces (e.g. tighten the canonical body AND add a team-specific overlay).

If the lesson can't land in any surface, ask: *is this actually a lesson?* Unlandable lessons either (a) need more incidents to crystallise — defer until pattern emerges, (b) belong somewhere we don't have a surface for — propose creating one, or (c) aren't really lessons — operator preference dressed up as protocol.

### Step 6 — Write the update(s)

For each landing surface chosen:

- **Canonical body update**: edit the relevant skill body via `drive-update-skills` ([PR #93](https://github.com/prisma/ignite/pull/93)) so the change is visible to other repos that pull from canonical.
- **Project-context update**: edit `drive/<category>/README.md` directly. Include a date + a one-line trigger reference so future readers know why the entry exists.
- **ADR**: use `drive-create-adr` (or comparable) to draft.

### Step 7 — Record the retro entry

Append to `projects/<project>/retros.md` (create if missing):

```markdown
## YYYY-MM-DD — <one-line summary>

**Trigger:** _<event that triggered the retro>_

**What happened:** _<1-2 sentences>_

**Root cause:** _<the upstream failure point>_

**Landing surface(s):**
- _Canonical: `drive-<skill>/SKILL.md` § <section> — <change summary>._
- _Project-context: `drive/<category>/README.md` § <section> — <change summary>._
- _ADR: `docs/architecture docs/adrs/ADR <N> — <title>`._
```

### Step 8 — Mandatory-final-retro specifics

When invoked as the mandatory final retro at project close:

- The retro covers the project as a whole: protocol failures and successes, learnings about the team's calibration, surprises that warrant catalogue entries.
- The landing surfaces include at minimum **one** of (a) project-context README update, (b) canonical update, (c) ADR. If the operator claims "no lessons to land," push back once explicitly: *"the retro is mandatory by invariant I10; landing-zero-lessons would be a first — confirm there's genuinely nothing?"*
- The retro is recorded in `projects/<project>/retros.md` AND referenced in the project-DoD checklist (the PDoD item naming the retro is marked done with a link to the retro entry).
- `drive-close-project` checks this before allowing project close.

## Pitfalls

1. **Retro without a landed output.** "We talked about it" is not a retro — it's a conversation. Without the landing, the lesson stays in the operator's head; the next dispatch repeats the failure. The retro is not done until the output lands in a memory-strong surface.
2. **Retro at the wrong level.** A dispatch-failure retro that lands as an ADR is over-cooking; an architectural-shift retro that lands as a one-line README entry is under-cooking. Pick the landing surface that matches the lesson's scope.
3. **Root-causing to "the implementer made a mistake."** That's proximate, not root. The root is upstream: which gate / pattern / brief item would have caught it. Stay upstream.
4. **Cadence-based retros.** "Friday retros" become ritual without learning when nothing triggered them that week. The principle is trigger-based; deviations should be a deliberate operator choice with documented rationale.
5. **Mandatory-final retro skipped.** Invariant I10. `drive-close-project` enforces; bypassing the gate breaks the protocol-as-memory loop and the next project doesn't inherit the lessons.
6. **Lessons that generalise landed only in project-context.** If the lesson would help other teams / repos, land it canonical (via `drive-update-skills`) so it propagates. Project-context-only burial loses cross-repo leverage.

## Checklist

- [ ] Loaded `drive/retro/README.md` (if exists)
- [ ] Triggering event stated clearly (concrete artefact attached)
- [ ] Event reconstructed from artefacts
- [ ] Root cause identified (upstream, not proximate)
- [ ] Landing surface(s) chosen (canonical / project-context / ADR — possibly multiple)
- [ ] Surface(s) updated (via `drive-update-skills` for canonical; direct edit for project-context; `drive-create-adr` for ADR)
- [ ] Retro entry recorded in `projects/<project>/retros.md`
- [ ] (Mandatory-final only) PDoD retro condition marked done with link

## Related skills

- `drive-build-workflow` — fires retro triggers from dispatch-failure / WIP-drift / stop-condition surfaces
- `drive-deliver-workflow` — fires the mandatory-final-retro at project close + retros on between-slice triggers
- `drive-close-project` — refuses to close without the mandatory final retro
- `drive-update-skills` ([PR #93](https://github.com/prisma/ignite/pull/93)) — lands lessons in canonical skill bodies
- `drive-bootstrap-context` ([PR #93](https://github.com/prisma/ignite/pull/93)) — seeds `drive/retro/README.md` if missing
- `drive-check-health` — different scope: rollup of project state rather than per-event retrospective

## References

- [`drive/retro/README.md`](../../drive/retro/README.md) — team retro conventions and landing-surface preferences
- [`drive/README.md`](../../drive/README.md) — protocol-as-memory (canonical skill bodies vs project-context READMEs)
