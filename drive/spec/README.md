# drive/spec — project-context for spec authoring

Loaded by `drive-specify-project` and `drive-specify-slice`. Holds prisma-next's spec-authoring conventions, required sections, and common-scope-trap catalogue.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`docs/drive/trial.md`](../../docs/drive/trial.md).

## Required sections (beyond template)

In addition to the canonical project-spec / slice-spec templates, this repo expects:

- **Contract-impact section** for any spec that touches the contract surface (`packages/0-shared/contract/**`, `packages/1-framework-core/**`). Names the contract entities affected, the new / changed kinds, the migration plan for downstream consumers.
- **Adapter-impact section** for any spec that affects target adapters (`packages/3-targets/**`). Names which adapters are affected (postgres / sqlite / mongo / etc.).
- **ADR pointer** for any architectural shift. Either link an existing ADR or commit to authoring one as part of the project's close-out.

## Common-scope traps

Patterns that have produced scope creep in the past:

- _"Add capability X to <one target>"_ that turns out to need contract-level work first. → Triage as project, not slice.
- _"Fix bug in operation Y"_ where Y is parametric over targets. → Watch for "fix on postgres" silently leaking to "fix on all targets" mid-implementation.
- _"Rename concept Z"_ → Almost always project (rename spans every layer + tests + fixtures + docs).

## Edge-case patterns (Example-Mapping)

Common edge cases prisma-next slices should consider:

- **Empty inputs** (empty arrays, empty objects, empty strings) in operation arguments — codecs vs runtime behaviour.
- **Unicode / large strings** in identifiers, JSON columns, BSON keys.
- **Null vs undefined** distinction in TypeScript-vs-database mapping.
- **Migration ordering** when contract changes affect existing fixtures — regenerate-fixtures should be in the slice plan.
- **Capability gating** — if a feature requires a capability, gating-error tests are part of the slice-DoD.

_(Add patterns as the team accrues experience.)_

## Slice-DoR overlay

In addition to the canonical slice DoR:

- [ ] Linear issue created and linked from slice spec (issue description carries a link back to `projects/<x>/slices/<s>/`).
- [ ] Slice's PR-to-be will carry a `Refs: <issue-id>` line (or the ticket ID in the title).
- [ ] Slice's parent branch is the project's working branch (or `main` for orphan slices).

(The "calibration entries referenced from slice plan" items live in `drive/plan/README.md` — slice plan owns them.)

## Slice-DoD overlay (spec-side items)

- If the slice touches `packages/3-*-extensions/**`, the slice plan must include a `pnpm fixtures:check` dispatch step.
- If the slice touches package boundaries / imports, the slice plan must include `pnpm lint:deps`.
- If the slice changes typed surfaces consumed elsewhere, the slice plan must include a downstream `pnpm typecheck` after the producing package's `pnpm build`.

(PR-side slice-DoD items — title prefix, ticket linkage, walkthrough — live in `drive/pr/README.md`. Manual-QA slice-DoD items live in `drive/qa/README.md`.)

_(Populated by retros; treat as living.)_
