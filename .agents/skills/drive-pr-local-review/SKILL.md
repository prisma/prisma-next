---
name: drive-pr-local-review
description: Generate local PR/branch review artifacts for the current branch vs its base — an in-repo canonical spec (if present) or an inferred review `spec.md`, plus `system-design-review.md`, `code-review.md`, and `walkthrough.md`. Composite skill — adopts the `tech-lead` persona and delegates in order to the atomic sub-skills `review-system-design` (architect), `review-implementation` (principal-engineer), and `review-walkthrough` (tech-lead). Writes artifacts to disk (next to the in-repo spec when present, otherwise under `wip/`). Use when the user asks for a local PR/branch review, a code review, a system-design review, to "review this branch", or to produce written review docs. Do not modify implementation code.
metadata:
  version: "2026.5.9"
---

# Local PR Review (composite)

## Premise

A code review must be anchored to **expectations**. Those expectations come from:

- Explicit intent sources (PR description, linked tickets, design docs) when available, plus
- A canonical spec file (author-provided in-repo on the branch when available, otherwise a review `spec.md` you write) to make expectations explicit and reviewable.

You do not change implementation code. You only write review artifacts.

## Composite shape

This skill is a **Shape-A composite** per `drive-agent-personas/SKILL.md § Composite skills § Shape A`. It adopts the `tech-lead` persona as orchestrator and delegates in declared order to three atomic sub-skills, each of which produces one artefact under one persona:

| Order | Sub-skill                            | Persona              | Artefact                  |
| ----- | ------------------------------------ | -------------------- | ------------------------- |
| 1     | [`review-system-design`](../review-system-design/SKILL.md) | `architect`          | `system-design-review.md` |
| 2     | [`review-implementation`](../review-implementation/SKILL.md) | `principal-engineer` | `code-review.md`          |
| 3     | [`review-walkthrough`](../review-walkthrough/SKILL.md) | `tech-lead`          | `walkthrough.md`          |

The composite owns the cross-cutting work: scope establishment (branch + base resolution), expectation-source establishment (canonical-spec-or-inferred), artefact-directory choice, and orchestration. The composite delegates **all review logic** to the three atomic sub-skills — no review of substance happens in this file.

## Persona

> **Adopt the `tech-lead` persona** (see the `drive-agent-personas` skill). The tech-lead is the orchestrator for this composite: they pick the lens (each sub-skill loads its own at delegation), surface conflicts that emerge between the sub-skills' verdicts, package the synthesis at the right altitude for the human reading the artefacts.

