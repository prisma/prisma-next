---
name: drive-pr-local-review
description: Generate local PR/branch review artifacts for the current branch vs its base - an in-repo canonical
  spec (if present) or an inferred review `spec.md`, plus `system-design-review.md`, `code-review.md`,
  and `walkthrough.md` (via `.agents/skills/drive-pr-walkthrough/SKILL.md`). Writes artifacts to disk
  (next to the in-repo spec when present, otherwise under `wip/`). Use when the user asks for a local
  PR/branch review, a code review, a system design review, to "review this branch", or to produce
  written review docs. Do not modify implementation code.
metadata:
  version: "2026.3.26.1"
---

# Local PR Review

## Premise

A code review must be anchored to **expectations**. Those expectations come from:
- Explicit intent sources (PR description, linked tickets, design docs) when available, plus
- A canonical spec file (author-provided in-repo on the branch when available, otherwise a review `spec.md` you write) to make expectations explicit and reviewable.

You do not change implementation code. You only write review artifacts.

## Outputs (always written to disk)

Every run must produce these artifacts **side-by-side**:
- `system-design-review.md`
- `code-review.md`
- `walkthrough.md` (must use the `/walkthrough` workflow from `.agents/skills/drive-pr-walkthrough/SKILL.md`; override its output path to land next to the other artifacts)

`spec.md` is only written when the branch does not already contain an in-repo canonical spec file. If a spec exists, do not duplicate it in the review outputs; reference it.

Output location rule:
- If a canonical spec **file exists in-repo on the current branch**, write review artifacts next to it (see 2.1).
- Otherwise (including when the only spec is external/off-branch), write review artifacts under `wip/` (local-only scratch; never commit).

## 1) Establish the review scope (branch + base)

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

Evidence to capture (for your own analysis):
- `git log --oneline origin/<base>..HEAD`
- `git diff --name-only origin/<base>...HEAD`
- `git diff origin/<base>...HEAD`

PR discovery hints:
- `gh pr view --json number,url,title,body,baseRefName,headRefName`
- Fallback: `gh pr list --head <branch> --state all --json number,url,title,body,baseRefName,headRefName --limit 1`

## 2) Establish expectations (use canonical spec or infer one)

### 2.1) Choose an artifact directory (prefer next to an existing in-repo spec)

First, locate a canonical spec **file in-repo on the current branch** (preferred inputs first).

Important:
- A “canonical spec” in this step means a spec **file** that exists in this repo on this branch.
- If the user/PR links an external spec (URL, other repo, or a file not present on this branch), treat it as an expectation source (2.2), but it does **not** control artifact placement.

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
1. Canonical spec file (if present from 2.1)
2. External/off-branch spec (if provided by the user or linked in the PR body)
3. GitHub PR title/body
4. Linear ticket linked in the PR body (preferred), otherwise inferable from branch name (e.g. `ABC-123`), otherwise absent
5. New/changed documentation on the branch that clarifies intent/constraints (ADRs, READMEs, `docs/**`)
6. The diff itself (last resort for intent)

If the branch includes additional spec-like docs beyond the canonical spec file, treat them as supporting intent sources (not a required format), for example:
- `**/requirements.md`, `**/design.md`
- Relevant ADRs under `docs/architecture docs/adrs/`

### 2.3) Ensure a review spec exists (required)

If an in-repo canonical spec exists (from 2.1), **use it** as the review spec input and do **not** write a new one.

If the author has not provided an in-repo canonical spec, infer one and write a review `spec.md` into the artifact directory (even if an external/off-branch spec exists; treat it as a primary source and link it).

If the spec is inferred, it must begin with a highly visible notice stating:
- that it was constructed by you (the reviewer), and
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
  - Risks (migration/perf/security/rollout)
- If a requirement is ambiguous, record it as an explicit assumption or open question.

Linear enrichment:
- If a Linear ticket link exists and you can fetch it, use it to refine requirements/non-goals/acceptance criteria.

## 3) Write the system / solution design review

Write `system-design-review.md` focused on architecture and system design, grounded in the spec and any design docs added/changed on the branch.

