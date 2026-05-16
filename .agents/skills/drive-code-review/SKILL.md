---
name: drive-code-review
description: Generate local PR/branch review artifacts for the current branch vs its base — an in-repo canonical spec (if present) or an inferred review `spec.md`, plus `system-design-review.md`, `code-review.md`, and `walkthrough.md`. Multi-persona — adopts `tech-lead` as orchestrator, transitions to `architect` for the system-design pass, to `principal-engineer` for the code-review pass, then reloads `tech-lead` for the walkthrough and synthesis. Writes artifacts to disk (next to the in-repo spec when present, otherwise under `wip/`). Use when the user asks for a local PR/branch review, a code review, a system-design review, to "review this branch", or to produce written review docs. Do not modify implementation code.
metadata:
  version: "2026.5.11"
  internal: true
---

# Local PR Review

## Premise

A code review must be anchored to **expectations**. Those expectations come from:

- Explicit intent sources (PR description, linked tickets, design docs) when available, plus
- A canonical spec file (author-provided in-repo on the branch when available, otherwise a review `spec.md` you write) to make expectations explicit and reviewable.

You do not change implementation code. You only write review artifacts.

## Subagent permissions (load-bearing)

Each pass is implemented as a delegated subagent with its own persona load. **Subagents must be launched with write access** so they can persist their artifact directly. The "do not change implementation code" rule above is a *content* constraint on the work, not a *capability* constraint on the agent — the artifact files are repo-relative writes the subagent must perform.

Concretely: when delegating via the Task tool (or equivalent), do **not** set `readonly: true` on review-pass subagents. A read-only subagent will complete the substantive analysis but be unable to write the artifact, forcing the orchestrator to extract content from the subagent transcript — slow, lossy, and a recurrent footgun. The orchestrator's own discipline (no implementation edits) is enforced by the workflow shape, not by sandbox restriction on the writing agent.

If a pass fails for *budget* reasons (`resource_exhausted` or token-budget overrun), prefer one of: (a) re-launch with a tightened prompt that leans on already-landed sibling artifacts (`code-review.md`, `system-design-review.md`) rather than re-deriving them; (b) execute the pass inline in the orchestrator session, since the orchestrator typically already carries the canonical context loaded.

## Persona

> **Adopt the `tech-lead` persona** (see the `drive-agent-personas` skill) as the orchestrator for this workflow. The tech-lead lens drives scope establishment, expectation-source establishment, artefact-directory choice, and the synthesis pass. Internal workflow boundaries below transition to `architect` (system-design pass) and `principal-engineer` (code-review pass); the orchestrator is reloaded for the walkthrough and synthesis. Each transition is its own explicit persona load — persona is not propagated.

## Outputs (always written to disk)

Every run must produce these artifacts **side-by-side** in a single artefact directory:

- `system-design-review.md` (architect pass — § 3)
- `code-review.md` (principal-engineer pass — § 4)
- `walkthrough.md` (tech-lead pass — § 5)

`spec.md` is only written when the branch does not already contain an in-repo canonical spec file. If a spec exists, do not duplicate it in the review outputs; reference it.

Output location rule:

- If a canonical spec **file exists in-repo on the current branch**, write review artifacts next to it (see § 2).
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

Evidence to capture (used by every pass):

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

- that it was constructed by you (in the orchestrator role), and
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

## 3) System-design pass → `system-design-review.md`

> **Transition: adopt the `architect` persona** (see the `drive-agent-personas` skill). The architect lens is the source of truth for this pass — system shape, ubiquitous language, bounded contexts, dependency direction, typology integrity, conceptual integrity, conceptual minimality, plus the discriminator-completeness / consumer-vs-essence / concept-vs-mechanism / symmetry / reads-cold probes.

The architect lens is *load-bearing* for this pass. A system-design review that does not apply the architect's typology probes to introduced names, prefixes, namespaces, or layer placements is missing what makes this pass different from a generic review. When you encounter a qualifier-style prefix (`Authored*`, `Extension*`, `Internal*`, `Base*`, etc.) in the diff, fire the discriminator-completeness probe before signing off — see the persona's `## Probes` section for the full set.

Write `system-design-review.md` into the artefact directory.

### Minimum coverage

