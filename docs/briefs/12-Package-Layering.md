## Slice 12 — Package Layering & Ownership

### TL;DR
The current `@prisma-next/sql-query` package mixes contract authoring DSLs, relational schema builders, query lanes, and ORM logic in one place. Runtime code also imports authoring helpers, which makes the “thin core, fat targets” promise unenforceable and invites accidental cyclic dependencies. This brief proposes a new concentric package layout that:

- Keeps the **core** (contracts + plans) target-agnostic.
- Pulls the **authoring** surface into its own package.
- Introduces a reusable **relational core** that every lane can share.
- Splits SQL **lanes** (raw, relational DSL, ORM) so they no longer bleed into each other.
- Tightens **targets/adapters** so outer layers cannot leak inward.

The outcome is a filesystem that mirrors the Clean Architecture rings and makes dependency violations mechanically impossible.

---

### Assumptions

- There are no external consumers of this repository yet. We will not add transitional shims or compatibility facades unless a specific internal package requires a short-lived bridge during migration.
- The runtime will be split into a target-neutral kernel and family runtimes. New families (e.g., document) will mirror the SQL layout without touching core.

---

### Current Problems
1. **Mixed responsibilities (`packages/sql-query/src/contract-builder.ts`, `schema.ts`, `orm-builder.ts`)** – Contract authoring DSLs, runtime schema builders, and ORM lowering live side-by-side. Changes routinely touch unrelated features because everything compiles together.
2. **Layer inversion (`packages/sql-query/src/schema.ts:1-21`)** – The schema builder imports both `@prisma-next/runtime` and `@prisma-next/sql-target`. That violates the “core unaware of adapters” rule and makes cyclic imports easy to introduce.
3. **Operations registry drift (`packages/sql-query/src/operations-registry.ts` vs `packages/sql-target/src/operations-registry.ts`)** – Type/runtime mismatches described in `docs/briefs/11-Operation-Registry-Type-Alignment.md` stem from having two packages own different halves of the same concept with no shared core.
4. **ORM mega-file (`packages/sql-query/src/orm-builder.ts`, ~1,100 LOC)** – Includes, relation filters, projection inference, and adapter lowering are tightly coupled. Any change in the relational DSL risks breaking ORM behavior because they share the same internal state.
5. **No structural guardrails** – `pnpm` workspaces and tsconfig paths do not reflect architecture rings, so developers can import across layers without friction, leading to accidental cycles.
6. **Runtime is SQL-bound (`packages/runtime/src/runtime.ts:1-48`)** – The runtime generics, codec registry, and adapter interfaces all reference `SqlContract`, `SqlStorage`, and SQL drivers. Until SQL logic moves into the `targets/sql` ring, the runtime cannot truthfully be called target-family agnostic.

---

### Goals
- Reorganize packages into explicit rings (Core → Authoring → Targets → Lanes → Adapters).
- Enforce unidirectional dependencies; inner rings never import outer rings.
- Preserve existing APIs via compatibility exports while teams migrate.
- Prepare the codebase for additional targets (document, graph) without touching the SQL lanes.
- Keep the runtime target-family agnostic by extracting a shared runtime core and hosting SQL-specific execution in its own package.

### Non-goals
- Changing adapter SPIs or manifest formats (any refactors remain internal).
- Rebuilding the CLI or runtime; this brief focuses on code organization.

---

### Proposed Topology

```
packages/
  core/
    contract            (contract types + plan metadata)
    plan                (plan helpers, diagnostics, shared errors)
    operations          (target-neutral op registry + capability helpers)
  authoring/
    contract-authoring  (TS builders, canonicalization, schema DSL)
  targets/
    sql/
      contract-types
      operations
      emitter
    /* future families (document, graph, etc.) live alongside sql */
  lanes/
    relational-core     (schema + column builders, operations attachment, AST types)
    sql-lane            (relational DSL + raw SQL helpers)
    orm-lane            (ORM builder, include lowering, relation filters)
  runtime/
    core                (plan verification, plugin lifecycle, target-neutral SPI)
  adapters/
    driver-postgres
    adapter-postgres
  compat/
    prisma              (only if we later need external shims; can stay empty for now)
```

**Dependency rules**

`core → authoring → targets → lanes → runtime → adapters`

Each arrow is one-way. ESLint + tsconfig path groups will enforce that inner rings never import from outer rings.

---

### Package Moves & Responsibilities

| Current Location | New Home | Notes |
| ---------------- | -------- | ----- |
| `packages/sql-query/src/contract-builder.ts`, `contract.ts`, `schemas/` | `packages/authoring/contract-authoring` | Becomes the migration-plane authoring surface. Exports wrapped by `@prisma-next/contract-authoring`. |
| `packages/sql-query/src/schema.ts`, `types.ts`, `param.ts`, `operations-registry.ts`, `sql.ts` AST helpers | `packages/lanes/relational-core` | Provides table/column builders, column metadata preservation, param helpers, and canonical operation execution. No runtime imports. |
| `packages/sql-query/src/sql.ts`, `raw.ts`, AST builders, adapters to SQL strings | `packages/lanes/sql-lane` | Consumes `relational-core`; exposes the relational DSL and raw lane surfaces. |
| `packages/sql-query/src/orm-builder.ts`, `orm-types.ts`, `orm-include-child.ts`, `orm-relation-filter.ts` | `packages/lanes/orm-lane` | Splits `orm-builder.ts` into feature-specific modules (projection, includes, filters) and depends on `relational-core` for schema access. |
| Operation registry types (`packages/sql-target/src/operations-registry.ts`) + column attachment logic | `packages/core/operations` | New shared module (`@prisma-next/operations`) defining `OperationSignature`, capability gating, and the execution helper used by both authoring validation and lanes. |
| `packages/sql-target` | `packages/targets/sql` | Flatten into subfolders (`contract-types`, `operations`, `emitter`). Provide a single curated entry point for adapters. |
| `packages/runtime` (SQL-specific today) | `packages/runtime/core` + `packages/sql/sql-runtime` | Core owns plan verification + plugin SPI; SQL runtime implements the target hook and plugs into core. |

