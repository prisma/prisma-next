# 08 — Extract E2E, Examples, and Internal Packages from `packages/`

Status: Complete

Owner: Architecture

Sequencing: after 06a (Framework Domain Relocation), before Slice 06 completes fully (to avoid double-churn).

## Summary

Move all non-source and unpublished tooling (end-to-end suites, example apps, internal helpers) out of `packages/` into dedicated top-level folders that are not workspaces:

- `packages/**` contains only shippable source packages (publishable or intended-to-be-published)
- `test/**` contains end-to-end, integration, and utility code that consumes `packages/**` via public APIs but is not part of the workspace
- `examples/**` contains consumer-facing example apps (still workspace entries so they can be run via pnpm scripts)
- `internal/**` contains internal dev tools, scaffolds, generators, benches that are not part of the workspace graph

This aligns the filesystem with our Domains → Layers → Planes model, strengthens guardrails, and improves CI and publishing hygiene.

## Goals

- Sharpen the mental model: “Everything under `packages/` is source.”
- Prevent accidental imports from tests/examples into source via enforced rules.
- Make agent-driven and consumer-driven validation use only public APIs.
- Simplify publishing and CI by isolating publishable units.

## Non-Goals

- No public API changes to source packages.
- No test de-scoping; existing test coverage should be preserved or improved during the test transition.

## Target Filesystem Layout

```
packages/
  framework/**              # runtime-core, core-*, authoring/*, tooling/*
  sql/**                    # lanes, runtime, adapters, targets/sql/*, relational-core
  extensions/**             # true extension packs (e.g., ext-pgvector)

test/
  e2e/
    framework/**            # TS/PSL parity, planner/apply (dry-run), SPI smoke
    sql/**                  # DML/DDL flows against Postgres, adapters/codecs, packs
    extensions/**           # pack registration + runtime/migration effects
  integration/**             # compatibility demos, agent workflows, cross-target scenarios
  utils/                    # fixtures, helpers consumed by e2e/integration suites

examples/
  prisma-next-demo/**       # consumer-facing app(s)

internal/
  dev-scripts/**            # scaffolds, generators, benches; not part of workspace or publish graph

scripts/
  check-imports.mjs         # or successor enforcing architecture.config.json

config/
  architecture.config.json  # source of truth for domain/layer/plane guardrails
```

## Guardrails (Enforcement)

- `packages/**` MUST NOT import from `test/**`, `examples/**`, or `internal/**`.
- `test/**` may only import public entry points of packages under `packages/**` (simulate consumers); the directories are not workspaces and do not publish.
- `examples/**` may only import public entry points of packages under `packages/**`.
- `internal/**` is not a workspace and may depend on anything, but MUST NOT be imported by `packages/**`.
- Migration plane code cannot import runtime plane code; use `architecture.config.json` rules to encode domains/layers/planes.

Implementation notes:
- Treat `architecture.config.json` as the source of truth; ensure `scripts/check-imports.mjs` (or its successor) reads it.
- Add explicit denylist rules: paths starting with `test/`, `examples/`, `internal/` are import-invalid from `packages/**`.
- Keep existing domain/layer import rules intact.

## Workspace and Tooling Updates

- `pnpm-workspace.yaml` globs:
  - Include `packages/**`, `extensions/**`, `examples/**`
  - `test/**` and `internal/**` are not workspaces; run their scripts via root tooling instead
`tsconfig.base.json` and per-package `tsconfig.json`:
  - Remove path aliases to any moved packages from `packages/`
  - Add path aliases only if necessary for `test/**` builds (prefer using published-style entry points)
- `turbo.json`:
  - Separate pipelines for unit (`packages/**`) vs test suites (`test/**`) to reduce noise
  - Optionally run test suites only when affected domain changes
- Pre-publish validation:
  - CI step asserting “publishable workspaces live only under `packages/**`”

## Migration Steps

1) Inventory non-source workspaces currently under `packages/` (test fixtures, benches, scaffolds, ad-hoc examples)
2) Create new top-level folders: `test/`, `examples/`, `internal/`
3) Move suites/helpers accordingly and retire their `package.json`
4) Update `pnpm-workspace.yaml` globs and `turbo.json` pipelines
5) Update `architecture.config.json` to encode import rules (above)
6) Update `scripts/check-imports.mjs` to consume `architecture.config.json` and enforce:
   - No imports from `test/**`, `examples/**`, `internal/**` into `packages/**`
   - Test suites/examples import only public entry points
7) Fix any path references, tsconfig path aliases, and CI tasks
8) Update docs and READMEs referencing the new locations

## Risks and Mitigations

- “Orphaned” internal helpers used by source packages
  - Mitigation: promote shared code required by source into a proper `packages/**` workspace
- E2E tests relying on deep imports
  - Mitigation: fix to public entry points; this is intentional pressure to keep API stable and documented
- CI build time increase due to new workspaces
  - Mitigation: pipeline separation and domain-scoped affected graphs in Turbo

## Acceptance Criteria

- All non-source suites live outside `packages/` (in `test/**`, `examples/**`, or `internal/**`)
- Repo builds; unit tests pass; test pipelines run separately
- Guardrails enforce:
  - No imports from test/examples/internal into packages
  - Migration ↛ runtime import violations are blocked
- Publishing checks only consider `packages/**`
- Docs (architecture + briefs) reflect the new structure

## Follow-ups

- Add a minimal e2e harness per domain:
  - Framework: TS vs PSL canonicalization parity; planner dry-run; runtime-core SPI smoke
  - SQL: DML/DDL end-to-end via Postgres (docker), adapters/codecs, extension pack flow (PGVector)
  - Extensions: pack registration + lane exposure + migration hooks