- **What problem is being solved; what new guarantees / invariants are introduced.** Frame in the system-shape sense: what concept is being added, removed, or reshaped at the type / module / namespace level.
- **Subsystem fit** (contracts, plans, runtime, adapters/plugins, capability gating). Whether the new shape lives in the right bounded context with the right dependency direction. Layer purity. Whether existing concepts already cover the new concern under different names.
- **Boundary correctness.** Domain / layer / plane imports. Whether a type that lives in the framework layer actually belongs there or is target-specific. Whether the *meaning* of an import direction is right, not just whether it compiles.
- **Naming and typology integrity.** Apply the architect persona's probes (discriminator-completeness / consumer-vs-essence / concept-vs-mechanism / symmetry / reads-cold) to every introduced name, prefix, namespace, or grouping. Surface typology holes; propose the prefix-free alternative; check whether the same type already exists under another name.
- **ADRs.** If the branch adds or changes ADRs under `docs/architecture docs/adrs/`, treat them as design-intent sources and explicitly review their reasoning and trade-offs through the architect lens (vocabulary fit; conceptual integrity; speculative-extensibility tax).
- **Test strategy adequacy at the architectural level.** What architectural property must be proven, and where. Test naming and structure as evidence of the system's conceptual partitioning.

### Quality bar

- Names the load-bearing typology / naming / boundary decisions the diff introduces, in plain language a reader can re-evaluate.
- Surfaces every qualifier-prefix, consumer-encoding name, and mechanism-named-as-concept the architect persona's probes catch.
- Explicitly distinguishes architect-class concerns (in scope) from buildability / scope / learnability concerns (out of scope; routed to other passes or other personas).
- Reads cleanly as a stand-alone artefact: a reviewer with no other context can re-evaluate the architect-pass conclusions from this file alone.

### Out of scope (route elsewhere)

- **Implementation correctness, failure modes, blast radius, operability, cost.** → § 4 (principal-engineer pass).
- **Adopter learnability, fresh-reader friction, glossary stability.** Devrel lens; out of scope for this skill — surface as a referral.
- **Scope, user value, evidence for the problem.** PM lens; out of scope.
- **Public-surface stewardship, license / provenance, contribution friction.** OSS-specialist lens; out of scope.
- **Composing reviewer outputs, packaging the synthesis for the human.** → § 5 (tech-lead walkthrough) and § 6 (synthesis).

## 4) Code-review pass → `code-review.md`

> **Transition: adopt the `principal-engineer` persona** (see the `drive-agent-personas` skill). The principal-engineer lens is the source of truth for this pass — failure modes first, operability and blast radius, cost-and-complexity earn their keep, constraints vs assumptions, programming practice, evidence-grounded critique, plus the failure-mode / blast-radius / cheapest-alternative / operability / constraint-vs-assumption / already-solved-here probes.

The principal-engineer lens is *load-bearing* for this pass. A code review that does not pressure-test failure modes, blast radius, and operability is missing what makes this pass different from a generic style review. Acceptance-criteria verification (see below) is the load-bearing intent-fidelity check; it is not optional, and the bar for "verify" is strict (read the test assertions, not just map files to ACs).

Before writing, read repo conventions: at minimum `AGENTS.md` plus any relevant `.cursor/rules/**` and package `README.md` touched by the diff.

Write `code-review.md` into the artefact directory.

### Required sections

