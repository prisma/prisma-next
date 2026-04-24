# Migration control-adapter DI + `Migration` base split — Plan

## Summary

Refactor Postgres class-flow migrations to inject the control adapter via constructor instead of a module-level singleton; split the migration entrypoint orchestrator out of the abstract `Migration` base class into `@prisma-next/cli`; give the SQL control adapter a `lower()` method so emit-time SQL renders through the same code path as runtime SQL; remove the runtime-plane dependency from `@prisma-next/target-postgres`.

**Spec:** [spec.md](./spec.md)

**Linear ticket:** TML-2301

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives execution. |
| Reviewer | Terminal team | Architectural review (descriptor signature change touches framework-components). |
| Affected | Anyone authoring `migration.ts` files | Migration-author surface changes (factory call shape + run guard). One-line edits per file; CLI scaffolds emit the new shape going forward. |

## Milestones

The work is sliced for independent reviewability. Each milestone leaves the repo green and each can land as its own PR.

### Milestone 1: Adapter descriptors take the stack (no behavior change)

Lift `create()` on `ControlAdapterDescriptor` and the SQL specialization of `RuntimeAdapterDescriptor` to take the assembled stack, mirroring `ControlFamilyDescriptor.create(stack)`. All call sites updated; the stack is unused inside `create()` bodies for now. Behavior unchanged. Sets the stage for milestones 2 and 3 to read from the stack without further signature churn.

**Tasks:**

