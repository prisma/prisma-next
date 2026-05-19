---
name: drive-close-project
description: >
  Close out a project: verify project DoD (incl. mandatory final retro per invariant I10),
  classify files under projects/<project>/ as long-lived methodology vs transient project
  artefacts, migrate long-lived into docs/, strip repo-wide references to
  projects/<project>/**, delete projects/<project>/, and open the close-out PR. Refuses
  to delete if DoD unmet or operator hasn't confirmed the classification. Atomic skill;
  invoked by drive-deliver-workflow once all slices are merged, or directly by the
  operator at end-of-project. Replaces the close-out section that used to live in the
  drive-project-workflow Cursor rule.
metadata:
  version: "2026.5.19.1"
---

# Drive: Close Project

Close out a project — verify its DoD is met, preserve the long-lived knowledge it produced, strip the transient scaffolding, and ship the close-out PR.

The core insight: every project produces two kinds of artefact. **Long-lived methodology** (principles, models, conventions, ADRs, reference docs) belongs in `docs/` — other work consults it forever. **Transient project artefacts** (spec, plan, problem statement, design-decisions, retros) belong in `projects/<project>/` while the project is active and belong nowhere once it closes — they exist to coordinate the project, not to be future reference material. This skill makes that classification explicit, migrates the long-lived side, and deletes the rest in one auditable pass.

## When to use

- A project's slices have all merged (or been explicitly deferred), the project DoD has been verified, and the mandatory final retro is complete (per invariant I10).
- Invoked automatically by `drive-deliver-workflow` as its terminal step.
- Invoked directly by the operator when finishing a project that was shaped/built outside the deliver-workflow path.
- Invoked to close out a paused or abandoned project — same workflow, but the DoD check and retro both surface "abandoned" / "deferred" entries instead of completion.

**Do not use this skill for:**

- A project that still has open slices — that's `drive-deliver-workflow`'s job; come back when delivery completes.
- A project whose spec was never agreed — close out is for projects that ran their course. If the spec was never agreed, the project failed at shaping and a retro on *that* is more useful than a close-out.
- Deleting `projects/<project>/` without the classification / migration pass — this skill refuses to delete until the classification has been confirmed by the operator and the migration written.

## Pre-conditions

- `projects/<project>/` exists with `spec.md` (and typically `plan.md`).
- Every slice in `plan.md` is in one of: merged, explicitly deferred (recorded under `projects/<project>/deferred.md` or equivalent), or cancelled.
- The mandatory final retro is complete (per principles/definition-of-done.md § Project DoD, invariant I10). If absent, this skill refuses to proceed and points at `drive-run-retro`.
- The operator is available to confirm the classification before any file deletion happens.

## Post-conditions

- Project DoD verified end-to-end against the spec's acceptance criteria; the verification result is written into the close-out PR description.
- Long-lived methodology files migrated into the destination configured in `drive/project/README.md` (default: `docs/<project>/` or `docs/` subtree as the team's conventions specify).
- Repo-wide references to `projects/<project>/**` either re-pointed at the canonical `docs/` location or removed.
- `projects/<project>/` deleted.
- Close-out PR opened, titled and described per `drive/pr/README.md` conventions, referencing the Linear Project so the GitHub integration auto-transitions issues on merge.

## Project context

Load `drive/project/README.md` at workflow step 1. Look for:

- **Migration destination root** for long-lived docs (default: `docs/<project>/`; some teams prefer category-specific roots like `docs/architecture docs/`).
- **Classification overlays** — files the team always treats as long-lived (e.g., `principles/`, `model.md`) or always treats as transient (e.g., `calibration/`).
- **Close-out PR title / description conventions** — usually delegated to `drive-pr-description` with `direct-change` mode.
- **Linear conventions** — which Linear Project hosts close-out issues; whether the close-out gets its own ticket or is folded into the project's parent ticket.

Also load `drive/pr/README.md` (this skill opens a PR at the end).

## Workflow

### Step 1 — Load project context

Read `drive/project/README.md` (required — hard-error if missing and offer to invoke `drive-bootstrap-context` for the `project` category). Read `drive/pr/README.md` (recommended; used at step 9).

### Step 2 — Verify project DoD

Walk `projects/<project>/spec.md` § Acceptance Criteria. For each AC item:

- **Met:** evidence (PR link, merged commit, test reference, doc location).
- **Deferred:** explicit deferral with a follow-up Linear ticket reference.
- **Unmet:** halt. Surface to the operator. Do **not** proceed.

Also walk the canonical Project DoD (per `principles/definition-of-done.md`):

- All slices merged or explicitly deferred.
- Mandatory final retro complete (invariant I10) — verify a retro entry exists in the project's retro log dated within the close-out window. If absent: halt and point at `drive-run-retro` with the "mandatory at project close" trigger.
- Long-lived docs ready to land (this is what step 4 onward enacts; verify the candidate list exists before proceeding).
- No open ADRs blocking close.

Write the DoD verification into a draft block — it will become a section of the close-out PR description in step 9.

### Step 3 — External-reference scan

Before classifying files, scan the repo for anything *outside* `projects/<project>/` that references `projects/<project>/**`. Use a tight ripgrep, e.g.:

```bash
rg -l "projects/<project>/" --glob '!projects/<project>/**' --glob '!.git/**' --glob '!wip/**'
```

Record the matches; they become the "strip references" worklist in step 7. If the list is empty, step 7 is a no-op — note that explicitly so the operator can sanity-check the scan wasn't malformed.

### Step 4 — Classify files

Walk every tracked file under `projects/<project>/` and classify each as one of:

- **Long-lived methodology** — file describes enduring conventions, principles, models, vocabularies, ADRs, or reference material that other work will continue to consult. Migrates to the destination root.
- **Transient project artefact** — file existed to coordinate the project (spec, plan, problem-statement, design-decisions, retros, READMEs that orient newcomers to the project itself). Deletes with `projects/<project>/`.
- **Ambiguous** — surface to operator; do not classify silently.

Default classification rules (override via `drive/project/README.md`):

| File / pattern | Default | Notes |
| --- | --- | --- |
| `principles/**.md` | long-lived **(prose-audit at step 4.5)** | Usually migrates, but the prose audit catches worked examples that anchor to project-specific incidents / paths / overlays. |
| `model.md`, `domain-model.md`, `vocabulary.md`, `glossary.md` | long-lived **(prose-audit at step 4.5)** | Ubiquitous-language artefacts. Prose audit catches "what we did / before-after / new-vs-existing" framing. |
| `workflow.md`, `process.md` | long-lived **(prose-audit at step 4.5)** | Process / methodology. Same prose-audit concern. |
| `*-conventions.md` | long-lived **(prose-audit at step 4.5)** | Convention reference. Prose audit catches restructure / migration framing. |
| `*-restructure.md`, `*-restructure-plan.md`, `migration-plan.md`, `*-changes.md` | transient | Execution plans describing project deltas. What survives is the resulting state (which lives in other long-lived docs); the plan itself is project archeology. |
| `adrs/**.md`, `decisions/**.md` | long-lived | ADRs migrate into the repo's ADR root. |
| `calibration/**` | transient | Project-specific calibration; surfaces of value get **lifted into project-context READMEs** (`drive/<category>/README.md`), not migrated as docs. Same lift-then-delete pattern applies to any per-project worked-example overlays. |
| `problem-statement.md`, `pitch.md`, `proposal.md`, `motivation.md` | transient | Project-shaping / advocacy artefacts. Their content might feed the PR description but they don't survive close — the project is its own justification once it ships. |
| `trial.md`, `validation.md`, `rollout.md` | transient | Time-windowed project-execution artefacts tied to specific dates / tickets. If the *concept* is reusable (e.g. "always run a trial period when adopting"), it lifts into project context or a principle; the instance does not. |
| `spec.md`, `specs/**` | transient | Shaping artefact. |
| `plan.md`, `plans/**` | transient | Coordination artefact. |
| `design-decisions.md` | transient (with care) | Decisions worth preserving should already have migrated to ADRs during the project; the bare log is transient. If decisions haven't been ADR'd, surface to operator. |
| `retros.md` | transient | The *lessons* should already have landed (in skills / READMEs / ADRs per the retro principle). The log itself is project archeology. |
| `README.md` | transient | Project orientation; the `docs/` index supersedes it for migrated material. |
| `assets/**` | depends | Usually transient; reference material the operator wants kept gets migrated explicitly. |
| `reference/**` | n/a | Typically gitignored; ignore. |

For each file produce a classification record:

```
<path>  →  long-lived | transient | ambiguous
  destination (if long-lived): docs/<project>/<sub-path>
  rationale (one line)
```

### Step 4.5 — Prose-audit long-lived candidates

The default classification at step 4 keys off filenames. That's necessary but not sufficient: a file *named* like long-lived methodology can still *read* as a project-execution artefact, because it was written while the project was in flight and absorbed project-shaping voice. Without this audit, project framing migrates into `docs/` and becomes incoherent the moment the project closes (a fresh reader has no baseline for "before-the-restructure / what's new / what changes").

For every file classified `long-lived` at step 4, read the file and apply the four smell tests below. Each match yields a **per-file disposition**.

**Smell test 1 — Project-shaping voice in headings and prose.** Phrases the audit catches:

- "What we did / what we're proposing / what kept going wrong / what changes / what's new / what we'd like from you"
- "Before the restructure / after the restructure / new vs existing / migration plan / build sequencing / upstream promotion"
- Tables with a "Status" column whose values describe project deltas (`new`, `renamed`, `augmented`, `split from X`, `replaces Y`)
- Legends like "Bold = new (this project adds it); plain = exists today; italic = augmented"

**Smell test 2 — Status blocks tied to the project lifecycle.**

- "Status: stable for the trial"
- "Updates here are load-bearing for every other doc in this project"
- "Living document. We'll iterate as the project ships."
- Trial-window dates, "we're trialling for two weeks", "we'll re-converge when we promote upstream"

**Smell test 3 — Worked-example pollution.** Sections like *"Worked example for `<repo-name>`:"* that enumerate the same overlays already lifted into project-context READMEs (`drive/<category>/README.md`). Same anti-pattern as `calibration/**`: project-context masquerading as methodology illustration.

**Smell test 4 — Worked examples anchored to specific real-world incidents.** Specific dates (`Date: 2026-05-17`), specific project names (`projects/storage-shape-flatten/...`), specific ticket IDs (`TML-2549`), specific PR numbers. A worked example is fine; *anchoring* it to a single repo's history is not (another team has no context).

**Per-file disposition** (record on the classification record from step 4):

| Match | Disposition |
| --- | --- |
| Smell test 1 dominates (entire file is project narrative) | **Reclassify as transient.** File's content is project-shaping; methodology survives in other docs. |
| Smell test 1 / 2 in framing only (methodology core is sound) | **Rewrite-at-migration.** Migrate the file but strip the project framing — replace "new / existing / before-after" with steady-state description; remove project-status blocks; drop "Updates here are load-bearing for this project" footers. |
| Smell test 3 (worked example duplicates project-context) | **Lift-example-to-context, keep methodology.** Move the "Worked example for `<repo>`:" content into the matching `drive/<category>/README.md` (per the `calibration/**` rule); replace in the migrated file with a one-line pointer ("see your team's `drive/<category>/README.md`"). |
| Smell test 4 (specific real-world anchors in a worked example) | **Soften-at-migration.** Migrate but generalise — replace specific dates / project names / ticket IDs with placeholders (`<date>`, `<your-project>`, `<ticket-id>`) or anonymised stand-ins. Keep the example shape; lose the archeology. |

**Non-portable conventions** also surface here: references to repo-specific paths (e.g. `wip/`, `examples/`, `packages/3-extensions/`) embedded in methodology prose should be replaced with the universal concept they stand in for ("operator scratchpad", "example apps", "extension worked-examples"). Repo-specific paths belong in project context.

The audit surfaces a per-file disposition; the operator confirms at step 5 (the disposition is part of what they sign off on).

### Step 5 — Confirm the classification with the operator

Present the classification list **with the step-4.5 dispositions attached**. **The operator must confirm before step 6 begins.** This is a hard gate because the cost of mis-classifying long-lived as transient is irrecoverable file loss; the cost of mis-classifying transient as long-lived is project-shaping cruft accumulating in `docs/` (a softer but compounding failure that the prose audit exists to catch).

Allow the operator to:

- Re-classify any individual file.
- Override the destination path for any long-lived file.
- Add files to the migration that the rules tagged transient (and vice versa).
- Override the step-4.5 disposition (e.g. accept project-framing voice for a particular file, or escalate "rewrite-at-migration" to "reclassify-as-transient").
- Update `drive/project/README.md` with new rules if the override would apply to future projects.

When the operator confirms, lock the classification list and proceed.

### Step 6 — Migrate long-lived files (applying step-4.5 dispositions)

For each `long-lived` record, apply its step-4.5 disposition:

- **No audit match.** `git mv` the file to its destination (preserve history).
- **Rewrite-at-migration.** Read the file, rewrite to strip the project-shaping framing identified by smell tests 1 / 2, then write the rewritten content at the destination path. Stage the source for deletion (`git rm` the original after the rewritten file is in place; the resulting commit records the move + rewrite as one change).
- **Lift-example-to-context.** Move the "Worked example for `<repo>`:" content into the matching `drive/<category>/README.md` (per the `calibration/**` rule). Replace the section in the migrated file with a one-line pointer ("see your team's `drive/<category>/README.md`"). Surface to operator if the destination READMEs already contain the content (likely — that's the duplication this audit catches).
- **Soften-at-migration.** Read the file, replace specific dates / project names / ticket IDs with placeholders, then write at destination. Same shape as rewrite-at-migration but narrower.
- **Reclassify-as-transient.** No migration; the file moves to the transient pile and deletes at step 8 with the rest of `projects/<project>/`.

If the destination directory doesn't exist, create it. If a destination file already exists, surface the collision to the operator — do not silently overwrite.

Maintain the relative subtree structure within the destination root when it makes sense (e.g., `principles/foo.md` → `docs/<project>/principles/foo.md`). When migrating into a flat root (e.g., `docs/architecture docs/adrs/`), follow that root's existing file-naming conventions.

After all moves, write or update `docs/<project>/README.md` (or the team's chosen index) as an entry-point for the migrated material. Include:

- One-paragraph summary of the project's outcome.
- Index linking each migrated file with a one-line description.
- Link to the project's spec & plan **as historical reference** — point at the close-out PR or its merge commit, not at `projects/<project>/**` (which is about to be deleted).

### Step 7 — Strip repo-wide references

For each match in the step-3 worklist:

- If the reference can be re-pointed at the migrated destination, update it. Examples:
  - A `docs/onboarding/X.md` link to `projects/<project>/principles/Y.md` → re-point to `docs/<project>/principles/Y.md`.
  - A skill file's reference to `projects/<project>/spec.md` → either re-point at the close-out PR or delete (the spec is transient).
- If the reference doesn't have a sensible migration target, delete it.
- If the reference is in a doc the operator owns (e.g., an ADR), surface for confirmation before editing.

After step 7, re-run the step-3 ripgrep. The result must be empty (or contain only references in the close-out PR's own description, which is fine).

### Step 8 — Delete `projects/<project>/`

Only proceed if:

- Step 2 (DoD) passed.
- Step 5 (classification) was operator-confirmed.
- Step 6 (migration) succeeded.
- Step 7 (reference scan) is clean.

Use `git rm -rf projects/<project>/`. Verify with `git status` that the deletion is staged.

### Step 9 — Open the close-out PR

Delegate to `drive-pr-description` in `direct-change` mode for the title + description. The description should include:

- The DoD verification block from step 2 (acceptance criteria with evidence).
- Migration summary: N long-lived files migrated to `docs/<project>/` (or wherever), with a quick file-tree diff.
- Reference-strip summary: N files updated, M references re-pointed, K removed.
- Linear ticket reference so the GitHub integration auto-transitions on merge.

Commit cadence per `commit-as-you-go` skill — at minimum one commit per:

1. Migration (`docs: migrate long-lived docs from projects/<project>/` — multiple commits if the migration is large enough to benefit from semantic slicing).
2. Reference strip (`docs: re-point references from projects/<project>/ to docs/<project>/`).
3. Deletion (`chore: delete projects/<project>/`).

Push and open the PR.

## What this skill doesn't do

- **Run the final retro for you.** The retro is a separate skill (`drive-run-retro`, mandatory-final trigger). This skill verifies the retro happened and refuses to proceed if it didn't.
- **Decide whether decisions need ADRs.** If `design-decisions.md` contains undocumented architectural decisions, this skill surfaces them at classification time and points at `drive-create-adr` (or comparable) — but it doesn't author the ADR.
- **Linear ticket bookkeeping for individual issues.** GitHub's Linear integration auto-transitions issues to completed when a referenced PR merges; this skill ensures the close-out PR references the Linear Project so the integration fires.
- **Upstream propagation of long-lived docs.** If the migrated docs need to land in a different repo (e.g., ignite), that's a separate operation.
- **Force-close a project whose DoD is unmet.** Refuses by design — closing a project with unmet acceptance criteria silently drops obligations.

## Common Pitfalls

1. **Skipping the operator confirmation at step 5.** Symptom: a long-lived file gets classified transient by a default rule, file is deleted, and lessons it captured are lost. Fix: step 5 is a hard gate. Default rules are heuristics, not authority — the operator owns the final call.
2. **Treating retros as long-lived.** Symptom: `retros.md` migrates into `docs/<project>/retros.md` and accumulates project-archeology cruft. Fix: per the retro principle, lessons land in surfaces the next dispatch reads (skills / READMEs / ADRs). The retro log itself is transient; if a lesson hasn't landed somewhere durable, that's a step-2 DoD failure, not a step-6 migration concern.
3. **Treating `design-decisions.md` as long-lived.** Symptom: project's `design-decisions.md` migrates to `docs/<project>/design-decisions.md` because it "documents decisions". Fix: decisions worth preserving should already have migrated to ADRs during the project (the principles document this). If they haven't, surface at step 4 and require ADR migration before close — not a docs/<project>/ migration of the raw log.
4. **Re-pointing references at `projects/<project>/**` content that's about to vanish.** Symptom: post-close, a `docs/onboarding/X.md` link points at `projects/<old-project>/spec.md` which 404s. Fix: step 7 is the gate. Re-run the step-3 scan after step 7 to verify the residual is empty.
5. **Silent overwrite at migration.** Symptom: a destination file already exists and gets clobbered by `git mv`. Fix: surface every collision at step 6; let the operator decide (merge, rename, skip).
6. **Closing on incomplete deferral records.** Symptom: a slice was "deferred" but no follow-up ticket exists, so the work just disappears. Fix: step 2 verifies every deferral has a follow-up ticket reference; absent that, the DoD check fails.
7. **Forgetting the close-out PR's Linear reference.** Symptom: PR merges, issues don't auto-transition, operator manually closes them and the Linear activity log gets noisy. Fix: step 9 requires the Linear Project reference in the PR title or description before pushing.
8. **Migrating project-shaping voice as long-lived methodology.** Symptom: a doc whose *content* is methodology (model, workflow, principles) but whose *voice* is project-shaping ("what we're proposing", "before-after", "what changes") gets `git mv`'d into `docs/` unchanged. A fresh reader has no baseline for "new vs existing"; the framing becomes incoherent the moment the project closes. Fix: step 4.5 runs the prose audit and routes such files to rewrite-at-migration (strip framing, keep methodology) — or reclassifies them as transient if the file *is* fundamentally project narrative. Filename-only classification is necessary but not sufficient.
9. **Migrating worked-example pollution that duplicates project-context.** Symptom: a principle doc has a "Worked example for `<repo>`:" section enumerating overlays — the same overlays that already live in `drive/<category>/README.md`. After migration the overlay exists in two homes, drifts independently, and ties methodology to a specific repo. Fix: step 4.5's smell test 3 catches this; the disposition is lift-example-to-context (move the worked-example content to the matching READMEs) + replace with a one-line pointer in the migrated file. Same pattern as `calibration/**`.
10. **Migrating worked examples anchored to specific incidents.** Symptom: a methodology principle uses a real-world example with a specific date, project name, or ticket ID. Useful as the project's living memory; opaque archeology once it migrates to docs other teams will read. Fix: step 4.5's smell test 4 catches this; the disposition is soften-at-migration (placeholders for specifics, keep the example shape).

## Reference files

- `../drive-deliver-workflow/SKILL.md` — invokes this skill as its terminal step.
- `../drive-run-retro/SKILL.md` — the mandatory final retro this skill verifies completion of.
- `../drive-pr-description/SKILL.md` — generates the close-out PR description (direct-change mode).
- `../drive-bootstrap-context/SKILL.md` — invoked at step 1 if `drive/project/README.md` is missing.
- `drive/project/README.md` (consumer-side) — destination root + classification overlays.

## Checklist

- [ ] Project context loaded (`drive/project/README.md`, `drive/pr/README.md`).
- [ ] Every acceptance criterion in `spec.md` verified met / deferred-with-ticket / cancelled-with-rationale. Result block drafted for the PR description.
- [ ] Mandatory final retro completion verified (per invariant I10).
- [ ] External-reference scan run; worklist recorded.
- [ ] Every file under `projects/<project>/` classified; ambiguous files surfaced to operator.
- [ ] Prose audit (step 4.5) run on every long-lived candidate; per-file dispositions recorded (none / rewrite-at-migration / lift-example-to-context / soften-at-migration / reclassify-as-transient).
- [ ] Operator confirmed the classification list **with dispositions attached** before any deletion.
- [ ] Long-lived files migrated to destination per their disposition (`git mv` for the trivial case; rewrite / lift / soften for the audited cases); index doc (`docs/<project>/README.md` or equivalent) written.
- [ ] External references re-pointed or removed; re-scan returns empty.
- [ ] `projects/<project>/` deleted via `git rm -rf`.
- [ ] Close-out PR opened; Linear Project referenced; commits sliced per `commit-as-you-go`.
- [ ] If any project-specific classification rule emerged during the run, it was written back to `drive/project/README.md` (write-back contract).
