# Project Brief — Separate Dialect, Adapter, and Driver (Targets Domain)

Goal: Keep dialect (target), adapter, and driver independent so consumers can mix and match, while maintaining a single adapter package with clean plane boundaries via multi‑entrypoints.

## Context

- SQL family (`packages/sql/**`) is target‑agnostic. Concrete dialects (e.g., Postgres), adapters, and drivers belong in the Targets/Extensions domain.
- Current layout places a Postgres adapter under the SQL family runtime ring, and its `/cli` entrypoint imports migration‑plane tooling, tripping plane violations.
- We want a clean separation that enables:
  - Dialect (target) manifests and validation for tooling (migration plane)
  - Adapter SPI implementation reusable by both planes (shared core)
  - Runtime‑only wiring (connections, telemetry) decoupled from tooling
  - Drivers as independent, swappable runtime packages

## Goals

- Keep dialect, adapter, and driver as separate packages in the Targets/Extensions domain.
- Keep the adapter as a single NPM package with multiple entrypoints:
  - `./cli` (migration) for CLI descriptors
  - `./runtime` (runtime) for runtime wiring
  - `./adapter` (shared) exposing the adapter core impl
- Make plane boundaries explicit with path‑based grouping so dependency guards stay green.
- Preserve tree‑shakability and minimize churn for consumer imports.

## Non‑Goals

- Changing adapter or driver runtime behavior beyond relocations and exports.
- Consolidating the dialect and adapter into a single package (we intentionally keep them separate).

## Design Overview

Three independent packages under `packages/targets/**` (Extensions domain):

- Dialect (Target): `packages/targets/postgres`
  - Plane/Layer: migration, targets
  - Exports: `./cli` → TargetDescriptor (IR for CLI), `packs/manifest.json`

- Adapter (single package, multi‑plane entrypoints): `packages/targets/postgres-adapter`
  - Core (shared plane): `src/core/**` — adapter SPI implementation (lowering, codecs, profile)
  - CLI (migration plane): `src/exports/cli.ts` — AdapterDescriptor (IR); safe imports from CLI/tooling
  - Runtime (runtime plane): `src/exports/runtime.ts` — runtime factory/bindings; no migration deps
  - Exports:
    - `./adapter` → re‑exports from `src/core`
    - `./cli` → `src/exports/cli.ts`
    - `./runtime` → `src/exports/runtime.ts`

- Driver: `packages/targets/postgres-driver`
  - Plane/Layer: runtime, drivers
  - Exports: driver factory and types

Plane mapping via `architecture.config.json` subpath globs for the adapter package:

- `packages/targets/postgres-adapter/src/core/**` → plane: shared
- `packages/targets/postgres-adapter/src/exports/cli.ts` → plane: migration
- `packages/targets/postgres-adapter/src/exports/runtime.ts` → plane: runtime

## Imports for Consumers

- CLI config (migration plane):
  - `import postgres from '@prisma-next/targets-postgres/cli'`
  - `import postgresAdapter from '@prisma-next/adapter-postgres/cli'`
- Runtime wiring (runtime plane):
  - `import { createAdapter } from '@prisma-next/adapter-postgres/runtime'`
  - `import { createDriver } from '@prisma-next/driver-postgres'`

## architecture.config.json Changes

Add or update entries:

- Target (dialect):
```
{ "glob": "packages/targets/postgres/**", "domain": "extensions", "layer": "targets", "plane": "migration" }
```
- Adapter (shared core):
```
{ "glob": "packages/targets/postgres-adapter/src/core/**", "domain": "extensions", "layer": "adapters", "plane": "shared" }
```
- Adapter (cli entrypoint):
```
{ "glob": "packages/targets/postgres-adapter/src/exports/cli.ts", "domain": "extensions", "layer": "adapters", "plane": "migration" }
```
- Adapter (runtime entrypoint):
```
{ "glob": "packages/targets/postgres-adapter/src/exports/runtime.ts", "domain": "extensions", "layer": "adapters", "plane": "runtime" }
```
- Driver:
```
{ "glob": "packages/targets/postgres-driver/**", "domain": "extensions", "layer": "drivers", "plane": "runtime" }
```

Remove legacy SQL‑domain globs for the old adapter/driver paths.

## Implementation Plan

1) Extract and relocate
- Move Postgres target (if currently under `packages/targets/sql/postgres`) to `packages/targets/postgres`.
- Move the current adapter to `packages/targets/postgres-adapter`, splitting into:
  - `src/core/**` (shared)
  - `src/exports/cli.ts` (migration)
  - `src/exports/runtime.ts` (runtime)

2) Update package exports
- Adapter `package.json` exports `./adapter`, `./cli`, and `./runtime` to the correct files.
- Ensure no migration imports from `src/core/**`; `src/exports/runtime.ts` has no migration deps.

3) Update architecture.config.json
- Add the four entries above; delete old SQL‑domain adapter glob(s).
- Run `pnpm lint:deps` to validate guardrails.

4) Update consumers and docs
- Examples and tests import from new paths.
- Update AGENTS.md references if any mention the old layout.

## Acceptance Criteria

- Dialect, adapter, and driver live under `packages/targets/**` as separate packages.
- Adapter is a single package with `./adapter`, `./cli`, and `./runtime` entrypoints and passes plane guards.
- No runtime→migration or migration→runtime violations from adapter imports.
- CLI emit and runtime wiring compile and tests pass.

## Risks & Mitigations

- Hidden cross‑plane deps in adapter core → keep imports strictly to shared‑plane packages; rely on `lint:deps`.
- Import path churn in examples/tests → search and update; keep package names stable (e.g., `@prisma-next/adapter-postgres`).
- Version skew between target and adapter → independent packages allow intentional decoupling; document compatible versions if needed.

## Validation

- Build: `pnpm build`
- Dependency guard: `pnpm lint:deps`
- Tests: `pnpm test:packages`, `pnpm test:integration`

## References

- AGENTS.md — Boundaries & Safety Rails
- docs/Architecture Overview.md — Domains, Layers, Planes
- docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md — CLI descriptors and pack assembly

