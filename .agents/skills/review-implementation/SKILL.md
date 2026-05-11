---
name: review-implementation
description: Atomic sub-skill — produces a `code-review.md` for a PR/branch by reading changes through the principal-engineer lens (failure modes, blast radius, operability, cost, programming practice, evidence-grounded critique) plus AC verification. Adopts the `principal-engineer` persona. Use directly when the user wants only the code review, or via the composite `drive-pr-local-review` when they want the full review set.
disable-model-invocation: true
---

# Review: Implementation

Produce a `code-review.md` for the established review scope (branch + base), grounded in the canonical or inferred review spec. Includes acceptance-criteria verification.

This skill is **atomic** per `drive-agent-personas/SKILL.md § Composite skills § Shape A`. It produces one artefact (`code-review.md`) under one persona (`principal-engineer`). It is invoked directly when the user wants only the code review, or via the composite `drive-pr-local-review` when they want the full review set side-by-side.

## Persona

> **Adopt the `principal-engineer` persona** (see the `drive-agent-personas` skill). The principal-engineer persona is the source of truth for the lens — failure modes first, operability and blast radius, cost-and-complexity earn their keep, constraints vs assumptions, programming practice, evidence-grounded critique, plus the failure-mode / blast-radius / cheapest-alternative / operability / constraint-vs-assumption / already-solved-here probes.

The principal-engineer lens is *load-bearing* for this skill. A code review that does not pressure-test failure modes, blast radius, and operability is missing what makes this skill different from a generic style review. Acceptance-criteria verification (see § Output) is the load-bearing intent-fidelity check; it is not optional, and the bar for "verify" is strict (read the test assertions, not just map files to ACs).

## Inputs

The composite caller (`drive-pr-local-review`) hands this skill:

- **Review scope:** the resolved branch + base + commit range.
- **Review spec:** the in-repo canonical spec, or the inferred review `spec.md` written by the composite.
- **Artefact directory:** the absolute path where `code-review.md` should be written.
- **Repo conventions to read:** at minimum `AGENTS.md` plus any relevant `.cursor/rules/**` and package `README.md` touched by the diff. Established in advance by the composite or by this skill on direct invocation.

When invoked directly (not via the composite), establish the same inputs yourself per the scope-and-spec rules in `drive-pr-local-review/SKILL.md § 1) Establish the review scope` and `§ 2) Establish expectations`.

## Output

Write `code-review.md` into the artefact directory.

### Required sections

`code-review.md` must include at minimum (additional sections are fine):

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

A code-review.md that passes the bar:

- Reads as a principal-engineer-lens review: failure modes / operability / blast radius / cost are surfaced as load-bearing concerns; "should work" / "edge case" / "we can monitor it later" trigger probe responses, not nods.
- Verifies every spec AC against actual code and test assertions; no mapping-without-verification.
- Distinguishes principal-engineer-class concerns (in scope) from architect / scope / learnability concerns (out of scope; routed elsewhere via the composite).
- Stands alone: a reader with no other context can re-evaluate the buildability conclusions and the AC verification from this file alone.

## Out of scope (route elsewhere)

- **Naming, typology, system shape, ubiquitous language, bounded contexts.** Architect persona's lens — composite delegates to `review-system-design`.
- **Adopter learnability of docs and surface.** Devrel persona's lens.
- **Scope, user value, evidence for the problem.** PM persona's lens.
- **Public-surface stewardship, license / provenance, contribution friction.** OSS-specialist persona's lens.
- **Composing reviewer outputs, packaging the synthesis for the human.** Tech-lead persona's lens — composite delegates to `review-walkthrough`.

## Workflow

1. Adopt the principal-engineer persona (see § Persona).
2. Read inputs (review scope, spec, artefact directory, repo conventions) — establish them yourself if invoked directly.
3. Read the diff with the principal-engineer lens loaded; pressure-test against the persona's six probes.
4. Read changed files in full when the diff alone is insufficient to assess correctness, intent, or invariants.
5. Verify every AC against actual implementation code and test assertions per § Acceptance-criteria verification.
6. Write `code-review.md` per the required-sections list; structure as the reviewer judges best within the format constraints.
7. Surface any concern that crosses into another lens's scope as a referral (e.g. *"this rename has architect-class typology implications — surface to architect lens for the system-design pass"*).
