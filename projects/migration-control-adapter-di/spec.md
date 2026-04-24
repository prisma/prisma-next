# Migration control-adapter DI + `Migration` base split

## Summary

Inject the control adapter into Postgres class-flow migrations instead of constructing it as a module-level singleton inside `@prisma-next/target-postgres`'s `dataTransform` factory. Split the migration entrypoint orchestrator (`Migration.run`) out of the abstract `Migration` base class and into `@prisma-next/cli` so the base class becomes pure authoring data with no I/O dependency. Give the SQL control adapter a `lower()` method so emit-time SQL is rendered through the same adapter the runtime uses, removing the `@prisma-next/sql-runtime` cross-plane dependency from `@prisma-next/target-postgres`. Adapter descriptor `create()` signatures evolve to take the assembled stack, mirroring the existing `ControlFamilyDescriptor.create(stack)` pattern.

## Description

### What's broken today

`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` constructs a runtime adapter at module scope and uses it to lower `SqlQueryPlan → {sql, params}` at `migration.ts`-execution time:

```ts
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { lowerSqlPlan } from '@prisma-next/sql-runtime';

let adapterSingleton: ReturnType<typeof createPostgresAdapter> | null = null;
function getAdapter() {
  if (adapterSingleton === null) {
    adapterSingleton = createPostgresAdapter();
  }
  return adapterSingleton;
}

export function dataTransform(contract, name, options) {
  const adapter = getAdapter();
  // ... lowerSqlPlan(adapter, contract, plan) ...
}
```

This violates three things at once:

1. **Plane**: `@prisma-next/sql-runtime` is registered as runtime plane (see `architecture.config.json`). A target package's shared-plane code reaching into runtime is a layer-crossing import. The dep-cruiser rule isn't currently firing because target-postgres's `src/core/**` isn't explicitly registered, but the intent of the layout is shared.

2. **Abstraction**: the factory uses a *runtime* adapter to do *control*-plane lowering. The right abstraction is the `SqlControlAdapter`, which today doesn't have `lower()` on it. The fix is to add `lower()` to the control adapter, not to invent a separate "lowerer".

3. **Configuration**: the singleton constructs `createPostgresAdapter()` with no options, ignoring whatever the user declared in `prisma-next.config.ts`. Today this happens to be benign because `lower()` reads codec metadata only off the AST's `ParamRef.codecId` and a hardcoded cast switch (`getCodecParamCast` in `packages/3-targets/6-adapters/postgres/src/core/adapter.ts:39`). But it's a latent correctness hazard the moment any extension-aware codec metadata is needed at lower-time.

There's also a packaging artefact: `@prisma-next/adapter-postgres` is a `devDependency` of `@prisma-next/target-postgres` (`packages/3-targets/3-targets/postgres/package.json:36`) even though `data-transform.ts` imports from it at runtime. Removing the import closes this in passing.

### What the adapter actually depends on (post-DI)

I traced what `lower()` reads at render time. The runtime adapter's `lower()` method uses only:

- The input AST (which already carries codec IDs on each `ParamRef`).
- A hardcoded codec→cast switch for three known codec IDs (`pg/vector@1`, `pg/json@1`, `pg/jsonb@1`) — see `packages/3-targets/6-adapters/postgres/src/core/adapter.ts:37-50`.

The adapter's own `codecRegistry` field is exposed via `profile.codecs()` for runtime value encoding/decoding, but is never consulted during `lower()`. So today, lowering is stateless w.r.t. extensions: control and runtime adapters render identically given the same input AST.

