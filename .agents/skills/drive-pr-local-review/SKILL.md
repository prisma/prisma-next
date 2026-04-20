---
name: drive-pr-local-review
description: Generate local PR/branch review artifacts for the current branch vs its base - an in-repo canonical
  spec (if present) or an inferred review `spec.md`, plus `system-design-review.md`, `code-review.md`,
  and `walkthrough.md` (via `.agents/skills/drive-pr-walkthrough/SKILL.md`). Writes artifacts to disk
  (next to the in-repo spec when present, otherwise under `wip/`). Use when the user asks for a local
  PR/branch review, a code review, a system design review, to "review this branch", or to produce
  written review docs. Do not modify implementation code.
metadata:
  version: "2026.4.15.1"
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
- Acceptance-criteria verification (see 4.5 — verify each AC against code and test assertions, not just map to files)

### 4.2) Output structure (required)

`code-review.md` must include these sections at minimum (you may add additional sections as useful):
- Summary (1–2 sentences)
- What looks solid (positive notes; can appear near the top)
- Findings (flat list — everything to address in this PR)
- Deferred (out of scope) (issues explicitly not addressed because they expand scope beyond what this PR delivers; must state *why* each is out of scope)
- Already addressed (table of findings from prior review rounds that have been fixed; include commit hash when available)
- Acceptance-criteria verification (see 4.5)

#### Categorization heuristic

Do **not** use blocking / non-blocking / nits tiers. Agents do implementation — perceived effort is not a useful signal for whether something should be fixed. The only legitimate reason to defer a finding is **scope**: fixing it would pull in work that belongs to a different PR or milestone. If a finding is in scope, it goes in **Findings** and gets addressed. If fixing it would expand scope beyond what this PR delivers, it goes in **Deferred** with a clear reason.

Prioritize findings by impact: security > correctness > performance > maintainability > style.

### 4.3) Finding format (required)

#### 4.3.1) Finding IDs (required)

All findings must have a **unique, unambiguous ID** so they can be referenced from other places (follow-up docs, comments, issue trackers).

- Use a single, globally unique sequence across the entire `code-review.md` (do not restart numbering per section).
- Preferred format: `F<NN>` (e.g. `F01`, `F02`, …). All findings and deferred items share the same sequence.

For each finding, include:
- **Location**: repo-relative path, and line range **as plain text** (not inside a `path:line` markdown link). In **Cursor** (`CURSOR_AGENT`, `CURSOR_TRACE_ID`, or `CURSOR_CLI` set, or user says output is for Cursor): use a path-only markdown link `[path](path)` and put the range after it, e.g. ` — lines 12–34`. Outside Cursor, you may use `[path (L12–L34)](path:12-34)` if links resolve for the reader.
- **Issue**: concise description of the problem and why it matters
- **Suggestion**: concrete fix or improvement
- **Code example** (when helpful): suggested change

For acceptance-criteria verification entries, see 4.5.

### 4.4) Review boundaries (required)

Do not:
- Review formatting-only changes (defer to formatters/linters)
- Nitpick personal preferences that do not affect readability or maintainability
- Suggest large rewrites when the current approach is acceptable
- Flag issues in unchanged code unless directly impacted by the change
- Use absolute filesystem paths in the review

### 4.5) Acceptance-criteria verification (required)

If the spec (or inferred review spec) contains acceptance criteria, the code review **must verify each one** against the actual implementation. This is the most important part of the review — it answers "did we build what we said we'd build?"

#### What "verify" means

Pointing to a file is not verification. For each acceptance criterion:

1. **Read the AC literally.** What observable behavior or property does it require?
2. **Find the implementation code** that is supposed to satisfy it. Read the code — does it actually do what the AC says?
3. **Find the test(s)** that prove it. Read the test assertions — do they actually assert the AC's requirement, or do they assert something weaker?
4. **Assign a verdict**: one of PASS, FAIL, NOT VERIFIED, or WEAK.

Verdict definitions:
- **PASS**: The implementation satisfies the AC, and a test exists that asserts the specific behavior the AC requires.
- **FAIL**: The implementation does not satisfy the AC (missing, incomplete, or incorrect behavior). State what is missing or wrong.
- **NOT VERIFIED**: No test or manual evidence exists to confirm the AC. The implementation may look correct by inspection but nothing proves it works. State what verification is missing.
- **WEAK**: A test exists but its assertions do not actually prove the AC (e.g. the AC requires byte-identical output but the test only checks object references; the AC requires a specific provider is selected but the test only checks `typeof === 'function'`). State what the test actually asserts vs. what the AC requires.

#### Common traps to avoid

- **Mapping, not verifying**: Listing a file path next to an AC is not verification. You must read the code and test assertions and confirm they match the AC's requirement.
- **Trusting test names**: A test named "selects TypeScript provider" that only asserts `typeof source === 'function'` does not verify provider selection. Read the assertions, not the test name.
- **Confusing structural equivalence with behavioral equivalence**: Checking that two config objects have the same `.family` reference is not the same as checking that they produce identical emit output.
- **Assuming E2E coverage exists**: If an AC requires end-to-end behavior (e.g. "tsc reports no errors"), check whether an E2E test actually exists. If it doesn't, the verdict is NOT VERIFIED regardless of how correct the unit tests look.

#### Noting the absence of integration/E2E tests

When acceptance criteria describe end-to-end behavior (user runs command → observable outcome), they are most reliably verified by integration or E2E tests that exercise the full stack. If such tests are absent:
- Flag this explicitly in the verification table.
- Note it as a finding (not deferred — missing AC evidence is in scope for any PR that claims to deliver those ACs).
- Recommend the specific integration/E2E tests that would close the gap.

#### Output format

Include a verification table with a row per AC and a summary count:

```markdown
| AC | Verdict | Detail |
|---|---|---|
| AC1: <short statement> | **PASS** / **FAIL** / **NOT VERIFIED** / **WEAK** | <What you checked, what you found, why this verdict> |
| ... | ... | ... |

### Summary

| Result | Count | ACs |
|---|---|---|
| PASS | N | AC2, AC3, ... |
| FAIL | N | AC1, ... |
| NOT VERIFIED | N | AC4, ... |
| WEAK | N | AC8, ... |
```

## 5) Write the walkthrough

Write `walkthrough.md` as a semantic narrative of the change set.

Requirement:
- Use the `/walkthrough` workflow from `.agents/skills/drive-pr-walkthrough/SKILL.md` and **override its output path** so the file lands next to the review artifacts.

