# 09 — Relocate Adapters, Drivers, Contract, and Compat Packages

Status: Proposed

Owner: Architecture

Sequencing: after 07 (legacy cleanup), alongside 06a (Framework Relocation) to finish path alignment.

## Summary

Relocate remaining mis-scoped packages to their proper domain/layer folders and finalize the deprecation of `sql-target`.

In scope packages:
- `adapter-postgres` → SQL domain, runtime plane, adapters layer
- `driver-postgres` → SQL domain, runtime plane, drivers (internal) layer
- `contract` → Framework domain, core layer
- `sql-target` → remove/deprecate (already replaced by targets/sql/{contract-types,operations,emitter})
- `compat-prisma` → Compat as an Extension (or Internal) — choose intent and place accordingly

## Goals

- Make filesystem mirror the Domains → Layers → Planes model.
- Eliminate legacy `sql-target` usage and tests.
- Ensure import guardrails can be enforced mechanically.
- Keep published package names stable; only move filesystem paths.

## Target Filesystem Layout

```
packages/
  framework/
    core-contract/            # moved from packages/contract
    # ... other framework packages

  sql/
    runtime/
      adapters/
        postgres/             # moved from packages/adapter-postgres
      drivers/
        postgres/             # moved from packages/driver-postgres (private/internal)
    # ... lanes, relational-core, targets/sql/*, etc.

  extensions/
    compat-prisma/            # if supported as a public extension pack

internal/
  compat-prisma/              # alternative if intended only for internal use (private)
```

Naming note: published names can remain (`@prisma-next/adapter-postgres`, `@prisma-next/driver-postgres`, `@prisma-next/contract`, etc.). Only the filesystem location changes.

## Package Mapping and Actions

1) `packages/adapter-postgres`
   - Move to: `packages/sql/runtime/adapters/postgres`
   - Keep name: `@prisma-next/adapter-postgres`
   - Update imports in `sql-runtime` and tests to new path

2) `packages/driver-postgres`
   - Move to: `packages/sql/runtime/drivers/postgres`
   - Set `private: true` unless explicitly published; treat as adapter implementation detail
   - Update adapter to import driver via relative workspace path

3) `packages/contract`
   - Move to: `packages/framework/core-contract`
   - Keep name: `@prisma-next/contract`
   - Update internal imports and path aliases accordingly

4) `packages/sql-target`
   - State: legacy, replaced by `packages/targets/sql/{contract-types,operations,emitter}`
   - Action: remove package; optionally leave a stub `README.md` that points to the new locations
   - If transitional re-exports exist, delete them; update tests to use new targets packages

5) `compat-prisma`
   - Two options (choose one):
     a) Public extension pack → `packages/extensions/compat-prisma` (publish)
     b) Internal shim/examples-only → `internal/compat-prisma` (private)
   - Update docs to clarify support level and import boundaries

## Guardrails and Config Updates

- `architecture.config.json`:
  - Encode new paths and domain/layer/plane for moved packages
  - Ensure runtime plane does not import migration plane packages
  - Mark `drivers/*` as internal; forbid imports from outside adapters/runtime

- `scripts/check-imports.mjs`:
  - Consume `architecture.config.json`
  - Add deny rules for `internal/**` and enforce public entry-point usage

- `pnpm-workspace.yaml`:
  - Update globs to include new paths; ensure internal drivers or compat (if internal) are `private: true`

- `tsconfig.base.json` and per-package `tsconfig.json`:
  - Update path aliases to match new locations

- `turbo.json`:
  - Keep unit vs e2e pipelines separated; update affected graphs to point to new workspaces

## Migration Steps

1) Move `packages/contract` → `packages/framework/core-contract` (no API changes)
2) Move `packages/adapter-postgres` → `packages/sql/runtime/adapters/postgres`
3) Move `packages/driver-postgres` → `packages/sql/runtime/drivers/postgres` (set `private: true`)
4) Delete `packages/sql-target` and migrate any remaining tests to targets/sql/*
5) Relocate `compat-prisma` to `packages/extensions/compat-prisma` (or `internal/compat-prisma`) per decision
6) Update workspace globs, tsconfig paths, and turbo pipelines
7) Update guardrails (`architecture.config.json`, `scripts/check-imports.mjs`)
8) Fix imports across repo; run unit and e2e (if any) to verify
9) Update docs and READMEs to reference new paths

## Acceptance Criteria

- All five packages reside in their correct domain/layer folders
- Repo builds green; unit tests pass; integration/e2e updated
- `sql-target` fully removed; no imports remain
- Guardrails enforce domain/layer/plane boundaries and internal driver visibility
- Published package names unchanged; consumers unaffected

## Risks and Mitigations

- Hidden path imports to old locations
  - Mitigation: `rg` sweep + TypeScript path resolution errors; CI import-check enforcement
- Driver visibility leaks into consumers
  - Mitigation: mark driver package `private: true`; adapters re-export minimal driver types if needed
- Transitive circular deps introduced by moves
  - Mitigation: run import-checker; validate with `turbo run build --filter=...` on affected graph

## Notes

- This brief complements 06a by finishing framework domain relocation and ensures the SQL runtime/adapters axis is cleanly laid out for upcoming extension packs and additional targets (e.g., MySQL).

