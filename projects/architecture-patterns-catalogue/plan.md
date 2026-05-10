# Project Plan

## Summary

This project is **doc-only** — no production code is modified. The work is small enough that a stub plan suffices; the implementer may run [`drive-create-plan`](../../.claude/skills/drive-create-plan/SKILL.md) if a richer milestoning is desired.

**Spec:** [`projects/architecture-patterns-catalogue/spec.md`](./spec.md). The spec is self-contained — every claim is grounded in concrete file paths and ADRs. Read it cover-to-cover before starting; it is the source of truth.

## Context for the implementer

You are picking up a project with **no prior conversation context**. The spec is written assuming you have not read any prior transcript. If something in the spec does not match what you find on disk, prefer the codebase and surface the discrepancy.

## Validation gates

The full validation-gate definition lives in [`projects/architecture-patterns-catalogue/reviews/code-review.md`](./reviews/code-review.md) § Validation gates (orchestrator-maintained, project-wide gates with per-milestone refinements). Confirmed with the user at orchestration setup. Summary:

- Markdown link check across the catalogue + touched files (covers AC7 / NFR2).
- Doc-only diff check (covers AC8) — only `docs/`, `projects/`, `.agents/skills/drive-agent-personas/personas/architect.md`, and `.cursor/rules/adr-writing.mdc` may change.
- Template-conformance check on every v1 entry (covers AC2).
- `pnpm lint:deps` sanity (no code paths touched).
- Markdown line-wrap rule per [`markdown-no-artificial-line-wraps`](../../.claude/skills/markdown-no-artificial-line-wraps/SKILL.md).

## Recommended milestones

The implementer may follow these or refine them via `drive-create-plan`. Each milestone produces commits the team can review independently (small, intent-driven slices — the `commit-as-you-go` user rule).

### M1 — Scaffold

- [ ] Create `docs/architecture docs/patterns/`.
- [ ] Write `docs/architecture docs/patterns/_template.md` from § "Pattern doc template" in the spec.
- [ ] Write `docs/architecture docs/patterns/README.md` (catalogue index): include the v1 entry table (status: Pending until each entry is written), the "How to add a new pattern" section, and forward links to `ADR-INDEX.md`, `Package-Layering.md`, `docs/reference/`.
- [ ] Open the first PR with M1's deliverables for early review of the template + index shape.

### M2 — v1 pattern entries

Write the eight v1 entries listed in the spec. Recommended order: write _Frozen-class AST + visitor_ first (richest reference implementations, lowest ambiguity); use it as a calibration entry for depth + voice. After it lands, batch the remaining seven.

- [ ] `frozen-class-ast.md`
- [ ] `json-canonical-class-in-memory.md`
- [ ] `three-layer-polymorphic-ir.md` (status: Emerging — see spec Open Question 2)
- [ ] `spi-at-lowest-consuming-layer.md`
- [ ] `interface-plus-factory.md` (also: condense [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" to a stub linking here — FR11; **append `docs/reference/typescript-patterns.md` to `EXTRA_TARGETS` in [`scripts/check-catalogue-links.mjs`](../../scripts/check-catalogue-links.mjs)** so the link-check gate covers it).
- [ ] `adapter-spi.md`
- [ ] `capability-gating.md`
- [ ] `package-layering.md` (short — points at `Package-Layering.md`. Note: cite the actual layering linter scripts (`scripts/lint-framework-target-imports.mjs`, `scripts/lint-app-space-id.mjs`) rather than the stale `scripts/check-imports.mjs` reference in the spec — see [`wip/unattended-decisions.md`](../../wip/unattended-decisions.md) § Decision 2).

**For each entry**, the implementer must do all of the following before moving on:

1. Write the file under `docs/architecture docs/patterns/<slug>.md` from `_template.md`.
2. **In [`docs/architecture docs/patterns/README.md`](../../docs/architecture%20docs/patterns/README.md):** flip the row's slug from a code span to a markdown link to the new file, and flip the Status column from `Pending` to `Stable` (or `Emerging` for `three-layer-polymorphic-ir.md`).
3. Run `node scripts/check-catalogue-links.mjs` and confirm exit 0 before committing.

### M3 — Architect persona + close-out

- [ ] Update [`.agents/skills/drive-agent-personas/personas/architect.md`](../../.agents/skills/drive-agent-personas/personas/architect.md) with the "Patterns to know" section (FR10).
- [ ] Update [`.cursor/rules/adr-writing.mdc`](../../.cursor/rules/adr-writing.mdc) so new ADRs that instantiate a catalogue pattern link forward to it (Spec Open Question 3 — confirmed in scope by the user during orchestration setup; the spec's default-assumption applies). Flag if the rule's existing wording resists the addition cleanly.
- [ ] **Append both new files to `EXTRA_TARGETS` in [`scripts/check-catalogue-links.mjs`](../../scripts/check-catalogue-links.mjs)** (`.agents/skills/drive-agent-personas/personas/architect.md`, `.cursor/rules/adr-writing.mdc`) so the link-check gate covers them.
- [ ] Verify all links in the catalogue resolve (NFR2).
- [ ] Self-check AC9 (a fresh contributor can articulate any v1 entry's intent and find a reference implementation in five minutes).
- [ ] Confirm AC1–AC8.

## Close-out (required)

Per [`drive-project-workflow`](../../.cursor/rules/drive-project-workflow.mdc), the project's directory under `projects/` is transient and removed at close-out.

- [ ] Confirm all acceptance criteria in [`projects/architecture-patterns-catalogue/spec.md`](./spec.md) pass.
- [ ] No long-lived docs to migrate — the work product _is_ `docs/architecture docs/patterns/`, which is already the canonical location.
- [ ] Strip repo-wide references to `projects/architecture-patterns-catalogue/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/architecture-patterns-catalogue/`.