The takeaway is that DI of the adapter is currently a **plumbing fix**, not a behavior change. The pgvector hardcoding is a separate sin (out of scope; tracked in a follow-up ticket — see [References](#references)) and the cleanup will remove the hardcoded switch entirely once the cast metadata moves onto codec descriptors.

### What needs to change

**1. Control adapter gains `lower()` and a stack-aware constructor.**

`SqlControlAdapter<TTarget>` grows a `lower(ast, ctx)` method matching the existing `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>` shape. The Postgres control adapter implements it by delegating to the same SQL renderer the runtime adapter uses (extracting the renderer to a shared module in `packages/3-targets/6-adapters/postgres/src/core/**` if needed, since both `exports/control.ts` and `exports/runtime.ts` already share that directory).

`SqlControlAdapterDescriptor.create()` and `RuntimeAdapterDescriptor.create()` evolve from no-args to taking the assembled stack, mirroring the existing `ControlFamilyDescriptor.create(stack: ControlStack<F, T>)` (`packages/1-framework/1-core/framework-components/src/control-descriptors.ts:26`). This keeps the framework's "create takes the stack" pattern consistent across descriptor kinds and gives adapters access to whatever they need from the stack (today: nothing; tomorrow: codec lookup for cast resolution, profile id from config, etc.).

**2. Drop `Migration.run` from the base class.**

The static `Migration.run(importMetaUrl, MigrationClass)` in `packages/1-framework/3-tooling/migration/src/migration-base.ts:83-114` is removed. It's replaced by a free-standing `runMigration(importMetaUrl, MigrationClass)` function that lives in `@prisma-next/cli`.

The base `Migration` class stays in `@prisma-next/migration-tools` (no new package). Once `Migration.run` is removed, the base class no longer drives I/O; the package's mix of "abstract class + manifest/attestation tooling" becomes acceptable. A future refactor might still relocate the base class to a more clearly layered home, but that's out of scope here.

**3. `runMigration` lives in `@prisma-next/cli`.**

`@prisma-next/cli` already depends on `@prisma-next/migration-tools` and already owns `loadConfig` (`packages/1-framework/3-tooling/cli/src/config-loader.ts`). Putting the orchestrator there means it can call `loadConfig`, build the control stack via `createControlStack`, instantiate the migration with the stack, and serialize to disk — all without introducing a new dependency edge or duplicating the c12 wrapper.

A new subpath export, e.g. `@prisma-next/cli/migration-runner`, provides `runMigration` to user migration files. Migration scaffolds switch from `Migration.run(import.meta.url, M)` to `runMigration(import.meta.url, M)`.

**4. Migration constructor takes the full `ControlStack`.**

The `Migration` base class gains a constructor that accepts a `ControlStack<F, T>` and stores it. Subclasses (`SqlMigration`, `PostgresMigration`) inherit this. The stack is the same shape `ControlFamilyDescriptor.create` already takes, keeping the framework consistent. Storing the full stack rather than just the adapter leaves room for future migration-time needs (target-specific helpers, extension-pack-contributed metadata) without re-plumbing the constructor.

The Postgres path materializes the adapter once via `this.controlAdapter = stack.adapter.create(stack)` and stores both. `runMigration` does not pre-create the adapter; the migration class owns adapter materialization, which keeps the orchestrator generic.

**5. `dataTransform` becomes a flat factory taking the adapter as a parameter.**

The free `dataTransform(contract, name, options)` factory becomes `dataTransform(contract, name, options, adapter)`. The factory stays a flat function: it lowers immediately via `adapter.lower(...)` and returns the same JSON-shaped op `{ kind, sql, params, check, run }` as today. The module-level `adapterSingleton` and `getAdapter()` helper are deleted, along with imports of `createPostgresAdapter` and `lowerSqlPlan`.

A convenience instance method on `PostgresMigration` provides the adapter from the stored stack:

```ts
abstract class PostgresMigration extends SqlMigration<PostgresPlanTargetDetails> {
  readonly targetId = 'postgres' as const;

  protected dataTransform(contract, name, options) {
    return dataTransform(contract, name, options, this.controlAdapter);
  }
}
```

User migration files write `this.dataTransform(contract, name, opts)` from inside `get operations()`. The free factory remains usable standalone (tests, ad-hoc tooling, non-class contexts).

**6. Drop the runtime-plane dependency from `@prisma-next/target-postgres`.**

Once `data-transform.ts` calls `adapter.lower()` on an injected adapter rather than `lowerSqlPlan(createPostgresAdapter(), ...)`, the package no longer needs `@prisma-next/sql-runtime` or `@prisma-next/adapter-postgres`. Both come out of `package.json` (one from `dependencies`, the other from `devDependencies`).

### What changes for users

Each existing `migration.ts` file gets two small edits:

```diff
-import { dataTransform, Migration, setNotNull } from '@prisma-next/target-postgres/migration';
+import { Migration, setNotNull } from '@prisma-next/target-postgres/migration';
+import { runMigration } from '@prisma-next/cli/migration-runner';

 export default class M extends Migration {
   override get operations() {
     return [
-      dataTransform(endContract, 'name', { check, run }),
+      this.dataTransform(endContract, 'name', { check, run }),
       setNotNull('public', 'user', 'displayName'),
     ];
   }
 }

-Migration.run(import.meta.url, M);
+runMigration(import.meta.url, M);
```

Three example migrations exist under `examples/prisma-next-demo/migrations/`; they all flip in the same way. The CLI's planner/scaffold templates emit the new shapes going forward.

### Why this shape

- **Constructor injection over module-scoped state.** The instance has its stack from birth; no "before reading operations, someone must call X". Test isolation is trivial (pass a fake stack). Concurrent migrations in one process work without coordination — not a current need, but nothing breaks if it arrives.
- **Stack-shaped descriptor `create()` is the existing framework pattern.** `ControlFamilyDescriptor.create(stack)` already does this; descriptors-take-stack is the consistent shape, not a new convention.
- **Runner in `@prisma-next/cli` keeps layering clean.** The CLI is the only place that legitimately needs config loading + stack assembly + ops serialization in one function. Migration-tools stays focused on on-disk persistence; the base class stays a pure abstraction.
- **Flat factory + instance-method wrapper preserves both worlds.** The factory has no DI magic; tests and standalone tools use it directly. The class hides the adapter parameter as ergonomics; user migration files don't carry it.

### Not in scope

- **Fix for the pgvector codec-cast hardcoding** (`getCodecParamCast` in `packages/3-targets/6-adapters/postgres/src/core/adapter.ts:39-50`). Tracked separately — see [References](#references). The DI work is independent of it; the lowered SQL is byte-identical before and after this PR for the same input AST + contract.
- **The `db` typed-builder type-level redeclaration in `migration.ts`.** Same flavour as the TS-contract-authoring surface's stack-redeclaration problem; orthogonal to control-adapter DI. The `dataTransform` / lowerer / adapter machinery itself needs no type-level stack info.
- **Applying the same DI pattern to MySQL / SQLite / Mongo targets.** Mongo doesn't have the hard-coded-runtime-adapter sin; SQLite's equivalent (if present) can follow the same shape later.
- **Promoting the `Migration` base class to a different layer / new package.** Considered (`framework-components` was on the table); the current location is acceptable once `run` is removed. Revisit later if the package boundary becomes painful.
- **Config-digest stamping on `migration.json`** for detecting authored-vs-current stack drift. Plausible follow-up; not needed for this refactor.
- **CLI apply / self-execution paths for migration files.** The CLI loads migration classes by import; it does not execute migration files as scripts. `runMigration` is the entrypoint guard for the script-execution path only.

## Requirements

### Functional Requirements

**Control adapter**

- `SqlControlAdapter<TTarget>` declares a `lower(ast, ctx)` method matching the existing `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>` shape.
- `SqlControlAdapterDescriptor<TTarget>.create()` accepts a `ControlStack<'sql', TTarget>` argument, matching the existing `ControlFamilyDescriptor.create(stack)` pattern. Same change applies to the runtime adapter descriptor (see Plane hygiene below for the runtime side).
- `PostgresControlAdapter` implements `lower()` by delegating to the same SQL renderer used by the runtime adapter. There is one source of truth for SQL rendering shared between control and runtime; no duplication.
- For the same input AST + contract, `PostgresControlAdapter.lower()` and the runtime `PostgresAdapterImpl.lower()` produce byte-identical `{ sql, params }`.

**Migration base + runner split**

- `Migration.run` static method is removed from `packages/1-framework/3-tooling/migration/src/migration-base.ts`.
- The `Migration` abstract class remains in `@prisma-next/migration-tools/migration`. It gains a constructor that accepts and stores a `ControlStack<F, T>`.
- `SqlMigration` and `PostgresMigration` subclasses inherit the stack-accepting constructor. `PostgresMigration` materializes the control adapter once (`this.controlAdapter = stack.adapter.create(stack)`) and stores it.
- `runMigration(importMetaUrl, MigrationClass)` is exported from a new subpath of `@prisma-next/cli` (e.g. `@prisma-next/cli/migration-runner`).
- `runMigration` is responsible for: entrypoint detection (same `realpathSync` guard as today), arg parsing (`--dry-run`, `--help`), config discovery via the existing `loadConfig`, control-stack assembly via `createControlStack`, target-mismatch validation, instantiation `new MigrationClass(stack)`, and delegating to the existing serialization path (`ops.json` + `migration.json` writers in `migration-base.ts`).

**Config-aware orchestration**

- `runMigration` walks up from `dirname(fileURLToPath(importMetaUrl))` via `loadConfig` (the existing CLI loader, same `name: 'prisma-next'` semantics).
- When no config is found, `runMigration` emits a diagnostic explaining the resolution failure and points users at the config file requirement.
- When `config.target.targetId !== instance.targetId`, `runMigration` emits a target-mismatch diagnostic with both ids.

**`dataTransform` / call sites**

- `dataTransform(contract, name, options, adapter)` is a flat free function. It calls `adapter.lower()` inline and returns the existing `DataTransformOperation` shape unchanged. No module-scoped state.
- `PostgresMigration` exposes a `protected dataTransform(contract, name, options)` instance method that calls the free factory with `this.controlAdapter`.
- All existing `migration.ts` files in the repo (examples + integration tests) are migrated to use `this.dataTransform` and `runMigration`.
- The CLI's migration-scaffold/template emits the new shape (`this.dataTransform`, `runMigration(import.meta.url, M)`).

**Plane hygiene**

- `@prisma-next/target-postgres`'s `package.json` lists neither `@prisma-next/adapter-postgres` nor `@prisma-next/sql-runtime` in `dependencies` or `devDependencies` after the refactor. (Both go away — adapter is no longer constructed in shared-plane code; sql-runtime is no longer imported.)
- No file under `packages/3-targets/3-targets/postgres/src/core/**` imports from `@prisma-next/sql-runtime` or `@prisma-next/adapter-postgres/adapter`.
- `pnpm lint:deps` passes repo-wide with no new plane-rule exceptions.

**Diagnostics**

- A new error code (allocated from the migration-plane range, e.g. `PN-MIG-3NNN`) covers the target-mismatch case. Message format: "migration is for target `<instance.targetId>` but config declares target `<config.target.targetId>`".
- The existing config-not-found error from `@prisma-next/cli`'s loader is reused. If its message wording assumes "you ran the CLI" rather than "you ran a migration script", add a brief contextual prefix; otherwise unchanged.
- The existing `PN-MIG-2005` storage-hash mismatch in `data-transform.ts` is unchanged.

### Non-Functional Requirements

- **Backwards compatibility (artifact format).** `ops.json` and `migration.json` shapes are unchanged. For the same input closures and the same effective adapter behavior, the lowered `{ sql, params }` payloads must be byte-identical before and after the refactor. (The example migrations under `examples/prisma-next-demo/migrations/**` are an existing regression anchor; existing e2e tests cover the round-trip.)
- **Test isolation.** Unit tests for `dataTransform` exercise a fake control adapter. No real Postgres lowering needed.
- **No new plane exceptions.** `architecture.config.json` and `dep-cruiser` config are not relaxed.
- **Migration source files own their dependencies.** The user migration script imports `runMigration` from `@prisma-next/cli/migration-runner`; pulling in CLI machinery at script run time is acceptable since the script's role is exactly "run a migration."

### Non-goals

- pgvector codec-cast hardcoding (separate ticket).
- Regression-anchor `.ops.json` snapshots per example migration; existing integration tests are sufficient.
- Singleton-vs-per-run adapter lifetime concerns. Migration scripts run in isolation.
- CLI self-execution / apply flow for migration files (CLI loads classes, doesn't exec scripts).
- Promoting the `Migration` base class out of `@prisma-next/migration-tools`.
- Same-pattern DI for MySQL / SQLite / Mongo targets.
- Migrating off `c12` or changing config search semantics.

## Acceptance Criteria

Grouped by theme; each item is independently verifiable.

### Plane hygiene

- [ ] `rg "from '@prisma-next/sql-runtime'" packages/3-targets/3-targets/postgres/src/core/` returns no matches.
- [ ] `rg "from '@prisma-next/adapter-postgres" packages/3-targets/3-targets/postgres/src/core/` returns no matches.
- [ ] `rg "createPostgresAdapter\\(" packages/3-targets/3-targets/postgres/src/` returns no matches.
- [ ] `@prisma-next/target-postgres`'s `package.json` lists neither `@prisma-next/adapter-postgres` nor `@prisma-next/sql-runtime` in `dependencies` or `devDependencies`.
- [ ] `pnpm lint:deps` passes repo-wide with no new plane-rule exceptions.

### Control adapter

- [ ] `SqlControlAdapter<TTarget>` declares `lower(ast, ctx)` and is structurally assignable to `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>` for lowering calls.
- [ ] `SqlControlAdapterDescriptor.create(stack)` and `RuntimeAdapterDescriptor.create(stack)` (or its SQL specialization) take the assembled stack, mirroring `ControlFamilyDescriptor.create(stack)`.
- [ ] `PostgresControlAdapter` and the runtime Postgres adapter delegate to a single shared SQL renderer (a single source of truth in `packages/3-targets/6-adapters/postgres/src/core/**`).
- [ ] A unit test confirms that `PostgresControlAdapter.lower(ast, { contract })` and `PostgresAdapterImpl.lower(ast, { contract })` produce byte-identical `{ sql, params }` for a representative AST matrix (select / insert / update / delete, including JSON / JSONB / vector-cast `ParamRef`s).

### Migration base + runner split

- [ ] `Migration.run` is removed from `packages/1-framework/3-tooling/migration/src/migration-base.ts`.
- [ ] `Migration` (and `SqlMigration`, `PostgresMigration`) accept a `ControlStack` in their constructor and store it.
- [ ] `PostgresMigration` exposes `controlAdapter` (or equivalent accessor) materialized via `stack.adapter.create(stack)`.
- [ ] `runMigration(importMetaUrl, MigrationClass)` is exported from `@prisma-next/cli/migration-runner` (or chosen subpath) and produces the same on-disk artifacts (`ops.json`, `migration.json`) that `Migration.run` produced.
- [ ] `runMigration` reuses the existing `loadConfig` from `@prisma-next/cli` for config discovery — no duplication of the c12 wrapper.

### `dataTransform` and call sites

- [ ] `dataTransform(contract, name, options, adapter)` accepts the adapter as its fourth parameter.
- [ ] `PostgresMigration` exposes `protected dataTransform(contract, name, options)` that defers to the free factory with `this.controlAdapter`.
- [ ] `data-transform.ts` no longer imports `createPostgresAdapter` or `lowerSqlPlan`; the module-level `adapterSingleton` and `getAdapter()` are deleted.
- [ ] All existing `migration.ts` files in `examples/**` and `**/integration-tests/**` use `this.dataTransform` (where applicable) and `runMigration`.
- [ ] The CLI scaffold/template that emits new `migration.ts` files emits the new shapes.

### Config-aware orchestration

- [ ] When a `migration.ts` is invoked as a node entrypoint and a valid `prisma-next.config.ts` exists up-tree, `runMigration` resolves the config and instantiates the migration with a stack assembled from it.
- [ ] When `config.target.targetId !== instance.targetId`, `runMigration` exits with a target-mismatch diagnostic carrying both ids and a non-zero exit code.
- [ ] When no config is found, `runMigration` emits a diagnostic and exits non-zero.
- [ ] Each new diagnostic has a dedicated unit test.

### End-to-end behaviour

- [ ] Re-running the existing example migrations under `examples/prisma-next-demo/migrations/**` regenerates `ops.json` byte-identically to the committed version. (Each example migration file is updated to the new call shape; the generated artifact bytes do not change.)
- [ ] Existing data-transform e2e tests (`data-transform-*.e2e.test.ts`, `class-flow-round-trip.e2e.test.ts`) pass unchanged in semantics.
- [ ] A new unit test for `dataTransform` exercises a fake control adapter, demonstrating injection works without spinning up real Postgres.

## Other Considerations

### Security

No new surface. Config loading reuses the existing CLI loader and validator. No additional filesystem traversal.

### Cost

No operational cost impact; code-organisation refactor.

### Observability

`runMigration` should log the resolved config file path and the effective target id at verbose level (stderr) when constructing the stack. Aids debugging "my migration's `ops.json` changed after a config edit." Low priority; implementation discretion.

### Data Protection

N/A — local build-time behaviour only.

### Analytics

N/A.

## References

**Files central to the refactor**

- `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` — primary target of the fix. Drops singleton + sql-runtime import; gains adapter parameter.
- `packages/1-framework/3-tooling/migration/src/migration-base.ts` — `Migration.run` is removed; constructor gains stack parameter.
- `packages/2-sql/9-family/src/core/sql-migration.ts` and `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` — subclasses inherit constructor; `PostgresMigration` adds `dataTransform` instance method and exposes `controlAdapter`.
- `packages/2-sql/9-family/src/core/control-adapter.ts` — `SqlControlAdapter` interface gains `lower()`; `SqlControlAdapterDescriptor.create(stack)` signature change.
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts`, `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts` — descriptors updated for new `create(stack)` signature.
- `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`, `packages/3-targets/6-adapters/postgres/src/core/adapter.ts` — control adapter implements `lower()` by delegating to a shared renderer; rendering extracted to a shared module.
- `packages/1-framework/1-core/framework-components/src/control-descriptors.ts` — `ControlAdapterDescriptor.create(stack)` interface change.
- `packages/1-framework/1-core/framework-components/src/execution-descriptors.ts` — `RuntimeAdapterDescriptor.create(stack)` interface change.
- `packages/1-framework/3-tooling/cli/src/config-loader.ts` — reused as-is by `runMigration`.
- `packages/1-framework/3-tooling/cli/` — gains `runMigration` exported from a new subpath (e.g. `migration-runner`).
- `packages/3-targets/3-targets/postgres/package.json` — drops `@prisma-next/sql-runtime` and `@prisma-next/adapter-postgres`.

**Examples & tests touched**

- `examples/prisma-next-demo/migrations/**/migration.ts` — three files; each gets the two-line `dataTransform → this.dataTransform` and `Migration.run → runMigration` swap.
- Any `migration.ts` under `**/integration-tests/**` — same swap.

**Architecture / repo configs**

- `architecture.config.json` and `dependency-cruiser.config.mjs` — confirm no new plane-rule exceptions are introduced.

**Follow-up tickets**

- "Move SQL param-cast metadata onto codec descriptors" — separately tracked. Wipes out `getCodecParamCast` switch in `packages/3-targets/6-adapters/postgres/src/core/adapter.ts:37-58`. Out of scope here; this PR leaves the switch untouched.

## Open Questions

1. **Subpath name for `runMigration` in `@prisma-next/cli`.** Default: `@prisma-next/cli/migration-runner`. Alternatives considered: `@prisma-next/cli/runtime`, `@prisma-next/cli/run-migration`. The verbose form is the clearest. Confirm or override.
2. **Where the shared SQL renderer lives.** Current `lower()` body is inline in `PostgresAdapterImpl` (`packages/3-targets/6-adapters/postgres/src/core/adapter.ts:124-163`). Extracting it as a free function (e.g. `renderLoweredSql(ast, ctx) → { sql, params }`) in a new module under `packages/3-targets/6-adapters/postgres/src/core/` is the obvious shape; both adapter classes call it. No real alternatives, just confirming the shape during execution.
3. **Should `runMigration` accept a `--config <path>` override?** The current `Migration.run` doesn't. The existing CLI's `loadConfig` accepts an optional path. Suggest: yes, accept it via `--config` arg, since the CLI already supports it and migration-script runs benefit from the same flexibility (e.g. switching configs per environment in CI).
