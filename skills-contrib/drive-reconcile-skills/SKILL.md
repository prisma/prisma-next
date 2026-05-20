---
name: drive-reconcile-skills
description: >
  One-shot migration tool for consumer projects whose drive-* skill copies have drifted
  from canonical. Diffs each installed drive-* skill against canonical, auto-classifies
  each delta as either project-specific (extracted to drive/<category>/README.md) or
  upstream-worthy (recorded to wip/drive-upstream-improvements.md), then replaces the
  in-repo skill with the canonical version. Idempotent. Use when adopting the drive/
  context convention in a project that already had drifted skill copies, or when cleaning
  up after ad-hoc skill edits. Imported from ignite PR #93; canonical-source resolution
  adapted for the trial period.
metadata:
  version: "2026.5.19"
---

> **Execution mode: delegated.** This atomic skill is invoked by an Executor sub-agent under an Orchestrator's dispatch brief. The Executor's job is to execute the skill end-to-end within the dispatch scope and return a structured report.
>
> Stay within the dispatch brief's scope. If the skill's body suggests work outside the brief, surface a heartbeat, request scope clarification from the Orchestrator, and do not improvise. See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Executor role definition and report-back conventions.

# Drive: Reconcile Drifted Skill Copies

Reconcile drifted in-repo drive-* skill copies against canonical. Extracts project-specific deltas into `drive/<category>/README.md`, records upstream-worthy deltas to a wip surface for operator triage, and restores in-repo skill bodies to byte-identical canonical.

Before the `drive/` context convention existed, consumer projects copied drive-* skills into their own repos and edited them in place to capture project-specific facts. That worked but it broke portability: in-repo skills slowly drifted from canonical and improvements stopped flowing in either direction.

This skill resolves the drift. For each installed drive-* skill:

1. **Diff** the in-repo copy against the canonical version.
2. **Auto-classify** each delta as either *project-specific* (belongs in `drive/<category>/README.md`) or *upstream-worthy* (should become a PR back to canonical).
3. **Write** project-specific deltas to `drive/<category>/README.md` (scaffolding the directory if absent via `drive-bootstrap-context`).
4. **Record** upstream-worthy deltas in `wip/drive-upstream-improvements.md` for operator review.
5. **Replace** the in-repo skill with the canonical version.

The operator then reviews `wip/drive-upstream-improvements.md`, opens upstream PRs for anything worth it, and discards the rest.

## When to use

- The operator wants to adopt the `drive/` context convention in a project where drive-* skill copies have already been edited.
- An audit shows in-repo `drive-*` skills have drifted from canonical and the operator wants to clean up.
- A new contributor to a project notices the skill copies are stale relative to canonical and asks for a sync.

**Do not use this skill for:**

- The in-repo skill copies have not drifted (verified by diff). Use `drive-update-skills` for the routine refresh instead.
- The drift is in **non-`drive-*` skills**. This skill is scoped to drive-* only; other skill families have their own update mechanisms.
- The operator wants per-delta interactive classification. This skill auto-classifies; if you want manual review per delta, fall back to a manual diff session.
- **During the prisma-next trial period** (until the drive-* skill set is first upstreamed to ignite): there is no canonical-versus-consumer split yet — `skills-contrib/` *is* canonical here. Refuse with a pointer at this note.

## Canonical-source resolution

Resolution varies by environment:

- **Post-upstream (default future state):** Canonical = `git@github.com:prisma/ignite`, branch `main`, paths `skills/.curated/<skill-name>/SKILL.md` or `skills/.experimental/<skill-name>/SKILL.md`. Pick any fetch mechanism (clone, `git archive`, GitHub API, local checkout).
- **Trial period in prisma-next (current state):** No external canonical exists — `skills-contrib/` is itself the canonical source within this repo. This skill is dormant during the trial; refuse and tell the operator to wait until upstream lands.
- **Consumer projects that pull from prisma-next (transitional):** Canonical = `git@github.com:prisma/prisma-next`, paths `skills-contrib/<skill-name>/SKILL.md`. Same mechanism flexibility as the ignite case.

Pin the canonical commit-sha at run-start; quote it in the upstream-record header so the operator can audit what was compared against.

## Key concepts

- **Two output artefacts.** Project-specific deltas go to `drive/<category>/README.md` (durable, committed alongside the project). Upstream-worthy deltas go to `wip/drive-upstream-improvements.md` (transient; operator triages and either PRs or discards).
- **Auto-classification is the agent's job.** No per-delta prompts. Apply the classification rule below consistently across all deltas. When ambiguous, prefer **upstream-worthy** with a `(?)` marker — it's cheaper for the operator to discard an upstream candidate than to discover a project-specific fact got PR'd upstream.
- **Canonical wins on the skill body.** After this skill runs, the in-repo skill body must match canonical byte-for-byte. All differences must have been classified and routed; nothing is silently retained in the skill body.
- **Idempotent.** Running the skill twice produces the same end state (in-repo = canonical, deltas already extracted). The second run is a no-op for the file system; `wip/drive-upstream-improvements.md` is recreated from scratch each run, so the operator should triage it between runs or the second run will overwrite their notes. Detect this and warn before overwriting.
- **No commit.** All outputs are left uncommitted so the operator can review. The operator decides what becomes a project-specific commit, an upstream PR, or trash.

