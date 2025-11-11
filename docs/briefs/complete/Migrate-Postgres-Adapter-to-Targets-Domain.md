# Project Brief — Migrate Postgres Adapter to Targets Domain

Goal: Relocate the Postgres adapter out of the SQL family domain and into the Targets (Extensions) domain while keeping a single package with clean plane boundaries and tree‑shakable entrypoints.

## Context

- The SQL family under `packages/sql/**` is target‑agnostic. Concrete adapters (e.g., Postgres) are target‑specific and belong in the Targets/Extensions domain.
- The current adapter package lives at `packages/sql/runtime/adapters/postgres/**` (SQL domain, runtime plane). Its `/cli` entrypoint imports migration‑plane code (CLI and SQL tooling), causing plane violations.
- We want a single adapter package that can be consumed by both planes: CLI (migration) and runtime — without cross‑plane imports.

## Problem Statement

- Runtime → Migration imports are forbidden by plane rules. Having a `/cli` entrypoint inside a runtime‑plane package forces an illegal edge.
- Hosting a target‑specific adapter under the SQL family violates domain boundaries (“family is target‑agnostic”).

## Goals

- Keep a single installable package for the Postgres adapter with two entrypoints:
  - `./cli` (migration plane): IR descriptor(s) for the CLI; safe for tooling.
  - `./runtime` (runtime plane): runtime wiring/factory for DB‑connected execution.
- Move the adapter package to the Targets (Extensions) domain, preserving package name and import paths as much as possible.
- Ensure the adapter core (codecs, lowering, SPI impl) is consumable from both planes without cross‑plane imports.
- Keep `pnpm lint:deps` green; remove the need for plane exceptions.

## Non‑Goals

- Changing adapter public API semantics.
- Implementing new runtime wiring (beyond relocating and separating entrypoints).
- Changing CLI descriptor shapes or SQL tooling APIs.

## Design Overview

Single package with multi‑plane entrypoints using path‑based grouping in `architecture.config.json`.

- Package location: `packages/targets/postgres-adapter/**` (Extensions domain, Adapters layer).
- Internal layout:
  - `src/core/**` — shared plane: adapter SPI implementation (lowering, codecs, profiles). Only depends on shared‑plane packages like `@prisma-next/sql-relational-core` and `@prisma-next/operations` types.
  - `src/exports/cli.ts` — migration plane: exports AdapterDescriptor (IR) and validates pack manifest; can import `@prisma-next/cli/config-types` and SQL tooling.
  - `src/exports/runtime.ts` — runtime plane: exports runtime factory/bindings; must not import migration plane code.

Map subpaths to planes with multiple globs for the same package:

- `packages/targets/postgres-adapter/src/core/**` → domain: `extensions`, layer: `adapters`, plane: `shared`
- `packages/targets/postgres-adapter/src/exports/cli.ts` (or folder) → plane: `migration`
- `packages/targets/postgres-adapter/src/exports/runtime.ts` (or folder) → plane: `runtime`

This allows the CLI to import only the migration entrypoint, the runtime to import only the runtime entrypoint, and both to share the core safely.

## Files and Packaging

- Move from: `packages/sql/runtime/adapters/postgres/**`
- To: `packages/targets/postgres-adapter/**`

Suggested structure:

```
packages/targets/postgres-adapter/
  package.json
  src/
    core/
      adapter.ts
      codecs.ts
      types.ts
    exports/
      cli.ts        # AdapterDescriptor (migration plane)
      runtime.ts    # Runtime factory/bindings (runtime plane)
      adapter.ts    # Re-exports from core for convenience
  packs/
    manifest.json   # Adapter manifest used by CLI descriptor
```

`package.json` exports (example):

```
{
  "name": "@prisma-next/adapter-postgres",
  "exports": {
    "./adapter": {
      "types": "./dist/exports/adapter.d.ts",
      "import": "./dist/exports/adapter.js"
    },
    "./cli": {
      "types": "./dist/exports/cli.d.ts",
      "import": "./dist/exports/cli.js"
    },
    "./runtime": {
      "types": "./dist/exports/runtime.d.ts",
      "import": "./dist/exports/runtime.js"
    }
  }
}
```

## architecture.config.json Updates

- Remove: `packages/sql/runtime/adapters/postgres/**` (SQL domain).
- Add three globs for the new package:

```
{
  "glob": "packages/targets/postgres-adapter/src/core/**",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/targets/postgres-adapter/src/exports/cli.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "migration"
},
{
  "glob": "packages/targets/postgres-adapter/src/exports/runtime.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "runtime"
}
```

Note: If `cli`/`runtime` each become a folder, adjust globs to `src/exports/cli/**` and `src/exports/runtime/**`.

## Implementation Plan

1) Create new package
- Scaffold `packages/targets/postgres-adapter` and copy over sources from `packages/sql/runtime/adapters/postgres`.
- Move adapter implementation into `src/core/**`; ensure only shared‑plane imports.
- Move current `src/cli.ts` to `src/exports/cli.ts`.
- Add `src/exports/runtime.ts` (thin wrapper; may re‑export a factory that binds the core to the driver/runtime when needed).

2) Update config and guards
- Update `architecture.config.json` with the three globs above; remove the old SQL adapter glob.
- Run `pnpm lint:deps` to verify planes and layers are respected.

3) Clean dependencies per entrypoint
- Migration entrypoint (`src/exports/cli.ts`) may depend on `@prisma-next/cli/config-types` and SQL tooling.
- Runtime entrypoint (`src/exports/runtime.ts`) must not depend on migration packages.
- Core must only depend on shared packages (e.g., `@prisma-next/sql-relational-core`).

4) Update consumers
- CLI configs: keep importing adapter descriptor from `@prisma-next/adapter-postgres/cli`.
- Runtime/executor wiring (if any): import from `@prisma-next/adapter-postgres/runtime`.

5) Remove old entrypoint
- Delete `packages/sql/runtime/adapters/postgres/src/cli.ts` and related exports to eliminate runtime→migration edges.

## Acceptance Criteria

- The adapter exists as a single package under `packages/targets/postgres-adapter` with `./cli` and `./runtime` entrypoints and shared core.
- `pnpm lint:deps` reports no plane violations for adapter imports.
- No code under `packages/sql/**` imports from the new adapter package.
- CLI emit continues to work using the adapter’s `./cli` descriptor; runtime imports compile and typecheck against the `./runtime` entrypoint.

## Risks & Mitigations

- Risk: Hidden cross‑plane imports inside core.
  - Mitigation: Keep core imports to shared‑plane packages only; let guards enforce.
- Risk: Consumer import paths drift.
  - Mitigation: Preserve package name `@prisma-next/adapter-postgres`; keep `./cli` and `./runtime` subpaths stable.
- Risk: Transient dependency cycles.
  - Mitigation: Run `pnpm lint:deps` early; adjust globs if needed.

## Validation

- Build: `pnpm build`
- Deps guard: `pnpm lint:deps`
- Tests: `pnpm test:packages` and targeted filters for adapter, CLI, and example apps

## References

- `AGENTS.md` — Golden Rules and Boundaries
- `docs/Architecture Overview.md` — Domains, Layers, Planes
- `docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md` — CLI descriptors and pack assembly