- **Summary** (1–2 sentences).
- **What looks solid** (positive notes; can appear near the top — the persona's "acknowledge what's good when it matters" principle).
- **Findings** (flat list — everything to address in this PR).
- **Deferred (out of scope)** (issues explicitly not addressed because they expand scope beyond what this PR delivers; must state *why* each is out of scope).
- **Already addressed** (table of findings from prior review rounds that have been fixed; include commit hash when available).
- **Acceptance-criteria verification** (per § Acceptance-criteria verification below).

### Categorisation heuristic

Do **not** use blocking / non-blocking / nits tiers. Agents do implementation — perceived effort is not a useful signal for whether something should be fixed. The only legitimate reason to defer a finding is **scope**: fixing it would pull in work that belongs to a different PR or milestone. If a finding is in scope, it goes in **Findings** and gets addressed. If fixing it would expand scope, it goes in **Deferred** with a clear reason.

Prioritise findings by impact: security > correctness > performance > maintainability > style.

### Finding format

Findings get unique, unambiguous IDs (single global sequence across the file; preferred format `F<NN>` — `F01`, `F02`, …). Each finding includes:

- **Location:** repo-relative path + line range as plain text (not inside a `path:line` markdown link). In Cursor (env vars `CURSOR_AGENT`, `CURSOR_TRACE_ID`, or `CURSOR_CLI` set, or the user says output is for Cursor): use a path-only markdown link `[path](path)` with the range after as plain text (e.g. ` — lines 12–34`). Outside Cursor, you may use `[path (L12–L34)](path:12-34)` if links resolve for the reader.
- **Issue:** concise description of the problem and why it matters.
- **Suggestion:** concrete fix or improvement.
- **Code example** (when helpful).

### Review boundaries

Do not:

- Review formatting-only changes (defer to formatters / linters).
- Nitpick personal preferences that do not affect readability or maintainability.
- Suggest large rewrites when the current approach is acceptable.
- Flag issues in unchanged code unless directly impacted by the change.
- Use absolute filesystem paths in the review.

### Acceptance-criteria verification (required)

If the spec contains acceptance criteria, the code review **must verify each one** against the actual implementation. This is the most important part of the review — it answers "did we build what we said we'd build?"

**What "verify" means.** Pointing to a file is not verification. For each AC:

1. Read the AC literally — what observable behaviour or property does it require?
2. Find the implementation code that is supposed to satisfy it. Read the code — does it do what the AC says?
3. Find the test(s) that prove it. Read the test assertions — do they actually assert the AC's requirement, or do they assert something weaker?
4. Assign a verdict: **PASS** / **FAIL** / **NOT VERIFIED** / **WEAK**.

Verdict definitions:

- **PASS:** the implementation satisfies the AC, and a test exists that asserts the specific behaviour.
- **FAIL:** the implementation does not satisfy the AC. State what is missing or wrong.
- **NOT VERIFIED:** no test or manual evidence exists. State what verification is missing.
- **WEAK:** a test exists but its assertions don't actually prove the AC. State what the test asserts vs what the AC requires.

Common traps to avoid:

- **Mapping, not verifying:** listing a file path next to an AC is not verification.
- **Trusting test names:** a test named "selects TypeScript provider" that only asserts `typeof source === 'function'` does not verify provider selection.
- **Confusing structural with behavioural equivalence:** checking two config objects have the same `.family` reference is not the same as checking they produce identical emit output.
- **Assuming E2E coverage exists:** if an AC requires end-to-end behaviour, check whether an E2E test actually exists.

When ACs describe end-to-end behaviour and no integration / E2E tests exist, flag this explicitly in the verification table, file as a finding (not deferred — missing AC evidence is in scope), and recommend the specific tests that would close the gap.

Output format:

```markdown
| AC | Verdict | Detail |
|---|---|---|
| AC1: <short statement> | **PASS** / **FAIL** / **NOT VERIFIED** / **WEAK** | <what you checked, what you found, why this verdict> |

### Summary

| Result | Count | ACs |
|---|---|---|
| PASS | N | AC2, AC3, ... |
| FAIL | N | AC1, ... |
| NOT VERIFIED | N | AC4, ... |
| WEAK | N | AC8, ... |
```

### Quality bar

- Reads as a principal-engineer-lens review: failure modes / operability / blast radius / cost are surfaced as load-bearing concerns; "should work" / "edge case" / "we can monitor it later" trigger probe responses, not nods.
- Verifies every spec AC against actual code and test assertions; no mapping-without-verification.
- Distinguishes principal-engineer-class concerns (in scope) from architect / scope / learnability concerns (out of scope).
- Stands alone: a reader with no other context can re-evaluate the buildability conclusions and the AC verification from this file alone.

### Out of scope (route elsewhere)

- **Naming, typology, system shape, ubiquitous language, bounded contexts.** → § 3 (architect pass).
- **Adopter learnability of docs and surface.** Devrel lens; out of scope.
- **Scope, user value, evidence for the problem.** PM lens; out of scope.
- **Public-surface stewardship, license / provenance, contribution friction.** OSS-specialist lens; out of scope.
- **Composing reviewer outputs, packaging the synthesis for the human.** → § 5 / § 6.

## 5) Walkthrough pass → `walkthrough.md`

> **Transition: reload the `tech-lead` persona** (see the `drive-agent-personas` skill). The tech-lead lens drives orchestration, surface-conflicts-don't-merge-them, right-altitude-for-audience, keep-the-user-in-the-loop, make-orchestration-legible, plus the persona-conflict / altitude / human-in-the-loop probes.

The tech-lead lens is *load-bearing* for this pass because the walkthrough's audience is a *human operator touring a multi-thousand-LOC PR*. The right altitude balances: enough detail that the reader can follow the substantive moves, not so much detail that the change-set's narrative is lost in token-level diffs. Architect-class concerns (typology / naming) and principal-engineer-class concerns (failure modes / blast radius) surfaced by § 3 / § 4 get *referenced* at the altitude the human needs — not re-adjudicated.

### Mechanic — delegate to `drive-pr-walkthrough`

The mechanical structure of the walkthrough (output template, intent-extraction, behaviour-changes-as-evidence, linking conventions, quality checklist) is owned by the `drive-pr-walkthrough` skill at `.agents/skills/drive-pr-walkthrough/SKILL.md`. Use that skill's `/walkthrough` workflow to produce the file.

When invoking that workflow, **override its output path** so the file lands at `<artefact-directory>/walkthrough.md` rather than the default location.

The tech-lead lens is layered on top of that workflow: as you produce the walkthrough, apply the persona's altitude probe (*"what does THIS reader need to decide, and what altitude of detail enables that decision?"*) at every section to calibrate detail.

### Audience — load-bearing

The walkthrough's audience is a **human operator touring a multi-thousand-LOC PR**. They are reviewing the change set, possibly preparing to merge, possibly preparing to give substantive feedback, possibly preparing to land a follow-up. They are *not* re-doing the architect's typology audit or the principal engineer's failure-mode pressure-test — those are evidence files (`system-design-review.md`, `code-review.md`) the walkthrough may reference but does not duplicate.

Concrete altitude guidance:

- **Behaviour changes get plain-English explanations**, with *what changed* and *why it changed* surfaced at the conceptual level. The reader should be able to articulate the change to a third party after reading.
- **Implementation touchpoints get linked, not narrated.** Link to the file + line range; let the reader open the file when they want the line-level view.
- **Tests are evidence**, not narrative. Link the tests that prove the behaviour; do not write a parallel test-narrative.
- **Cross-pollination from § 3 / § 4** is *referenced* at the right altitude. The walkthrough may say "the architect pass surfaces a typology concern with `Authored*` (see `system-design-review.md` for the full reasoning)" — it does not re-adjudicate.
- **Substantive conflicts surfaced by § 3 / § 4** stay surfaced (the persona's *surface-conflicts-don't-merge-them* rule applies). If the architect pass and the principal-engineer pass land on different verdicts about a single area of the change, the walkthrough names that disagreement and points the human at both files for the substantive evaluation.

### Quality bar

- Reads as a *narrative*, not a file-by-file changelog or a process recap.
- Uses the right altitude throughout: enough substance for the reader to evaluate, no more.
- References § 3 / § 4 where their conclusions are load-bearing for the human's evaluation; does not duplicate their content.
- Surfaces any cross-lens conflicts (architect vs principal-engineer) as decisions for the human, not as resolved positions.
- Stands as the *primary review surface* for a single round — a reader who reads only this file (and clicks through links) gets a coherent view of what changed and why.

## 6) Synthesis

After all three artefacts exist (still under the `tech-lead` persona):

- Verify all three artefacts exist side-by-side in the artefact directory.
- Surface to the user any cross-lens conflicts the passes raised — the architect pass's verdict on a typology question and the principal-engineer pass's verdict on its operability implications can land in different places. **Do not adjudicate**; surface the conflict at the right altitude (per the tech-lead's *persona-conflict probe*) and point the human at both substantive artefacts.
- Output a short pointer to the artefact directory in chat (per `drive-pr-walkthrough`'s convention: short confirmation, not the full content).

## Future-extensibility

As v2+ personas are admitted (security, QA, etc.), additional passes slot in at the appropriate position — a security pass (security persona) before § 4 when threat-modelling matters; a test-coverage pass (QA persona) after § 4 when the QA frame is load-bearing; etc. Add a new numbered section with its own explicit persona-load instruction, mirroring the pattern of § 3 / § 4 / § 5. The orchestrator persona stays `tech-lead`; synthesis stays § 6.