## The classification rule

For each delta (a hunk of text the in-repo copy has that canonical doesn't, or vice versa):

A delta is **project-specific** when any of:

- It names a concrete path in the consumer codebase that doesn't exist in canonical (`packages/3-extensions/pgvector/...`, `apps/foo/...`).
- It names a concrete consumer-codebase symbol, package, table, ticket ID, audience label, or fixture.
- It encodes a project's own conventions for paths, tooling, or destinations (e.g. `pnpm check:upgrade-coverage`, `Linear team TML`).
- It is a fact about *this codebase*, not a fact about *the skill's domain*.

A delta is **upstream-worthy** when any of:

- It is a generalisable improvement that would help any consumer (a new pitfall observed during use; a clearer phrasing; a better example that's not tied to a specific repo).
- It is a structural improvement to the skill itself (new section, better workflow ordering, expanded checklist row with no project-specific anchor).
- It is a typo or grammar fix.
- It is a new piece of domain knowledge about *the skill's subject*, not about *this codebase*.

When a delta could plausibly be either, classify as **upstream-worthy** and prefix with `(?)` in the upstream record. The operator can re-route it during triage.

When a delta is a *mix* of project-specific and upstream-worthy (e.g. a new Pitfall whose example uses a project-specific path), split it: the generalisable Pitfall body goes upstream-worthy with the example genericised; the example itself goes project-specific.

## Workflow

### 1. Inventory installed drive-* skills

Locate the consumer project's drive-* skill copies. Typical locations:

- `skills-contrib/drive-*/SKILL.md` (prisma-next's canonical location).
- `.agents/skills/drive-*/SKILL.md`, `.claude/skills/drive-*/SKILL.md`, `.cursor/skills/drive-*/SKILL.md` (install targets in agent-tool consumers).

If the project uses a non-standard location, ask the operator.

For each match, note: the skill name (from `name:` in the frontmatter), the in-repo path, and the resolved category (the family the skill belongs to: `qa`, `pr`, `spec`, etc.).

### 2. Locate canonical

Per § Canonical-source resolution above. Pin the canonical commit-sha at run-start; quote it in the final report so the operator can verify.

For each in-repo skill, find its canonical counterpart. If neither curated nor experimental canonical location has the skill, the in-repo copy is a consumer-only fork — note it and skip it (this skill only reconciles against canonical).

### 3. Diff and classify

For each (in-repo, canonical) pair:

1. Compute a textual diff. Granularity: per hunk (a contiguous block of additions, deletions, or modifications). For each hunk, treat it as a single delta unless it cleanly subdivides.
2. Apply the classification rule to each delta. Output a structured intermediate record per delta:
   - `skill`: the skill name (e.g., `drive-qa-plan`).
   - `category`: the resolved family (e.g., `qa`).
   - `kind`: `project-specific` | `upstream-worthy` | `mixed:split`.
   - `body`: the delta text.
   - `confidence`: `high` | `low` (low → prefix `(?)` in the upstream record).
   - `rationale`: one-line explanation of the classification.
3. For `mixed:split`, emit two records — one project-specific (the concrete example or path), one upstream-worthy (the generalisable wrapper).

### 4. Write project-specific deltas to `drive/<category>/README.md`

Group records by `category`. For each category:

1. If `drive/<category>/README.md` does not exist, scaffold it by invoking `drive-bootstrap-context` for that single category. This copies the template skeleton.
2. Append the records to the README's most relevant section, or to a new `## Migrated from in-repo skill edits` section if no existing section is an obvious match.
3. Preserve the source attribution in a comment: `<!-- migrated from <skill-path> hunk @ <approximate location> -->`.
4. Do not commit.

### 5. Record upstream-worthy deltas in `wip/drive-upstream-improvements.md`

Create or overwrite `wip/drive-upstream-improvements.md` at the consumer repo root. (Detect existing content first; if non-empty, save it as `wip/drive-upstream-improvements.<timestamp>.bak.md` before overwriting, and tell the operator.)

Structure:

```markdown
# Drive skill improvements pending upstream

> Generated by `drive-reconcile-skills` on <ISO timestamp> against <canonical-source> @ <canonical-sha>.
>
> Each entry below is a candidate upstream PR back to canonical. Review, then either open a PR for it or discard the entry.

## <skill-name> (category: <category>)

### (high) <one-line summary of the delta>

**Suggested upstream path:** `skills/.curated/<skill-name>/SKILL.md` (or `.experimental/`) on ignite; `skills-contrib/<skill-name>/SKILL.md` on prisma-next.

**Rationale:** <one line — why this is upstream-worthy>

**Body:**

\`\`\`markdown
<the delta text, genericised if necessary>
\`\`\`

### (?) <one-line summary of an ambiguous delta>

…
```

`(high)` confidence first, `(?)` last, within each skill section.

### 6. Replace in-repo skills with canonical

For each in-repo skill that was reconciled:

1. Overwrite the in-repo SKILL.md with the canonical SKILL.md.
2. If the canonical skill has sibling files (templates, references), mirror those too.
3. Do not commit.

After step 6, the in-repo skill body is byte-identical to canonical, all project-specific content lives in `drive/<category>/README.md`, and all upstream candidates live in `wip/drive-upstream-improvements.md`.

### 7. Report

Print a summary listing, for each skill:

- `reconciled` — drift was found, deltas extracted, body restored to canonical.
- `clean` — no drift.
- `consumer-only` — no canonical counterpart; skipped.
- `skipped` — operator declined to reconcile.

Then point the operator at:

- The populated `drive/<category>/README.md` files for review.
- `wip/drive-upstream-improvements.md` for triage.
- `git status` to see the full surface for review before committing.

## What this skill doesn't do

- **Routine updates.** Pulling latest canonical onto already-canonical in-repo skills is `drive-update-skills`. This skill is for the *first* migration; once a project is on the context convention, the update skill maintains it.
- **Commit anything.** Outputs are uncommitted. The operator decides what becomes a project-specific commit versus an upstream PR.
- **Open upstream PRs.** It records the candidates. PR-opening is operator-driven (and a separate skill or manual `gh` call).
- **Reconcile non-drive skills.** Scope is `drive-*` only.
- **Run during the prisma-next trial period.** No external canonical exists yet; this skill becomes meaningful after the first upstream PR to ignite.

## Common Pitfalls

1. **Treating every delta as upstream-worthy.** Symptom: `wip/drive-upstream-improvements.md` is huge and `drive/<category>/README.md` is empty. Cause: classification was lenient on the "is this project-specific?" predicate. Fix: re-read the classification rule; anything naming a concrete path, ticket ID, or audience label is project-specific by definition.
2. **Treating every delta as project-specific.** Opposite failure: nothing is offered upstream and the project locks in good improvements that other consumers could benefit from. Fix: when in doubt, mark `(?)` upstream-worthy and let the operator decide.
3. **Splitting a delta into too-small pieces.** Symptom: every sentence of a multi-paragraph addition becomes its own record. Fix: hunk-level granularity is the default; only split when a hunk genuinely mixes generalisable and project-specific content.
4. **Overwriting an existing `wip/drive-upstream-improvements.md` silently.** Symptom: the operator's prior triage notes vanish. Fix: detect non-empty existing content, back it up to a timestamped sibling, tell the operator.
5. **Committing after reconciliation.** Symptom: the operator can't review the diff before it lands. Fix: never commit. Print `git status` at the end and let the operator drive.
6. **Reconciling against the wrong branch.** Symptom: deltas are flagged that are already in canonical `main` but were authored after the canonical sha you compared against. Fix: pin the canonical sha at run-start and quote it in the upstream record header so the operator can verify.
7. **Skipping the bootstrap step.** Symptom: project-specific deltas have nowhere to land because `drive/<category>/README.md` doesn't exist. Fix: invoke `drive-bootstrap-context` for the needed categories before writing.
8. **Running during the trial period.** Symptom: the skill claims everything is "consumer-only" because no canonical exists. Fix: refuse with a clear pointer at § Canonical-source resolution; come back post-upstream.

## Reference files

- `../drive-bootstrap-context/SKILL.md` — invoked in step 4 to scaffold missing category directories.
- `../drive-update-skills/SKILL.md` — the routine-update sibling. Use this for the first migration; that for ongoing maintenance.

## Checklist

- [ ] Verified canonical exists per § Canonical-source resolution (otherwise refuse).
- [ ] Inventoried every `skills-contrib/drive-*` (and equivalent install-target) in the consumer repo.
- [ ] Pinned a canonical sha at run-start and quoted it in the upstream record header.
- [ ] Classified each delta consistently against the rule; ambiguous deltas marked `(?)` and routed upstream.
- [ ] `drive/<category>/README.md` populated for every category with project-specific deltas; bootstrap invoked for any missing categories.
- [ ] Source attributions (`<!-- migrated from ... -->`) preserved in the README so the operator can trace each line.
- [ ] `wip/drive-upstream-improvements.md` regenerated (with backup of any prior content) and grouped by skill, high-confidence first then `(?)`.
- [ ] Every reconciled in-repo skill body byte-identical to canonical.
- [ ] No commits made; `git status` printed and pointed at for operator review.
- [ ] Reported a `reconciled`/`clean`/`consumer-only`/`skipped` summary per skill.
