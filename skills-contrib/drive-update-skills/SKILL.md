---
name: drive-update-skills
description: >
  Routinely refresh in-repo drive-* skill copies against canonical, and patch
  cross-references in other in-repo skills that point at drive-* skills whose canonical
  text moved or was renamed. Refuses to run on drifted skills (the operator must run
  drive-reconcile-skills first so project-specific edits are preserved). Use when the
  operator wants the latest canonical drive-* skills pulled into the consumer project
  without losing cross-references in non-drive skills. Imported from ignite PR #93;
  canonical-source resolution adapted for the trial period.
metadata:
  version: "2026.5.19"
---

> **Execution mode: delegated.** This atomic skill is invoked by an Executor sub-agent under an Orchestrator's dispatch brief. The Executor's job is to execute the skill end-to-end within the dispatch scope and return a structured report.
>
> Stay within the dispatch brief's scope. If the skill's body suggests work outside the brief, surface a heartbeat, request scope clarification from the Orchestrator, and do not improvise. See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Executor role definition and report-back conventions.

# Drive: Update Skills from Canonical, Patch Cross-References

Once a consumer project is on the `drive/` context convention (in-repo `drive-*` skill bodies are byte-identical to canonical; project specifics live in `drive/<category>/README.md`), updates become routine: pull latest canonical into the consumer repo. This skill does that, plus patches any cross-references in *non-drive* in-repo skills that point at drive-* skill text that moved or was renamed in the update.

The skill refuses to operate if any in-repo drive-* skill has drifted from canonical, because a blind update would clobber project-specific edits. In that case, point the operator at `drive-reconcile-skills` first.

## When to use

- The operator wants to pull the latest canonical drive-* skills into a consumer project that already uses the `drive/` context convention.
- A new drive-* skill has been added to canonical and the operator wants to install it.
- An existing drive-* skill in canonical was renamed, restructured, or had a referenced section moved, and the operator wants in-repo cross-references in other skills patched.

**Do not use this skill for:**

- In-repo drive-* skill bodies are not byte-identical to canonical (drift detected). → `drive-reconcile-skills` first; then come back.
- The operator wants to update *all* skills, not just drive-*. This skill is scoped to `drive-*`. Use `npx skills update` (or the equivalent unscoped command) directly.
- The operator wants per-skill interactive confirmation on every cross-reference patch. This skill is dry-run-by-default — patches are presented as a diff and applied only after operator confirmation; that is the closest to interactive review without per-patch dialogue.
- **During the prisma-next trial period** (until the drive-* skill set is first upstreamed to ignite): no external canonical exists yet, so there's nothing to pull. Refuse and tell the operator to wait until upstream lands.

## Canonical-source resolution

Resolution varies by environment:

- **Post-upstream (default future state):** Canonical = `git@github.com:prisma/ignite`. Fetch via `npx skills` (preferred — it owns the copy mechanics) or via git directly.
- **Trial period in prisma-next (current state):** No external canonical exists. Skill refuses to run.
- **Consumer projects that pull from prisma-next (transitional):** Canonical = `git@github.com:prisma/prisma-next`, paths `skills-contrib/<skill-name>/SKILL.md`. Fetch via `npx skills` or directly.

## Key concepts

- **Drift gates the update.** Before any update, every in-repo drive-* skill body must match canonical byte-for-byte. If any has drifted, refuse and tell the operator to run `drive-reconcile-skills`. The update operation itself is otherwise a destructive overwrite.
- **Cross-reference scope is "other skill files".** Patching looks at non-drive in-repo skills under the same `skills/` directory (or `skills-contrib/`, `.agents/skills/`, `.claude/skills/`, etc., wherever the drive-* copies live). It does not look at project markdown, AGENTS.md, or other docs — too unbounded.
- **Detection is conservative.** A patch is proposed only when both a literal skill name match AND a path/anchor reference appear in the same file. Either-alone produces too many false positives.
- **Dry-run by default.** Show the operator a diff of every proposed cross-reference patch before applying. Skill-body updates happen via `npx skills` and follow that tool's UX; cross-reference patches are this skill's responsibility and gate on operator confirmation.

## Workflow

### 1. Verify canonical exists

Per § Canonical-source resolution above. If no canonical exists (trial-period state), refuse with a clear message pointing at the resolution table.

### 2. Drift check (refuse-if-dirty)

For each in-repo drive-* skill:

1. Locate its canonical counterpart (mechanism: agent's choice — `git archive`, GitHub API, local checkout, `npx skills` introspection).
2. Compare the in-repo SKILL.md against canonical byte-for-byte.
3. If any difference, **stop**. Print the list of drifted skills and tell the operator:

   > Drifted skills detected. Routine update would clobber project-specific edits. Run `drive-reconcile-skills` first to extract those edits into `drive/<category>/README.md`, then return here.

   Do not proceed.

If all drive-* skill bodies match canonical, continue.

### 3. Snapshot canonical-before

For each in-repo drive-* skill, record the canonical SKILL.md content *before* update. This becomes the "old" side of cross-reference diffs in step 5.

### 4. Run `npx skills` (or equivalent) to pull latest

Invoke `npx skills add --copy <consumer-repo-path> --skill <skill-name>` (or the equivalent update command for the version of `npx skills` available) for each installed drive-* skill. Let `npx skills` own the file-replacement mechanics.

After this step, in-repo drive-* skills equal latest canonical. Record this as "canonical-after".

### 5. Scan for cross-references in other in-repo skills

Walk all non-drive in-repo skill files (`skills-contrib/**/SKILL.md` minus the drive-* paths, and the same for any other skill-root location). For each file, look for cross-references that *both*:

- Mention a drive-* skill by literal name (`drive-specify-project`, `drive-qa-run`, etc.), AND
- Reference a path or anchor that targets that skill (`../drive-specify-project/SKILL.md`, `drive-specify-project/SKILL.md#workflow`, `[drive-specify-project](.../drive-specify-project/SKILL.md)`, etc.).

Either signal alone is insufficient — too many false positives.

For each match, diff `canonical-before` vs. `canonical-after` for the referenced anchor / section. If the referenced text:

- **Disappeared** (section removed, file moved) → flag as a *broken* reference. Propose a patch (delete the reference, or point at the closest surviving anchor with a `<!-- TODO: verify -->` comment).
- **Renamed** (heading text changed but section still exists at the same skill) → propose a patch updating the anchor.
- **Unchanged** → leave alone.

Compile the proposed patches into a list.

### 6. Present and apply

Print the proposed patches as a diff. For each:

- **broken** patches require operator confirmation (the closest-anchor heuristic can be wrong).
- **rename** patches are safe enough to apply in bulk after one operator confirmation, but show all of them.

Apply confirmed patches. Skip declined patches and report them.

### 7. Report

Print a summary:

- `<n> drive-* skills updated` from `<old-sha>` → `<new-sha>` of canonical.
- `<n> cross-reference patches applied` / `<n> declined` / `<n> needed no action`.
- Any broken references the operator declined to patch (so they're visible in the report and don't get silently re-flagged on the next update).

Do not commit; print `git status` and let the operator drive.

## What this skill doesn't do

- **Reconcile drifted skills.** That's `drive-reconcile-skills`. This skill refuses to run on drifted state precisely so drift gets handled by the right tool.
- **Patch project markdown, AGENTS.md, or other docs.** Scope is non-drive in-repo skill files only. Broader patching is out of scope and probably best handled by a follow-up search.
- **Commit anything.** All changes are left uncommitted for operator review.
- **Auto-install brand-new drive-* skills the consumer never had.** It updates what is already installed. To install a new skill, run `npx skills add` directly.
- **Run during the prisma-next trial period.** No external canonical exists yet; refuse and surface § Canonical-source resolution.

## Common Pitfalls

1. **Bypassing the drift check.** Symptom: operator runs the update on drifted in-repo skills and project-specific edits vanish. Fix: the drift check is non-negotiable; if it fails, the only valid next action is `drive-reconcile-skills`.
2. **Patching project markdown.** Symptom: scope creeps to AGENTS.md, project specs, etc., and the patch set becomes unreviewable. Fix: scope is *non-drive in-repo skill files* only; broader patching is its own job.
3. **Patching on a single signal.** Symptom: every appearance of the literal string `drive-qa-plan` in another skill becomes a candidate. Fix: require both a literal name match AND a path / anchor reference in the same file.
4. **Auto-applying broken-reference patches.** Symptom: closest-anchor heuristic guesses wrong and the cross-reference ends up pointing at unrelated content. Fix: broken patches always require explicit operator confirmation; renames may bulk-apply.
5. **Committing after the update.** Symptom: the operator can't review before it lands. Fix: never commit; print `git status` and stop.
6. **Failing to record the before / after canonical shas.** Symptom: the operator can't audit what changed. Fix: quote both shas in the final report.
7. **Running during the trial period.** Symptom: skill produces noise about "canonical not reachable". Fix: refuse early and point at § Canonical-source resolution.

## Reference files

- `../drive-reconcile-skills/SKILL.md` — invoked when the drift check fails. The two skills are paired: reconcile for the first migration / when drift exists; update for ongoing maintenance.
- `../drive-bootstrap-context/SKILL.md` — only relevant if the update introduces a new skill family that needs a new `drive/<category>/` directory. The operator should invoke it after the update completes.

## Checklist

- [ ] Verified canonical exists per § Canonical-source resolution (otherwise refuse).
- [ ] Drift check passed on every in-repo drive-* skill (or skill refused to proceed).
- [ ] `canonical-before` and `canonical-after` snapshots captured and shas quoted in the report.
- [ ] Used `npx skills` (or equivalent) for the actual file replacement; did not hand-roll the copy.
- [ ] Cross-reference scan limited to non-drive in-repo skill files; no project markdown patched.
- [ ] Each candidate patch required both a literal skill-name match and a path / anchor reference in the same file.
- [ ] Broken-reference patches presented for individual confirmation; rename patches presented as a bulk-confirm batch.
- [ ] Declined patches reported so they're visible (no silent skip).
- [ ] No commits made; `git status` printed.
