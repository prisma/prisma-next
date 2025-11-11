## Slice 11 — Eliminate Layering Exceptions in Dependency Cruiser (Domain: Tooling, Layer: tooling, Plane: migration)

### Context
- We migrated import validation to Dependency Cruiser to enforce the domain/layer/plane model declared in `architecture.config.json`.
- A small number of explicit exceptions remain in `dependency-cruiser.config.mjs` to keep the repo green while refactors are in flight.
- This brief removes those exceptions by moving shared surfaces to the right plane, introducing plugin boundaries for CLI, and ensuring runtime consumes artifacts instead of migration code.

### Exceptions Inventory (targets to remove)
- ~~SQL authoring → SQL targets (upward within domain): `dependency-cruiser.config.mjs` predicates `isSqlAuthoringToTargets`~~ ✅ **COMPLETED** - Types moved to shared plane (`@prisma-next/sql-contract`)
- SQL lanes (runtime) → SQL runtime (upward within domain): `isSqlLanesToRuntime`
- CLI (framework tooling) → SQL targets: `isCliToSqlTargets`
- CLI (framework tooling) → SQL authoring: `isCliToSqlAuthoring`
- Extensions (runtime) → SQL targets (runtime→migration): `isExtensionsToSqlTargets`
- ~~SQL runtime/lanes/adapters (runtime) → SQL targets (runtime→migration): `isSqlRuntimeOrAdaptersToTargets`~~ ✅ **COMPLETED** - Types moved to shared plane (`@prisma-next/sql-contract`)

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
- No exceptions in `dependency-cruiser.config.mjs`; all rules are enforced. ⚠️ **PARTIAL** - Contract-related exceptions removed
- ~~New shared contract surface for SQL types that both planes can depend on (emitted artifacts only).~~ ✅ **COMPLETED** - `@prisma-next/sql-contract` package created
- CLI plugin API in framework tooling with SQL implementation wired via capability flags.
- ~~Updated imports across runtime, lanes, adapters, and extensions to consume shared artifacts.~~ ✅ **COMPLETED** - All packages import from `@prisma-next/sql-contract/types`
- Docs updated: `.cursor/rules/import-validation.mdc` and Architecture references.

### Shared Plane — Definition
The shared plane (as used in `architecture.config.json`) contains code and prebuilt artifacts that are safe to import from both the migration and runtime planes. Constraints:
- Must not import from migration or runtime planes.
- Side‑effect free (no environment‑specific IO at import time).
- Typically types (`.d.ts`), validators, and generated JSON artifacts.

**Enforcement**: Plane import constraints are now defined declaratively in `architecture.config.json` under `planeRules`, rather than hardcoded in `dependency-cruiser.config.mjs`. This makes exceptions explicit and easier to track for removal.

### High‑Level Approach
1. ~~Surface Contracts to Shared Plane~~ ✅ **COMPLETED**
   - ~~Create `packages/sql/contract` (plane: shared) that exposes target‑agnostic and per‑target contract artifacts: `contract.d.ts` + `contract.json`.~~ ✅ **COMPLETED** - Package created with types, validators, and factories
   - ~~Update SQL authoring/targets to emit into this package; re‑export minimal public types.~~ ✅ **COMPLETED** - Deprecated `@prisma-next/sql-contract-types` in favor of `@prisma-next/sql-contract`
   - ~~Update consumers to import from `packages/sql/contract` or framework core‑contract instead of `packages/targets/sql` or authoring packages.~~ ✅ **COMPLETED** - All imports updated

2. ~~Remove Runtime → Migration Edges~~ ✅ **COMPLETED** (for contract types)
   - ~~Update `packages/sql/sql-runtime`, `packages/sql/lanes/*`, `packages/sql/runtime/adapters/*`, and `packages/extensions/compat-prisma` to import from the shared contract surface or framework core‑contract only.~~ ✅ **COMPLETED** - All packages import from `@prisma-next/sql-contract/types`
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
1. ~~Scaffold `packages/sql/contract` (shared plane) with build to emit `contract.d.ts` and `contract.json`.~~ ✅ **COMPLETED** - Package exists with types, validators, and factories
2. ~~Update SQL authoring/targets to emit into the shared contract package; adjust exports.~~ ✅ **COMPLETED** - All imports updated to use `@prisma-next/sql-contract/types`
3. ~~Migrate runtime/lanes/adapters/ext to import only from `packages/sql/contract` or framework core‑contract.~~ ✅ **COMPLETED** - All packages now import from shared contract surface
4. Add CLI plugin interface in framework tooling; author SQL plugin; switch CLI to dynamic plugin resolution.
5. Extract lanes/runtime shared interfaces; update lanes imports to depend downward.
6. ~~Remove all exception predicates from `dependency-cruiser.config.mjs`; run `pnpm lint:deps`.~~ ⚠️ **PARTIAL** - Removed `isSqlAuthoringToTargets` and `isSqlRuntimeOrAdaptersToTargets`; others remain
7. Update docs and rules; ensure CI is green.

### Testing / Verification
- `pnpm lint:deps` (repo‑wide) passes with no exceptions in the config.
- No runtime→migration import edges per Dependency Cruiser.
- CLI works with SQL via plugin; no direct imports to authoring/targets.
- Package tests and E2E demo continue to pass: `pnpm test:packages`, `cd examples/todo-app && pnpm demo`.

### Acceptance Criteria
- The following exception helpers are deleted and not reintroduced: ~~`isSqlAuthoringToTargets`~~ ✅, ~~`isSqlRuntimeOrAdaptersToTargets`~~ ✅, `isSqlLanesToRuntime`, `isCliToSqlTargets`, `isCliToSqlAuthoring`, `isExtensionsToSqlTargets`.
- `dependency-cruiser.config.mjs` forbids upward same‑domain imports and all cross‑plane runtime→migration imports with zero exceptions. ⚠️ **PARTIAL** - Contract type exceptions removed; others remain
- All affected packages compile and tests pass. ✅ **COMPLETED**

### Risks & Mitigations
- Widespread refactors may cause transient breakage → Stage in small PRs, guarded by Dependency Cruiser.
- Type leakage from migration to runtime may be deeper than expected → Aggressively generate and re‑export types from shared contract; avoid re‑exporting entire modules.
- Plugin boundary may need new capabilities → Coordinate with contract owners and update capability gates.

### Milestones
- ~~M1: Shared contract package landed; runtime/lanes/adapters/ext re‑pointed to it.~~ ✅ **COMPLETED**
  - `@prisma-next/sql-contract` package created in shared plane
  - All packages updated to import from shared contract surface
  - `@prisma-next/sql-contract-types` deprecated and removed
  - ContractIR moved to `@prisma-next/contract/ir` in shared plane
- M2: CLI plugin interface + SQL plugin in place; CLI no longer imports authoring/targets.
- M3: Lanes/runtimes split finalized; no upward imports within SQL domain.
- M4: Delete all exceptions from depcruise config; docs updated; CI green. ⚠️ **PARTIAL** - Contract-related exceptions removed; CLI and lanes exceptions remain