- [ ] Update `ControlAdapterDescriptor.create` in `packages/1-framework/1-core/framework-components/src/control-descriptors.ts` to take `ControlStack<F, T>`.
- [ ] Update `RuntimeAdapterDescriptor.create` in `packages/1-framework/1-core/framework-components/src/execution-descriptors.ts` to take the runtime stack equivalent (review whether the framework-components runtime stack type covers what we need; if not, accept `void` for now and bump in milestone 3 — flag as decision point).
- [ ] Update `SqlControlAdapterDescriptor.create` in `packages/2-sql/9-family/src/core/control-adapter.ts` and `SqlRuntimeAdapterDescriptor.create` in `packages/2-sql/5-runtime/src/sql-context.ts` accordingly.
- [ ] Update `postgresAdapterDescriptor` in `packages/3-targets/6-adapters/postgres/src/exports/control.ts` and `postgresRuntimeAdapterDescriptor` in `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts` to accept (and ignore for now) the stack arg.
- [ ] Update every existing caller of `descriptor.create()` in tests, fixtures, and framework code to pass a stack (or pass a minimal stub where the test doesn't have one). Identify via `rg "\.adapter\.create\(\)" packages/`.
- [ ] Run `pnpm typecheck` and `pnpm lint:deps`; fix fallout.

### Milestone 2: Control adapter gains `lower()` via shared renderer

Extract the SQL rendering body of `PostgresAdapterImpl.lower()` into a shared free function in `packages/3-targets/6-adapters/postgres/src/core/`. Add `lower()` to the `SqlControlAdapter` interface and implement it on `PostgresControlAdapter` by delegating to the shared renderer. Confirm byte-identical output between control and runtime adapters.

**Tasks:**

- [ ] Identify the rendering surface to extract: the `switch (node.kind)` body of `PostgresAdapterImpl.lower()` (`packages/3-targets/6-adapters/postgres/src/core/adapter.ts:124-163`) and its dependencies (`renderSelect`, `renderInsert`, `renderUpdate`, `renderDelete`, `getCodecParamCast` switch, `ParamIndexMap` building).
- [ ] Move the renderer into a new module (e.g. `packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`) as a pure free function `renderLoweredSql(ast, contract) → { sql, params }`. Both `PostgresAdapterImpl.lower()` and `PostgresControlAdapter.lower()` call it. Leave the `getCodecParamCast` hardcoded switch in place — out of scope.
- [ ] Add `lower(ast, ctx): LoweredStatement` to `SqlControlAdapter<TTarget>` in `packages/2-sql/9-family/src/core/control-adapter.ts`.
- [ ] Implement `lower()` on `PostgresControlAdapter` by delegating to `renderLoweredSql`. Match `profile.id` semantics (same shape as runtime).
- [ ] Add a unit test that asserts byte-identical `{ sql, params }` between `PostgresControlAdapter.lower()` and `PostgresAdapterImpl.lower()` for select / insert / update / delete cases including JSON / JSONB / vector-cast `ParamRef`s.
- [ ] Run `pnpm typecheck`, package tests, and `pnpm lint:deps`.

### Milestone 3: Migration constructor takes stack; `dataTransform` takes adapter; remove `Migration.run`; introduce `runMigration`

This is the central change. It must land atomically because removing `Migration.run` requires `runMigration` to exist and every call site to flip in the same PR. Subdivided here for ordering during execution; review can be done per-task or whole-milestone.

**Tasks:**

- [ ] Add a constructor to `Migration` (`packages/1-framework/3-tooling/migration/src/migration-base.ts`) that accepts and stores `ControlStack<F, T>`. Type the stack generic on the class (default to `unknown`/`never` if needed for the abstract level; concrete `PostgresMigration` narrows it).
- [ ] Update `SqlMigration` and `PostgresMigration` to forward the stack to the base constructor. Have `PostgresMigration` materialize and store `controlAdapter` via `stack.adapter.create(stack)`.
- [ ] Add `protected dataTransform(contract, name, options)` to `PostgresMigration` that calls the free factory with `this.controlAdapter`.
- [ ] Change the free `dataTransform` (`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`) signature to `(contract, name, options, adapter)`. Drop `adapterSingleton`, `getAdapter()`, and the imports of `createPostgresAdapter` and `lowerSqlPlan`. Replace `lowerSqlPlan(adapter, contract, plan)` with `adapter.lower(plan, { contract })` (or whatever shape the adapter's `lower` exposes — confirm during implementation).
- [ ] Add a unit test for `dataTransform` using a fake control adapter (verifies injection works without real Postgres).
- [ ] Remove `Migration.run` static from `migration-base.ts`. The `serializeMigration`, `buildAttestedManifest`, `printHelp`, and helpers move with `runMigration` (or stay exported as helpers consumed by `runMigration`; pick during execution — leaning toward keeping helpers in migration-tools and importing them from the runner).
- [ ] Create a new subpath in `@prisma-next/cli` (e.g. `src/migration-runner.ts` exported as `@prisma-next/cli/migration-runner`). Implement `runMigration(importMetaUrl, MigrationClass)`:
  - Entrypoint guard (`realpathSync` of `fileURLToPath(importMetaUrl)` vs `process.argv[1]`; bail otherwise).
  - Arg parsing (`--help`, `--dry-run`, optionally `--config <path>`).
  - `loadConfig(configPath)` from `@prisma-next/cli`'s existing loader; bail with a clear diagnostic if no config.
  - `createControlStack({ family, target, adapter, extensionPacks })` using the loaded config descriptors.
  - `new MigrationClass(stack)`.
  - Target-mismatch check (`config.target.targetId === instance.targetId`); diagnostic on mismatch.
  - Delegate to existing serialization code (extract from migration-tools or call into it).
- [ ] Allocate a new error code in `@prisma-next/errors/migration` for target mismatch (e.g. `PN-MIG-3001` or next free code in the migration range). Add error factory.
- [ ] Update `@prisma-next/cli`'s package.json `exports` map to declare the new subpath.
- [ ] Update `@prisma-next/cli`'s `tsdown` config (if applicable) to emit the new entry.
- [ ] Update every existing `migration.ts` in `examples/prisma-next-demo/migrations/**` (3 files): swap `dataTransform(...)` → `this.dataTransform(...)`, remove the `dataTransform` import, swap `Migration.run(...)` → `runMigration(...)` with the new import.
- [ ] Update any `migration.ts` under integration tests using `rg --files -g 'migration.ts' packages/ examples/ tests/` to find them.
- [ ] Update the CLI's migration-scaffold/template that emits new `migration.ts` files. Identify via `rg "Migration.run\\(import\\.meta\\.url" packages/1-framework/3-tooling/cli/src`.
- [ ] Add unit tests covering `runMigration` diagnostics: target mismatch, config not found.
- [ ] Run `pnpm typecheck`, full test suite, and `pnpm lint:deps`.

### Milestone 4: Drop runtime-plane deps from `@prisma-next/target-postgres`

After milestone 3, `data-transform.ts` no longer imports from `@prisma-next/sql-runtime` or `@prisma-next/adapter-postgres`. Verify nothing else in `target-postgres/src/**` does either; remove both from `package.json`. Confirm dep-cruiser is happy.

**Tasks:**

- [ ] Run `rg "from '@prisma-next/sql-runtime'" packages/3-targets/3-targets/postgres/src/` and `rg "from '@prisma-next/adapter-postgres" packages/3-targets/3-targets/postgres/src/`. Resolve any remaining imports.
- [ ] Remove `@prisma-next/sql-runtime` from `dependencies` in `packages/3-targets/3-targets/postgres/package.json`.
- [ ] Remove `@prisma-next/adapter-postgres` from `devDependencies` in the same file.
- [ ] Run `pnpm install` to update the lockfile (do not edit `pnpm-lock.yaml` directly).
- [ ] Run `pnpm typecheck` and `pnpm lint:deps`. Both must pass.
- [ ] If any test in `packages/3-targets/3-targets/postgres/test/` actually exercised the runtime adapter or relied on the dev-dep, relocate it or wire it via a test-utils package — explicit decision point during execution.

### Milestone 5: Verification + project close-out

End-to-end verification that the refactor preserved behavior and project teardown.

**Tasks:**

- [ ] Re-run each example migration under `examples/prisma-next-demo/migrations/**`; confirm `ops.json` is byte-identical to the committed version (use `git diff` after re-running).
- [ ] Run the full `data-transform-*.e2e.test.ts` and `class-flow-round-trip.e2e.test.ts` suites; confirm pass.
- [ ] Walk through the spec's acceptance criteria checklist; verify each is met (link tests where applicable).
- [ ] Decide whether to capture any architectural decisions in an ADR (control adapter `lower()`; runner-out-of-base-class). Default: no — these are mechanical fixes, not policy decisions worth durable doc weight. Confirm at close-out and skip if so.
- [ ] Strip any repo-wide references to `projects/migration-control-adapter-di/**` (the project folder is transient).
- [ ] Delete `projects/migration-control-adapter-di/` as the final commit of the close-out PR.

## Test Coverage

Map of every spec acceptance criterion to its test/check.

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| `rg "from '@prisma-next/sql-runtime'" packages/3-targets/3-targets/postgres/src/core/` empty | grep check | M4 | Verified manually + via dep-cruiser. |
| `rg "from '@prisma-next/adapter-postgres" packages/3-targets/3-targets/postgres/src/core/` empty | grep check | M4 | Same. |
| `rg "createPostgresAdapter\(" packages/3-targets/3-targets/postgres/src/` empty | grep check | M3 | Verified after `data-transform.ts` rewrite. |
| `target-postgres/package.json` no longer lists adapter / sql-runtime | manual diff | M4 | Visible in PR diff. |
| `pnpm lint:deps` passes | CI | M4 | Final dep-cruiser check. |
| `SqlControlAdapter` declares `lower()` | typecheck | M2 | TS compile gates this. |
| `SqlControlAdapterDescriptor.create(stack)` and runtime equivalent take stack | typecheck | M1 | TS compile gates this. |
| Control + runtime delegate to single shared renderer | code review | M2 | Single import path verifiable. |
| Byte-identical control vs runtime `lower()` output | unit | M2 | New `control-vs-runtime-lower.test.ts` (or similar) covering select/insert/update/delete + JSON/JSONB/vector. |
| `Migration.run` removed | grep / typecheck | M3 | `rg "Migration\\.run\\(" packages/` empty (modulo deleted file). |
| `Migration` ctor takes stack; `PostgresMigration` exposes `controlAdapter` | typecheck + unit | M3 | Existing tests adapted; new unit asserts ctor accepts stack. |
| `runMigration` exported from `@prisma-next/cli/migration-runner` | typecheck + import-resolution | M3 | `import { runMigration } from '@prisma-next/cli/migration-runner'` typechecks and resolves. |
| `runMigration` reuses `loadConfig` | code review | M3 | Same import path as CLI. |
| `dataTransform` takes adapter as 4th arg | typecheck + unit | M3 | New unit using fake adapter. |
| `PostgresMigration.dataTransform` instance method exists | typecheck | M3 | TS compile + example migration files use it. |
| `data-transform.ts` no longer imports `createPostgresAdapter`/`lowerSqlPlan`; no module singleton | grep + code review | M3 | grep checks above; manual diff for singleton removal. |
| All `migration.ts` files use `this.dataTransform` and `runMigration` | grep check | M3 | `rg "Migration\\.run\\(" examples/ tests/` empty; `rg "^dataTransform\\(" examples/ tests/` empty. |
| CLI scaffold emits new shapes | manual run + e2e | M3 | Generate a fresh migration via CLI; inspect output. |
| `runMigration` resolves up-tree config and instantiates with stack | unit + e2e | M3 | Unit covers happy path with stub config; existing e2e exercises the real walk-up. |
| Target-mismatch diagnostic | unit | M3 | New unit covers `PN-MIG-3NNN`. |
| Config-not-found diagnostic | unit | M3 | New unit covers no-config-up-tree case. |
| Each new diagnostic has dedicated unit test | unit | M3 | Per above two rows. |
| Example migrations produce byte-identical `ops.json` | manual diff after rerun + e2e | M5 | Existing committed `ops.json` is the regression anchor. |
| Existing data-transform e2e tests pass unchanged | e2e | M5 | `pnpm -F target-postgres test` (or repo-wide). |
| `dataTransform` unit test uses fake adapter | unit | M3 | Above. |

## Open Items

Carried forward from the spec; decide during execution unless flagged earlier.

1. **Subpath name for `runMigration`.** Default `@prisma-next/cli/migration-runner`; alternatives `runtime`, `run-migration`. Pick during M3.
2. **Where the shared SQL renderer lives.** Default new `sql-renderer.ts` module under `packages/3-targets/6-adapters/postgres/src/core/`. Pick during M2.
3. **Whether `runMigration` accepts `--config <path>`.** Suggest yes (CLI loader already supports it). Confirm during M3.
4. **Runtime-stack type for `RuntimeAdapterDescriptor.create(stack)`.** Framework-components doesn't export a "RuntimeStack" today the way it does `ControlStack`; the SQL-specific `SqlExecutionStackWithDriver` exists in `sql-context.ts`. Decide during M1 whether to introduce a generic runtime-stack interface in framework-components, or keep the family-specific type.
5. **Where helper functions (`serializeMigration`, `buildAttestedManifest`, etc.) live after the `Migration.run` removal.** Default: keep them as exported utilities in `@prisma-next/migration-tools`; `runMigration` imports them. Confirm during M3.
6. **ADR worth writing?** Default no; confirm at close-out.

## Sequencing Notes

- M1 → M2 → M3 → M4 → M5 in order. M1 has no behavioral effect; M2 adds a method but doesn't change behavior; M3 is the substantive change; M4 is cleanup gated on M3; M5 is verification + teardown.
- M3 must be a single PR (or atomic merge train) because `Migration.run` removal and `runMigration` introduction must land together with all migrated call sites.
- M1 and M2 can overlap in execution if helpful, but M2 depends on the `lower()` interface change being settled first.
