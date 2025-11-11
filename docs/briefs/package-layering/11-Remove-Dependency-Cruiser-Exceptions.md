## Slice 11 — Eliminate Layering Exceptions in Dependency Cruiser (Domain: Tooling, Layer: tooling, Plane: migration)

### Context
- We migrated import validation to Dependency Cruiser to enforce the domain/layer/plane model declared in `architecture.config.json`.
- A small number of explicit exceptions remain in `dependency-cruiser.config.mjs` to keep the repo green while refactors are in flight.
- This brief removes those exceptions by moving shared surfaces to the right plane, introducing plugin boundaries for CLI, and ensuring runtime consumes artifacts instead of migration code.

### Exceptions Inventory (targets to remove)
- SQL authoring → SQL targets (upward within domain): `dependency-cruiser.config.mjs` predicates `isSqlAuthoringToTargets`
- SQL lanes (runtime) → SQL runtime (upward within domain): `isSqlLanesToRuntime`
- CLI (framework tooling) → SQL targets: `isCliToSqlTargets`
- CLI (framework tooling) → SQL authoring: `isCliToSqlAuthoring`
- Extensions (runtime) → SQL targets (runtime→migration): `isExtensionsToSqlTargets`
- SQL runtime/lanes/adapters (runtime) → SQL targets (runtime→migration): `isSqlRuntimeOrAdaptersToTargets`

### Goals
1. Remove all exception predicates from `dependency-cruiser.config.mjs` and pass `pnpm lint:deps`.
2. Disallow all runtime→migration imports; runtime consumes generated artifacts (types and JSON), not migration code.
3. Disallow upward imports within a domain; share types/ports from lower or shared layers.
4. Make CLI target‑agnostic via plugin interfaces instead of direct imports to SQL authoring/targets.

### Non‑Goals
- Change the domain/layer/plane model or introduce new domains.
- Add long‑term shims; prefer updating callers.
- Swap out Dependency Cruiser or its outputs.

### Deliverables
- No exceptions in `dependency-cruiser.config.mjs`; all rules are enforced.
- New shared contract surface for SQL types that both planes can depend on (emitted artifacts only).
- CLI plugin API in framework tooling with SQL implementation wired via capability flags.
- Updated imports across runtime, lanes, adapters, and extensions to consume shared artifacts.
- Docs updated: `.cursor/rules/import-validation.mdc` and Architecture references.

### Shared Plane — Definition
The shared plane (as used in `architecture.config.json`) contains code and prebuilt artifacts that are safe to import from both the migration and runtime planes. Constraints:
- Must not import from migration or runtime planes.
- Side‑effect free (no environment‑specific IO at import time).
- Typically types (`.d.ts`), validators, and generated JSON artifacts.

### High‑Level Approach
1. Surface Contracts to Shared Plane
   - Create `packages/sql/contract` (plane: shared) that exposes target‑agnostic and per‑target contract artifacts: `contract.d.ts` + `contract.json`.
   - Update SQL authoring/targets to emit into this package; re‑export minimal public types.
   - Update consumers to import from `packages/sql/contract` or framework core‑contract instead of `packages/targets/sql` or authoring packages.

2. Remove Runtime → Migration Edges
   - Update `packages/sql/sql-runtime`, `packages/sql/lanes/*`, `packages/sql/runtime/adapters/*`, and `packages/extensions/compat-prisma` to import from the shared contract surface or framework core‑contract only.
   - Replace any code‑time coupling with reading/using generated artifacts.

3. Pluginize CLI for Target Families
   - Define a plugin interface in `packages/framework/tooling` that depends only on shared/core types.
   - Implement SQL plugin(s) under runtime/adapters or a new `packages/sql/tooling-plugin` using the shared contract surface.
   - Wire CLI to load plugins based on capabilities in the contract; remove direct imports from CLI to SQL authoring/targets.

4. Fix Lanes ↔ Runtime Upward Imports
   - Extract shared runtime DTOs/ports used by lanes to `packages/framework/runtime-core` or a small `sql/runtime-interfaces` in the shared plane.
   - Update lanes to depend downward only; remove `isSqlLanesToRuntime` necessity.

5. Enforce and Document
   - Delete exception predicates from `dependency-cruiser.config.mjs` and re‑run `pnpm lint:deps`.
   - Update `.cursor/rules/import-validation.mdc` to remove exception notes and to reference the shared contract surface and CLI plugin boundaries.

### Step‑By‑Step Plan
1. Scaffold `packages/sql/contract` (shared plane) with build to emit `contract.d.ts` and `contract.json`.
2. Update SQL authoring/targets to emit into the shared contract package; adjust exports.
3. Migrate runtime/lanes/adapters/ext to import only from `packages/sql/contract` or framework core‑contract.
4. Add CLI plugin interface in framework tooling; author SQL plugin; switch CLI to dynamic plugin resolution.
5. Extract lanes/runtime shared interfaces; update lanes imports to depend downward.
6. Remove all exception predicates from `dependency-cruiser.config.mjs`; run `pnpm lint:deps`.
7. Update docs and rules; ensure CI is green.

### Testing / Verification
- `pnpm lint:deps` (repo‑wide) passes with no exceptions in the config.
- No runtime→migration import edges per Dependency Cruiser.
- CLI works with SQL via plugin; no direct imports to authoring/targets.
- Package tests and E2E demo continue to pass: `pnpm test:packages`, `cd examples/todo-app && pnpm demo`.

### Acceptance Criteria
- The following exception helpers are deleted and not reintroduced: `isSqlAuthoringToTargets`, `isSqlLanesToRuntime`, `isCliToSqlTargets`, `isCliToSqlAuthoring`, `isExtensionsToSqlTargets`, `isSqlRuntimeOrAdaptersToTargets`.
- `dependency-cruiser.config.mjs` forbids upward same‑domain imports and all cross‑plane runtime→migration imports with zero exceptions.
- All affected packages compile and tests pass.

### Risks & Mitigations
- Widespread refactors may cause transient breakage → Stage in small PRs, guarded by Dependency Cruiser.
- Type leakage from migration to runtime may be deeper than expected → Aggressively generate and re‑export types from shared contract; avoid re‑exporting entire modules.
- Plugin boundary may need new capabilities → Coordinate with contract owners and update capability gates.

### Milestones
- M1: Shared contract package landed; runtime/lanes/adapters/ext re‑pointed to it.
- M2: CLI plugin interface + SQL plugin in place; CLI no longer imports authoring/targets.
- M3: Lanes/runtimes split finalized; no upward imports within SQL domain.
- M4: Delete all exceptions from depcruise config; docs updated; CI green.