The tech-lead persona does **not** review substantively here — that is the architect's, the principal-engineer's, and (for the walkthrough's altitude) the tech-lead's job *inside the respective sub-skills*. The composite-level tech-lead's job is delegation, not lens-pass execution. Each sub-skill loads its own persona at its own delegation; persona is **not** propagated by this composite.

## Outputs (always written to disk)

Every run must produce these artifacts **side-by-side** in a single artefact directory:

- `system-design-review.md` (produced by `review-system-design`)
- `code-review.md` (produced by `review-implementation`)
- `walkthrough.md` (produced by `review-walkthrough`)

`spec.md` is only written when the branch does not already contain an in-repo canonical spec file. If a spec exists, do not duplicate it in the review outputs; reference it.

Output location rule:

- If a canonical spec **file exists in-repo on the current branch**, write review artifacts next to it (see § 2).
- Otherwise (including when the only spec is external/off-branch), write review artifacts under `wip/` (local-only scratch; never commit).

## 1) Establish the review scope (branch + base)

Owned by the composite (not the sub-skills) — every sub-skill assumes scope is already resolved.

Defaults:

- Review the **current branch**.
- Base is the PR base branch when a GitHub PR exists; otherwise the repo default branch (typically `main`).

Explicit override rule:

- If the user specifies a base/parent branch, honor it exactly for the review range.
- Do not substitute `origin/HEAD` or `origin/main` when an explicit base is provided.
- If the provided name is ambiguous, resolve to `origin/<base>` when possible and record the resolved range in artifacts.

Steps:

1. Determine current branch name.
2. Fetch latest refs from origin.
3. Resolve base branch:
   - If the user provided a base/parent branch, use it exactly.
   - If the provided name is ambiguous, resolve to `origin/<base>` when possible and record the resolved range in artifacts.
   - Otherwise, if a PR exists for the current branch, use its `baseRefName`.
   - Otherwise use the repo default branch (from `origin/HEAD`, typically `main`).
4. Establish the review range:
   - Topic branch: `origin/<base>...HEAD`
   - If already on default branch: infer best-effort scope from git history and clearly state uncertainty in the reports.

Evidence to capture (passed to each sub-skill):

- `git log --oneline origin/<base>..HEAD`
- `git diff --name-only origin/<base>...HEAD`
- `git diff origin/<base>...HEAD`

PR discovery hints:

- `gh pr view --json number,url,title,body,baseRefName,headRefName`
- Fallback: `gh pr list --head <branch> --state all --json number,url,title,body,baseRefName,headRefName --limit 1`

## 2) Establish expectations (use canonical spec or infer one)

Owned by the composite (not the sub-skills).

### 2.1) Choose an artifact directory (prefer next to an existing in-repo spec)

First, locate a canonical spec **file in-repo on the current branch** (preferred inputs first).

Important:

- A "canonical spec" in this step means a spec **file** that exists in this repo on this branch.
- If the user / PR links an external spec (URL, other repo, or a file not present on this branch), treat it as an expectation source (§ 2.2), but it does **not** control artifact placement.

Preferred inputs:

1. If the user provided an **in-repo** spec file path (repo-relative or workspace-absolute) and it exists on this branch, treat it as canonical.
2. Else, if the GitHub PR body links to or mentions an **in-repo** spec file path that exists on this branch, treat it as canonical.
3. Else, search the branch for spec-like docs and pick the best match:
   - Prefer: `specs/**/spec.md`, `projects/**/spec.md`
   - Also consider: `**/spec.md`, `**/requirements.md`, `**/design.md` (especially if added/changed in the diff)

Then choose where artifacts go:

- If an in-repo canonical spec exists:
  - Let `SPEC_DIR` be the folder containing the spec file.
  - If PR number is available: write to `SPEC_DIR/reviews/pr-<PR_NUMBER>/`
  - Else: write to `SPEC_DIR/reviews/`
- Otherwise (no in-repo canonical spec):
  - If PR number is available: write to `wip/review-code/pr-<PR_NUMBER>/`
  - Else: write to `wip/review-code/branch-<BRANCH_NAME>/`

### 2.2) Gather expectation sources (inputs to your expectations model)

Prefer explicit intent sources over inference from the diff:

1. Canonical spec file (if present from § 2.1)
2. External / off-branch spec (if provided by the user or linked in the PR body)
3. GitHub PR title / body
4. Linear ticket linked in the PR body (preferred), otherwise inferable from branch name (e.g. `ABC-123`), otherwise absent
5. New / changed documentation on the branch that clarifies intent / constraints (ADRs, READMEs, `docs/**`)
6. The diff itself (last resort for intent)

If the branch includes additional spec-like docs beyond the canonical spec file, treat them as supporting intent sources, for example:

- `**/requirements.md`, `**/design.md`
- Relevant ADRs under `docs/architecture docs/adrs/`

### 2.3) Ensure a review spec exists (required)

If an in-repo canonical spec exists (from § 2.1), **use it** as the review spec input and do **not** write a new one.

If the author has not provided an in-repo canonical spec, infer one and write a review `spec.md` into the artifact directory (even if an external/off-branch spec exists; treat it as a primary source and link it).

If the spec is inferred, it must begin with a highly visible notice stating:

- that it was constructed by you (the composite skill, in the orchestrator role), and
- the sources it was inferred from (PR/Linear/docs/diff), with links/paths.

If you are writing an inferred review `spec.md`, it must:

- State whether expectations are **explicit** (linked docs) vs **inferred** (from PR/Linear/diff)
- List **sources** (PR/Linear/docs) with links/paths
- Include:
  - Intent
  - Functional requirements
  - Non-goals / out of scope
  - Constraints / invariants / compatibility
  - Acceptance criteria
  - Risks (migration / perf / security / rollout)
- If a requirement is ambiguous, record it as an explicit assumption or open question.

Linear enrichment:

- If a Linear ticket link exists and you can fetch it, use it to refine requirements / non-goals / acceptance criteria.

## 3) Delegate to the atomic sub-skills (in order)

Once scope (§ 1) and expectations (§ 2) are established, delegate in declared order:

### 3.1) `review-system-design` → `system-design-review.md`

Invoke the [`review-system-design`](../review-system-design/SKILL.md) sub-skill, passing:

- The resolved review scope (branch + base + commit range).
- The path to the canonical or inferred review spec.
- The artefact directory (where to write `system-design-review.md`).

That sub-skill loads the `architect` persona and produces `system-design-review.md`. The composite does **not** review system design here — the sub-skill is the authority.

### 3.2) `review-implementation` → `code-review.md`

Invoke the [`review-implementation`](../review-implementation/SKILL.md) sub-skill, passing:

- The same review scope.
- The same review spec path.
- The same artefact directory (where to write `code-review.md`).
- A reminder to read repo conventions: at minimum `AGENTS.md` plus any relevant `.cursor/rules/**` and package `README.md` touched by the diff.

That sub-skill loads the `principal-engineer` persona and produces `code-review.md`, including AC verification per its `§ Acceptance-criteria verification` section. The composite does **not** review implementation here.

### 3.3) `review-walkthrough` → `walkthrough.md`

Invoke the [`review-walkthrough`](../review-walkthrough/SKILL.md) sub-skill, passing:

- The same review scope.
- The same review spec path.
- The same artefact directory.
- The paths to `system-design-review.md` and `code-review.md` (now produced by § 3.1 / § 3.2) so the walkthrough can reference their conclusions at the right altitude.

That sub-skill loads the `tech-lead` persona, applies the altitude probe across the walkthrough, and delegates to `drive-pr-walkthrough`'s `/walkthrough` workflow for the file's mechanical structure (with the output path overridden to land in the artefact directory).

## 4) Synthesis

After all three sub-skills return, the composite (still under the `tech-lead` orchestrator persona) does a final pass:

- Verify all three artefacts exist side-by-side in the artefact directory.
- Surface to the user any cross-lens conflicts the sub-skills raised — the architect persona's verdict on a typology question and the principal-engineer persona's verdict on its operability implications can land in different places. The composite **does not adjudicate**; it surfaces the conflict at the right altitude (per the tech-lead's *persona-conflict probe*) and points the human at both substantive artefacts.
- Output a short pointer to the artefact directory in chat (per `drive-pr-walkthrough`'s convention: short confirmation, not the full content).

## Future-extensibility

As v2+ personas are admitted (security, QA, etc.), additional review sub-skills slot into this composite at the appropriate position in the delegation order — `review-security` (security persona) before `review-implementation` when threat-modelling matters; `review-test-coverage` (QA persona) after `review-implementation` when the QA frame is load-bearing; etc.

The orchestrator persona stays `tech-lead`; the synthesis pass stays `tech-lead`; the new sub-skill slots in as a localised insertion at the right position with its own persona-load instruction in its own SKILL.md, following the pattern of the existing three sub-skills.