---

### Migration Plan

1. **Scaffold rings**
   - Create the folder skeleton (`core`, `authoring`, `targets`, `lanes`, `runtime`, `adapters`).
   - Update `pnpm-workspace.yaml`, `tsconfig.base.json`, and ESLint to recognize the new path groups.
   - Add an import rule (`import/no-restricted-paths`) that forbids inward dependencies (e.g., `lanes/*` importing `authoring/*`).

2. **Extract contract authoring**
   - Move `contract-builder.ts`, `contract.ts`, and `schemas/` into `authoring/contract-authoring`.
   - Publish a compatibility re-export from `@prisma-next/sql-query` so callers continue to work during the migration.

3. **Stand up relational core**
   - Move schema/table builder files plus `operations-registry.ts` into `lanes/relational-core`.
   - Replace runtime imports with a lightweight `RelationalContext` (contract + operation registry + codec map).
   - Ensure unit tests (`column-builder-operations.test.ts`, `sql.test.ts`) run inside the new package.

4. **Split lanes**
   - Move DSL-specific files into `lanes/sql-lane`.
   - Move ORM-specific files into `lanes/orm-lane`; break the current mega-file into smaller modules (projection, includes, relation filters).
   - Update exports so consumers import from `@prisma-next/sql-lane` / `@prisma-next/orm-lane`.

5. **Tighten targets/adapters**
   - Restructure `sql-target` as `targets/sql`. Ensure adapters and runtime consume only curated exports.
   - Move the operation registry definitions into `core/operations` and have `targets/sql` populate it while `lanes/*` consume it.

6. **Decouple the runtime**
   - Update `@prisma-next/runtime` so it depends on `core/*` abstractions instead of `@prisma-next/sql-target` directly.
   - Move SQL-specific codecs/adapters into `targets/sql` and inject them through the runtime context so future target families can plug in the same way.

7. **Remove legacy re-exports**
   - Collapse the old `@prisma-next/sql-query` package once internal call sites migrate; there are no external consumers, so we can skip long-lived compatibility shims unless an internal package truly needs them.

---

### Execution Slices

Each stage above has its own brief so individual agents can execute slices independently while keeping tests green between steps:

1. [Slice 1 — Scaffold Rings & Guardrails](package-layering/01-Scaffold-Rings-and-Guardrails.md)
2. [Slice 2 — Extract Contract Authoring](package-layering/02-Extract-Contract-Authoring.md)
3. [Slice 3 — Stand Up Relational Core](package-layering/03-Stand-Up-Relational-Core.md)
4. [Slice 4 — Split SQL Lanes](package-layering/04-Split-SQL-Lanes.md)
5. [Slice 5 — Restructure SQL Target & Operations Core](package-layering/05-Restructure-SQL-Target-and-Operations-Core.md)
6. [Slice 6 — Runtime Core & SQL Runtime Split](package-layering/06-Runtime-Core-and-SQL-Runtime-Split.md)
7. [Slice 7 — Remove Legacy Packages & Clean Up](package-layering/07-Remove-Legacy-Packages.md)

Each brief includes context, goals, explicit out-of-scope items, and verification steps.

---

### Guardrails & Tooling
- **Import graph checks** – Add a CI step (madge or custom script) that fails if any package in an inner ring imports an outer ring.
- **Path aliases** – Define `@core/*`, `@authoring/*`, `@targets/*`, `@lanes/*`, `@runtime/*`, `@adapters/*` in `tsconfig.base.json` to nudge developers toward the correct modules.
- **README update** – Document the ring layout and dependency rules so new contributors know which package to touch.
- **Runtime integration tests** – Stand up a thin suite that boots the runtime with a mocked non-SQL target to prove the abstractions really are family-agnostic.

---

### Risks & Mitigations
- **Large diff surface** – Moving files can churn git history. Mitigate by migrating package-by-package (contract authoring → relational core → lanes) and keeping compatibility exports until downstream consumers switch.
- **Testing gaps** – Ensure each new package carries its relevant tests (e.g., `relational-core` owns `column-builder-operations.test.ts`). Run `pnpm --filter <package> test` per ring in CI.
- **Adapter regressions** – After reorganizing, run adapter tests (`pnpm --filter @prisma-next/adapter-postgres test operation-lowering.test.ts`) to confirm lowering paths still work.

---

### Open Questions → Resolutions
1. **Compatibility exports?** No internal tools require long-lived shims. Transitional re-exports may exist during a slice, but Slice 7 must remove them before completion.
2. **Document-family lanes now or later?** We will scaffold the `packages/document` folder (empty) during Slice 1 to signal the structure, but defer creating actual packages until the document target project kicks off.
3. **Automated dependency graph check?** Yes—Slice 1 adds a `pnpm lint:deps` command powered by `madge` (or `dependency-cruiser`) so CI enforces the import direction. No manual checks after that.
4. **When to declare runtime target-agnostic?** After Slice 6 lands and `@prisma-next/runtime-core` + `@prisma-next/sql-runtime` are in use by all call sites, the runtime APIs can be documented as target-neutral. We will add a smoke test that wires a mock (non-SQL) family into runtime-core before making the announcement.
