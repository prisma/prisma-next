# Summary

Create a dedicated config package (`@prisma-next/config`) and move the `prisma-next.config.ts` authoring surface (types + validation + provider interfaces) out of `packages/1-framework/1-core/migration/control-plane`. This reduces coupling to migration-plane concerns and keeps the provider-based authoring work (PSL/TS sources) easier to evolve.

# Description

Linear issue `TML-2018` calls out that the “core migration/control-plane” area has become overloaded: config types/validation and contract-source concerns live alongside other control-plane/migration responsibilities.

This refactor is **optional** and intended to improve maintainability for the PSL Contract Authoring project:

- The provider-based authoring pipeline needs stable, reusable config types and validation (`PrismaNextConfig`, `ContractConfig`, `ContractSourceProvider`, diagnostics types, `defineConfig()`, `validateConfig()`).
- Those config concerns are currently implemented in `packages/1-framework/1-core/migration/control-plane/src/*` (e.g. `config-types.ts`, `config-validation.ts`, `contract-source-types.ts`) and consumed by the CLI and authoring packages.
- The migration-plane location and broader package scope create unnecessary coupling and review surface for authoring evolution.

References:

- Linear: `https://linear.app/prisma-company/issue/TML-2018/optional-split-up-1-coremigration`
- Current implementation touchpoint: `packages/1-framework/1-core/migration/control-plane/src/config-types.ts`

## Proposed Package (exactly what we’re creating)

Create a new **framework core / shared plane** package:

- **Name**: `@prisma-next/config`
- **Location**: `packages/1-framework/1-core/shared/config`
- **Architecture coordinates**: framework domain, **layer 1 (core)**, **shared plane**
- **Primary audience**: authors of `prisma-next.config.ts` (and tooling that loads/validates it)
- **What it exports (high-level)**:
  - Config typing for `prisma-next.config.ts` (`PrismaNextConfig`, `ContractConfig`)
  - Descriptor typing needed to author config (`Control*Descriptor`, `Control*Instance`, and the minimal supporting types like `ControlPlaneStack`)
  - Contract source provider interface + diagnostics types (`ContractSourceProvider`, `ContractSourceDiagnostics`, spans)
  - Pure helpers:
    - `defineConfig()` (normalization/defaulting for config objects)
    - `validateConfig()` (structure/runtime-shape validation)
  - Config-focused error types thrown by validation (not CLI output formatting)

# Requirements

## Functional Requirements

- Introduce `@prisma-next/config` that owns the `prisma-next.config.ts` authoring surface:
  - `PrismaNextConfig` / `ContractConfig` types (including provider-based `contract.source`)
  - `Control*Descriptor`/`Control*Instance` types needed to describe `family/target/adapter/driver/extensionPacks` in config
  - `ContractSourceProvider` and diagnostics types
  - `defineConfig()` normalization (defaults) and `validateConfig()` structure/runtime checks
  - config-specific validation errors (as structured errors, but not “CLI envelope” concerns)
- Update consumers (at minimum):
  - `@prisma-next/cli` config loading and re-exports
  - `@prisma-next/contract-ts` helper(s) that return `ContractConfig`
  - Any PSL provider wiring that depends on the provider interfaces
- Remove the moved symbols from `@prisma-next/core-control-plane` to keep it focused on domain actions/migration/control-plane operations.

## Responsibilities (what belongs in `@prisma-next/config`)

- **Config authoring types**: everything a user imports to type their `prisma-next.config.ts`.
- **Composition boundary validation**: “is this config shaped correctly and internally consistent?” checks (e.g. required keys exist, descriptor `kind`/IDs match, provider functions are functions).
- **Normalization/defaulting**: default values like `contract.output` (and any other safe, deterministic defaults).
- **Contract source provider protocol**: the provider function signature and diagnostic shape are owned here because they are part of the config contract and shared by TS-first and PSL-first authoring.

## Non-responsibilities (what should *not* be in `@prisma-next/config`)

- **No file I/O**: loading `prisma-next.config.ts` from disk stays in tooling (CLI).
- **No control-plane domain actions**: verify/sign/introspect/migrations stay in `@prisma-next/core-control-plane` (or follow-on packages).
- **No emission pipeline**: emitting `contract.json` / `contract.d.ts` stays in authoring/emitter/control-plane packages.
- **No CLI formatting concerns**: “how errors render in the CLI” stays in CLI utilities; config validation errors only need to be structured enough to map.

## Non-Functional Requirements

- No observable behavior change for users:
  - `prisma-next.config.ts` authoring experience stays the same
  - config validation error messages remain stable (or improve, but do not regress)
  - `prisma-next contract emit` continues to work for both TS-first and PSL-first
- Preserve package layering and avoid new dependency cycles.
- Keep public exports coherent and discoverable (README updates for moved APIs).

## Non-goals

- Changing the semantics of provider-based contract sources.
- Changing migration planning/execution behavior.
- Introducing backwards-compatibility re-exports purely for old import paths (update call sites instead).

# Acceptance Criteria

- [ ] A dedicated package exists that exports the config typing/validation and provider interfaces used by `prisma-next.config.ts`.
- [ ] `@prisma-next/cli` and `@prisma-next/contract-ts` consume the new package and build/typecheck successfully.
- [ ] Existing config-loader and config-types tests still pass (or are updated to the new import paths) with no behavior regressions.
- [ ] `@prisma-next/core-control-plane` no longer owns the moved config/provider symbols and remains buildable.
- [ ] Package READMEs reflect the new responsibilities and point to the correct import paths.

# Other Considerations

## Security

No new security surface; the change is a packaging refactor. Ensure the refactor does not weaken validation around `contract.source` runtime shape checks (must still enforce “provider function”).

## Cost

No runtime cost impact expected.

## Observability

Not applicable; this is compile-time/package structure work.

## Data Protection

Not applicable.

## Analytics

Not applicable.

# References

- Linear: `https://linear.app/prisma-company/issue/TML-2018/optional-split-up-1-coremigration`
- `packages/1-framework/1-core/migration/control-plane/src/config-types.ts`
- `packages/1-framework/3-tooling/cli/src/config-loader.ts`
- `packages/2-sql/2-authoring/contract-ts/src/config-types.ts`

# Open Questions

1. Do we want `@prisma-next/config` to also re-export the CLI’s “structured error envelope” type used for printing, or keep that as a CLI-only concern and map config errors at the tooling layer?
   - **Assumption**: keep CLI envelope types in `@prisma-next/cli` (or `@prisma-next/core-control-plane` if needed for shared mapping) and have the CLI map config errors to output formatting.