Minimum coverage:
- What problem is being solved; what new guarantees/invariants are introduced
- Subsystem fit (contracts, plans, runtime, adapters/plugins, capability gating)
- Boundary correctness (domain/layer/plane imports; deterministic artifacts)
- ADRs: if the branch adds/changes ADRs under `docs/architecture docs/adrs/`, treat them as design-intent sources and explicitly review their reasoning/trade-offs
- Test strategy adequacy at the architectural level (what must be proven, where)

## 4) Write the code review

Write `code-review.md` grounded in the spec and the established diff range.

Minimum inputs:
- Read the repo conventions relevant to the change (at least `AGENTS.md` + any relevant `.cursor/rules/**` and package `README.md` touched by the diff).
- Read changed files in full when the diff is insufficient to assess correctness, intent, or invariants.

### 4.1) Review criteria (minimum coverage)

Evaluate changes against:
- Idiomaticity (language-idiomatic patterns and naming)
- Best practices & patterns (including project-specific conventions)
- Clarity & conciseness (readability, naming, unnecessary complexity)
- Comments & intent (comments explain *why*, not *what*; no misleading/outdated comments)
- Performance (obvious regressions, unnecessary allocations, avoidable extra work)
- Security (input validation, secrets handling, injection risks, authz/authn enforcement where applicable)
- Correctness & edge cases (boundary conditions, failure modes, concurrency/reentrancy where relevant)
- Documentation (public API docs, READMEs, breaking changes, usage examples when appropriate)
- Tests as evidence of behavior (call out gaps and mismatches with expectations)
- Spec traceability (map key requirements → implementation touchpoints + tests)

### 4.2) Output structure (required)

`code-review.md` must include these sections at minimum (you may add additional sections as useful):
- Summary (1–2 sentences)
- What looks solid (positive notes; can appear near the top)
- Blocking issues (must fix before merge)
- Non-blocking concerns (important issues to address or explicitly track; includes maintainability, performance follow-ups, and design/ADR gaps)
- Nits (optional; safe to ignore unless the author prefers cleanup)
- Acceptance-criteria traceability (acceptance criteria → implementation → evidence)

Guidance:
- “Blocking issues” is the hard gate (do not merge until addressed).
- “Non-blocking concerns” are not a merge gate, but they are not “nits”; they should be handled now or captured as explicit follow-up work.
- “Nits” are optional polish only; avoid mixing maintainability concerns into this section.

Prioritize findings by impact: security > correctness > performance > maintainability > style.

### 4.3) Finding format (required)

#### 4.3.1) Finding IDs (required)

All findings must have a **unique, unambiguous ID** so they can be referenced from other places (follow-up docs, comments, issue trackers).

- Use a single, globally unique sequence across the entire `code-review.md` (do not restart numbering per section).
- Preferred format: `F<NN>` (e.g. `F01`, `F02`, …), optionally with a section prefix for readability (e.g. `BLOCK-F01`, `NB-F02`, `NIT-F03`), but keep IDs globally unique.

For each finding, include:
- **Location**: repo-relative path, and line range **as plain text** (not inside a `path:line` markdown link). In **Cursor** (`CURSOR_AGENT`, `CURSOR_TRACE_ID`, or `CURSOR_CLI` set, or user says output is for Cursor): use a path-only markdown link `[path](path)` and put the range after it, e.g. ` — lines 12–34`. Outside Cursor, you may use `[path (L12–L34)](path:12-34)` if links resolve for the reader.
- **Issue**: concise description of the problem and why it matters
- **Suggestion**: concrete fix or improvement
- **Code example** (when helpful): suggested change

For acceptance-criteria traceability entries, include:
- **Acceptance criterion**: a short statement from the spec (or inferred requirement)
- **Implementation**: the primary code touchpoints
- **Evidence**: tests, fixtures, or other verification that prove behavior

### 4.4) Review boundaries (required)

Do not:
- Review formatting-only changes (defer to formatters/linters)
- Nitpick personal preferences that do not affect readability or maintainability
- Suggest large rewrites when the current approach is acceptable
- Flag issues in unchanged code unless directly impacted by the change
- Use absolute filesystem paths in the review

## 5) Write the walkthrough

Write `walkthrough.md` as a semantic narrative of the change set.

Requirement:
- Use the `/walkthrough` workflow from `.agents/skills/drive-pr-walkthrough/SKILL.md` and **override its output path** so the file lands next to the review artifacts.

