# Agent‑Accessible Docs — Refactor and Governance — Project Brief

## Scope

Clean up and harden agent‑accessible documentation and Cursor rules to reduce ambiguity, drift, and noise for human developers and AI agents (Cursor/Windsurf/etc.). Deliver a concise entrypoint for agents, normalized rulecards, scoped applicability, and lightweight governance to keep docs healthy.

Out of scope: rewriting the architecture itself, changing package structure, or adding new product features.

## Goals

- Single, concise agent entrypoint (AGENTS.md) with curated links and golden rules.
- Normalize `.cursor/rules/*` into short, atomic, scoped rulecards with consistent frontmatter.
- Reduce duplication by linking detailed guidance to `docs/` and package READMEs.
- Improve discoverability (indexed rules, common commands/plans) and reduce irrelevant rule injections.
- Establish ownership and a simple validation check to prevent doc rot.

## References

- Root onboarding: `AGENT_ONBOARDING.md`
- Rules: `.cursor/rules/*`, `.cursorrules`
- Architecture: `docs/Architecture Overview.md`, `architecture.config.json`
- Testing: `docs/Testing Guide.md`

## Deliverables

1) Agent entrypoint
- `AGENTS.md` (root): 1–2 pages with Start‑Here links, golden rules, common commands, boundaries/safety rails.

2) Rules index and curation
- `.cursor/rules/README.md`: Index grouped by tags with a curated “Always Apply” list.
- Shrink “alwaysApply” set to essentials only: `use-correct-tools`, `no-target-branches`, `omit-should-in-tests`, `doc-maintenance`.

3) Rule normalization and scoping
- All rules use standard frontmatter and compact rulecards that link out to long‑form docs.
- Every rule has scope (`appliesTo` globs) and ownership (`owner`, `lastUpdated`).
- Remove duplication with `docs/` by converting tutorial‑like rules into pointers with minimal Do/Don’t examples.

4) Developer workflow helpers
- `.cursor/commands/*`: 5–7 common commands (build, test, coverage, lint imports, demo).
- `.cursor/plans/*`: plan templates for frequent tasks (e.g., add SQL op, split monolith, fix import violation).

5) Maintenance and governance
- CI task to validate rule frontmatter and discourage excessive `alwaysApply`.
- Ensure each package README meets expectations outlined in `doc-maintenance` rule.

## Rule Frontmatter (standard)

```yaml
---
description: Short sentence (<=120 chars)
alwaysApply: false # only for 3–5 curated rules
tags: [testing|imports|sql|types|architecture|tooling]
appliesTo: ["**/*"] # or scoped e.g., ["packages/sql/**"]
owner: team-xyz # or @handle
lastUpdated: 2025-11-10
severity: info|warn|error
---
```

## Implementation Plan

Phase 0 — Quick Wins (0.5 day)
- Add `AGENTS.md` (TL;DR with curated links and golden rules).
- Add `.cursor/rules/README.md` with index and “Always Apply” curation.
- Migrate `.cursorrules` content into `.cursor/rules/testing-language.mdc` and remove `.cursorrules`.
- Add `.cursor/commands/` with 5–7 common commands.

Phase 1 — Refactor (1–2 days)
- Normalize frontmatter for all `.cursor/rules/*` using the standard schema.
- Scope rules via `appliesTo` globs; convert long narrative to “rulecards” with Do/Don’t and examples; link to `docs/`.
- Split `AGENT_ONBOARDING.md` into modular sections and make it a deep‑dive, keeping `AGENTS.md` as the concise entrypoint.

Phase 2 — Governance (0.5–1 day)
- Add CI task to validate rule frontmatter; flag rules missing `owner`/`lastUpdated` or with `alwaysApply: true` not on the curated list.
- Ensure each package has a README with responsibilities, dependencies, layering position, mermaid diagram (optional), and links to relevant briefs/ADRs.
- Document a weekly “rules drift” check in team ops (optional automation later).

## Work Items (Detailed Checklist)

