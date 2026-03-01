# Optional split up 1-core/migration — Execution Plan

## Summary

Create `@prisma-next/config` as a **framework / layer 1 (core) / shared plane** package that owns the `prisma-next.config.ts` authoring surface (types, provider protocol, validation, normalization). Update tooling/authoring consumers to import from it, then remove the moved exports from `@prisma-next/core-control-plane` so migration-plane domain logic is no longer coupled to config typing.

**Spec:** `projects/psl-contract-authoring/specs/optional-split-up-1-core-migration.spec.md`

## Milestones

### Milestone 1: Create `@prisma-next/config` package skeleton

**Tasks:**

- [ ] Create package at `packages/1-framework/1-core/shared/config` named `@prisma-next/config` with:
  - `tsdown` build, `vitest`, `typecheck`, `lint` scripts consistent with other `1-core/shared/*` packages
  - curated `exports` subpaths for config entrypoints (avoid “everything from root”)
- [ ] Add package mapping in `architecture.config.json` (domain: framework, layer: core, plane: shared).

### Milestone 2: Move config surface into `@prisma-next/config`

**Tasks:**

- [ ] Move (or re-home) the following concepts from `@prisma-next/core-control-plane` into `@prisma-next/config`:
  - `PrismaNextConfig`, `ContractConfig`, `defineConfig()`
  - `validateConfig()`
  - `ContractSourceProvider` and `ContractSourceDiagnostics` (+ span/position types)
  - the `Control*Descriptor`/`Control*Instance` typing that `prisma-next.config.ts` needs to type `family/target/adapter/driver/extensionPacks`
- [ ] Decide and implement the config error strategy:
  - config validation throws structured errors that the CLI can map
  - CLI envelope/printing types remain owned by CLI/tooling (not by `@prisma-next/config`)

### Milestone 3: Update consumers and remove old exports

**Tasks:**

- [ ] Update `@prisma-next/cli` to import config types/validation from `@prisma-next/config` (including any re-export surface under `packages/1-framework/3-tooling/cli/src/exports/config-types.ts`).
- [ ] Update `@prisma-next/sql-contract-ts` (and any other helper packages) that reference `ContractConfig` to import from `@prisma-next/config`.
- [ ] Update PSL provider wiring (if any) that references provider types to import from `@prisma-next/config`.
- [ ] Remove the moved exports from `@prisma-next/core-control-plane` and update its README to reflect new responsibility boundaries.

### Milestone 4: Tests + docs alignment

**Tasks:**

- [ ] Update/relocate tests so config typing/validation tests cover `@prisma-next/config` directly.
- [ ] Ensure CLI config-loader tests still pass and that `contract emit` behavior is unchanged.
- [ ] Update READMEs for:
  - `@prisma-next/config` (new) — purpose, responsibilities, “what it does not do”, basic usage
  - `@prisma-next/core-control-plane` — remove moved config surface and link to `@prisma-next/config`

## Test Plan

- **Unit**:
  - `validateConfig()` success/failure cases (structure checks and “provider must be function”).
  - `defineConfig()` defaulting behavior (e.g. `contract.output`).
- **Integration**:
  - CLI config loading still works and rejects missing/invalid configs with stable messaging.
  - `prisma-next contract emit` works with provider-based sources as before (no behavior regressions).

## Risks / Mitigations

- **Risk**: plane rule violations (shared plane importing migration-plane errors/utilities).
  - **Mitigation**: keep `@prisma-next/config` errors minimal and local; do not depend on CLI printing/envelope code.
- **Risk**: import churn from moving types.
  - **Mitigation**: keep a small, intentional `exports` surface and update all call sites in the same change set.