Entrypoint
- [ ] Create `AGENTS.md` with:
  - [ ] Start‑Here (top 5 links): Architecture Overview, MVP Spec, Testing Guide, Rules Index, Repo Map.
  - [ ] Golden Rules (5–8 bullets with links to rulecards).
  - [ ] Common commands (build, test, coverage, lint imports, demo).
  - [ ] Safety rails and “ask first” boundaries.

Rules Index
- [ ] Add `.cursor/rules/README.md` grouping by `tags` and listing the curated `alwaysApply` rules.

Normalize Rules
- [ ] Add/standardize frontmatter on all `.cursor/rules/*`.
- [ ] Ensure each rule has: description, tags, appliesTo, owner, lastUpdated, severity.
- [ ] Convert tutorial‑length rules into compact rulecards with Do/Don’t and examples.
- [ ] Move deep guidance into `docs/` and link from rulecards.
- [ ] Scope examples:
  - [ ] SQL‑specific: `appliesTo: ["packages/sql/**"]`
  - [ ] Testing conventions: `appliesTo: ["**/*.test.ts"]` (or global if preferred)
- [ ] Reduce `alwaysApply` flags to the curated set; move others to normal rules.

Commands & Plans
- [ ] Add `.cursor/commands` entries:
  - [ ] `build`: `pnpm build`
  - [ ] `test:packages`: `pnpm test:packages`
  - [ ] `coverage:packages`: `pnpm coverage:packages`
  - [ ] `lint:deps`: `pnpm lint:deps`
  - [ ] `demo`: `cd examples/todo-app && pnpm demo`
- [ ] Add `.cursor/plans` templates:
  - [ ] Add new SQL operation
  - [ ] Split monolith into modules
  - [ ] Fix import violation
  - [ ] Implement includeMany in ORM

Onboarding Split
- [ ] Refactor `AGENT_ONBOARDING.md` into modules (Getting Started, Repo Map & Layering, Conventions, Testing pointers, Common Tasks Playbook) with links.
- [ ] Keep `AGENTS.md` as the short entrypoint and avoid duplication.

Governance
- [ ] CI step to validate rules’ frontmatter and curated `alwaysApply` list.
- [ ] Verify package README presence and minimum content per `doc-maintenance` rule.
- [ ] Add owners for rules and READMEs; record in frontmatter.

## Ownership

- Docs/Rules owner: assign a primary (e.g., `@owner-handle`) and a backup.
- Each rulecard `owner` should be the team or person most familiar with the area (e.g., sql patterns → SQL lane maintainer).

## Risks & Mitigations

- Risk: Over‑scoping rules reduces helpful guidance.
  - Mitigation: Keep global “Always Apply” small but strong; add clear links to deep docs.
- Risk: Drift between rulecards and `docs/` returns.
  - Mitigation: CI frontmatter checks; weekly drift review; rulecards stay minimal and link to canonical docs.
- Risk: Agent noise from too many rules.
  - Mitigation: Scope with `appliesTo`; reduce `alwaysApply`; collapse tutorials into links.

## Acceptance Criteria

- `AGENTS.md` exists with curated links, golden rules, and commands.
- `.cursor/rules/README.md` lists all rules by tag and highlights the curated `alwaysApply` set (4–5 items max).
- All `.cursor/rules/*` have valid frontmatter and an `owner` and `lastUpdated`.
- Tutorial‑length rules are reduced to compact rulecards with Do/Don’t examples and “Read more” links to `docs/`.
- `.cursorrules` removed; content migrated into a normalized rulecard.
- `.cursor/commands` contains at least 5 commands; `.cursor/plans` contains at least 3 templates.
- CI validates rule frontmatter and curated `alwaysApply` list.
- Every package has a README meeting the minimum content described in `doc-maintenance`.

## Milestones & Timeline

- Phase 0 (Day 1): `AGENTS.md`, rules index, migrate `.cursorrules`, add commands.
- Phase 1 (Days 2–3): Normalize/scoped rules; split onboarding; reduce duplication.
- Phase 2 (Day 4): CI checks; README audit and fixes.

## Notes for Implementers

- Use small PRs by phase; include owners in reviews.
- Prefer links to canonical docs over repeating content in rules.
- Keep `alwaysApply` minimal; default to scoped rules with `appliesTo`.

