# Migration control-adapter DI + `Migration` base split

## Summary

Fix the cross-plane coupling in Postgres class-flow authoring (`dataTransform`) and descriptor-flow resolution (`operation-resolver.ts`), both of which hard-code `createPostgresAdapter()` inside `src/core/**` of `@prisma-next/target-postgres` — bypassing the user's config-declared stack and dragging runtime-plane code into shared-plane files. Introduce `lower()` as a first-class method on the control adapter; extract the abstract `Migration` base class into a shared-plane home and leave the `run()` orchestrator in migration-plane tooling; have the orchestrator discover `prisma-next.config.ts` from the migration file's directory, build the control adapter from `config.adapter` + `config.extensionPacks`, and constructor-inject it into the migration instance. Provide an escape hatch for users to construct the migration themselves and bypass auto-discovery entirely.

## Description

### What's broken today

Two files in `packages/3-targets/3-targets/postgres/src/core/` each import `createPostgresAdapter` and `lowerSqlPlan`, hold an adapter singleton at module scope, and lower `SqlQueryPlan → {sql, params}` at `migration.ts`-execution time:

- `migrations/operations/data-transform.ts` — the class-flow `dataTransform()` factory.
- `migrations/operation-resolver.ts` — the descriptor-flow resolver.

Both live in what is intended to be shared-plane code (mirrors sqlite's `src/core/**` shared registration in `architecture.config.json`). Both violate three things simultaneously:

1. **Plane**: `@prisma-next/sql-runtime` is registered as runtime plane (`architecture.config.json:117-122`). Shared → runtime is forbidden. The dep-cruiser rule isn't currently firing on these imports because target-postgres's `src/core/**` isn't explicitly registered — only its `exports/{control,runtime}.ts` are — but the intent is clearly shared.

2. **Abstraction**: they reach for a *runtime* adapter to do *control*-plane lowering. The control adapter (`SqlControlAdapter<TTarget>` in `@prisma-next/family-sql`) is the right abstraction for producing control-plane SQL statements; it just doesn't have `lower()` on it today. The fix is not to invent a separate "lowerer" abstraction — it's to put `lower()` on the adapter interface where it belongs.

3. **Configuration**: the singleton is constructed with default options, ignoring the `extensionPacks`, codec registrations, and adapter options the user declared in `prisma-next.config.ts`. Emit-time SQL can silently diverge from runtime-time SQL for the same query — especially for codec-typed parameters (pgvector `$1::vector`, JSON/JSONB casts, any user-registered codec). This is a correctness hazard, not just a style issue.

There's also a packaging bug: `@prisma-next/adapter-postgres` is a **devDependency** of `@prisma-next/target-postgres` (`package.json:36`) even though `src/core/.../data-transform.ts` imports from it at runtime. Fixes to the plane problem remove the import entirely, closing this in passing.

### What the adapter is and isn't

The adapter is *not* contract-coupled. `lowerSqlPlan(adapter, contract, plan)` passes the contract through to `adapter.lower(ast, { contract, params })` as per-call `LowererContext`. One adapter instance services any number of contracts; `data-transform.ts` currently takes a `contract` argument for two reasons — the storage-hash mismatch assertion (`PN-MIG-2005`) and forwarding into the lowerer — neither of which implies the adapter must be contract-scoped. The apparent coupling is an artefact of the factory's signature, not a structural requirement.

For migrations that visit multiple intermediate contracts in one file, a single stack-configured control adapter services all of them.

### What needs to change

- **Control adapter gains `lower()`**: `SqlControlAdapter<TTarget>` grows a `lower(ast, ctx)` method matching the existing `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>` shape. The rendering implementation is shared with the runtime adapter via a common module in postgres-adapter's `src/core/**` (already shared plane), so both `exports/control.ts` and `exports/runtime.ts` construct adapters that lower identically for the same input.
- **`Migration` abstract class splits from `Migration.run()`**: the authoring contract (`targetId`, `operations`, `describe`, `origin`, `destination`, constructor taking injected stack) moves to a shared-plane home. The orchestrator (`run()`, c12-based config discovery, target-mismatch validation, ops serialization, file I/O) stays in migration-plane tooling. This incidentally resolves a pre-existing plane violation: `packages/2-sql/9-family/src/core/sql-migration.ts:1` currently imports `Migration` from migration-plane `@prisma-next/migration-tools`, a shared→migration edge that only works today because dep-cruiser isn't catching it.
- **Config-aware orchestrator**: the relocated `run()` walks up from the migration file's directory via c12 to find `prisma-next.config.ts`, validates it, calls `config.adapter.create(…)` with options resolved from `config.extensionPacks`, verifies `config.target.targetId === instance.targetId`, and constructor-injects a minimal stack object into the migration instance.
- **Constructor injection, no module-level DI**: `PostgresMigration` (and its parents) take `{ controlAdapter, … }` in the constructor. `dataTransform` becomes a method on the migration instance (`this.dataTransform(contract, name, options)`), or receives the adapter through another in-instance channel. `operation-resolver.ts` receives the adapter through its `OperationResolverContext`. Neither file imports `createPostgresAdapter` any longer.
- **Escape hatch for stack drift**: `Migration.run(importMetaUrl, ClassOrInstance)` accepts either a class constructor (default: auto-discover + inject) or a pre-instantiated migration (user did their own DI; skip discovery). This is the release valve for old migrations whose authoring-time stack has drifted from current `prisma-next.config.ts` — common scenario: extensions installed since the migration was written, or an adapter bump that rendered SQL differently.

### Why this shape

Constructor injection (not a module-scoped setter, not AsyncLocalStorage) gives us:

- **No ordering contracts**: the instance has its stack from birth; no "before reading operations, someone must call X".
- **Test isolation**: unit tests inject a fake adapter trivially.
- **Concurrent migrations in one process**: not a current use case, but nothing breaks if it arrives.
- **Target-level DI as a byproduct**: the same AST could be lowered by any target's control adapter if you injected it — incidental benefit for cross-target testing and future multi-target scenarios.

Loading config via c12 walk-up from `dirname(import.meta.url)` gives the 99% case "it just works" ergonomics (same pattern the CLI already uses). The escape hatch gives the 1% case a clean DI path without adding a new config-override concept — users just construct the instance themselves.

### Scope non-extension: the `db` typed-builder problem

User-authored `migration.ts` files currently re-import the full target + extension stack at *type* level to get a typed `db = postgres<Contract>({ … })` query-builder handle:

```ts
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import postgres from '@prisma-next/postgres/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { dataTransform, Migration, setNotNull } from '@prisma-next/target-postgres/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = validateContract<Contract>(endContractJson, emptyCodecLookup);
const db = postgres<Contract>({ contractJson: endContractJson, extensions: [pgvector] });
```

This is the same type-level stack-redeclaration problem the TS-contract-authoring surface has. It is **not** in scope for this spec. The `dataTransform` / lowerer / adapter machinery itself needs no type-level stack info; it consumes structural `SqlQueryPlan`s. The only type-level dependency is on the file-relative generated `./end-contract`. The `db` handle's typing is a separate conversation with a different solution shape.

## Requirements

### Functional Requirements

**Plane hygiene**
- `target-postgres`'s `src/core/**` must not import from `@prisma-next/sql-runtime` or `@prisma-next/adapter-postgres/adapter`. No shared → runtime edges.
- `@prisma-next/adapter-postgres` and `@prisma-next/sql-runtime` are removed from `@prisma-next/target-postgres`'s `dependencies` and `devDependencies`.
- Registering target-postgres `src/core/**` explicitly as shared plane in `architecture.config.json` (matching sqlite's registration) so dep-cruiser actually enforces this.

**Control adapter lowering**
- `SqlControlAdapter<TTarget>` in `@prisma-next/family-sql` grows a `lower(ast, ctx)` method structurally compatible with `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>`.
- `PostgresControlAdapter` accepts the same options shape as the runtime adapter (`PostgresAdapterOptions`: extensions, codec registrations, profile id) and lowers identically for the same input.
- The rendering implementation is shared between control and runtime adapters via a common module in postgres-adapter's `src/core/**`. No duplication of SQL rendering logic.

**Migration base split**
- Abstract `Migration<TOperation>` class (authoring surface only: `targetId`, `operations`, `describe`, `origin`, `destination`), `MigrationMeta`, and `MigrationMetaSchema` live in a shared-plane package. That package imports nothing from `node:fs`, `node:url`, `pathe`, `c12`, or `prettier`.
- The abstract class exposes a constructor taking a minimal stack interface (at minimum: `{ controlAdapter: SqlControlAdapter<TTarget> }`; extensible).
- `SqlMigration<TDetails>` (`packages/2-sql/9-family/src/core/sql-migration.ts`) and `PostgresMigration` (`packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts`) compile in their current shared-plane locations without plane exceptions, importing the abstract class from its new shared-plane home.
- The `run()` orchestrator (c12 config discovery, argv parsing, target-mismatch validation, ops/manifest serialization, file I/O) lives in a migration-plane package. Users' `migration.ts` files continue to import `Migration` (now a re-export) from `@prisma-next/target-postgres/migration`; the migration-plane re-export wraps the shared-plane abstract class plus the orchestrator's `run()` static method.

**Config discovery + DI**
- When `run()` is invoked with a class constructor and the migration file is the direct node entrypoint, it walks up from `dirname(fileURLToPath(importMetaUrl))` using c12 (same `name: 'prisma-next'` as the CLI) to locate `prisma-next.config.ts`.
- Config is validated via `@prisma-next/config`'s validator (the same one `@prisma-next/cli`'s loader uses).
- Control adapter is constructed via `config.adapter.create(resolveOptions(config.extensionPacks))`.
- `instance = new Class({ controlAdapter, … })` is then passed to the existing ops-serialization path.
- `config.target.targetId` is compared against `instance.targetId`; a mismatch is a loud error with both ids in the diagnostic.

**Escape hatch**
- `Migration.run(importMetaUrl, MigrationClassOrInstance)` accepts either:
  - A class constructor → auto-discover config, construct with the resolved stack.
  - A pre-constructed `Migration` instance → skip discovery entirely, use the instance as-is.
- The class-vs-instance discriminator is simple (`typeof arg === 'function'` vs `arg instanceof Migration`).
- The instance path performs no validation against any config — the user has opted into full DI.

**DataTransform / operation-resolver consume injected adapter**
- `dataTransform` no longer imports `createPostgresAdapter` or `lowerSqlPlan`. Access pattern: method on the migration instance (`this.dataTransform(contract, name, options)`) or equivalent in-instance channel; the user-facing call site inside `get operations()` reads naturally under the chosen shape.
- The `contract` argument is retained: it's used for the `PN-MIG-2005` storage-hash assertion and for `LowererContext` forwarding. It is not re-interpreted as adapter coupling.
- `operation-resolver.ts` receives the adapter through `OperationResolverContext`. The module-scoped `const postgresAdapter = createPostgresAdapter();` at the top of the file is deleted.

**Diagnostics**
- New error code for target mismatch between config and migration (e.g. `PN-MIG-3NNN`; allocate from the migration-plane range). Message format: "migration is for target `<instance.targetId>` but config declares target `<config.target.targetId>`".
- New error code (or extension of existing `errorConfigFileNotFound`) for the "no config found and no pre-instantiated migration provided" case; the message points the user at the escape hatch.
- Existing `PN-MIG-2005` contract-mismatch is unchanged.

### Non-Functional Requirements

- **Backwards compatibility**: existing `migration.ts` files continue to run. On-disk `ops.json` / `migration.json` formats are unchanged. Given the same input closures and the same effective adapter options, bytes in the lowered `{sql, params}` payloads must be identical before and after this refactor (the sample migrations under `examples/prisma-next-demo/migrations/**` are the regression anchor).
- **`pnpm lint:deps` passes**: no new plane-rule exceptions introduced.
- **Package footprint**: the shared-plane `Migration`-base package has no Node built-ins and no tooling deps.
- **Test isolation**: unit tests for `dataTransform` and `operation-resolver` can exercise closures with a fake/spy control adapter; no real Postgres lowering needed.
- **c12 configuration**: the orchestrator uses the same `name: 'prisma-next'` and discovery semantics as the CLI's loader. No new search-path rules.

### Non-goals

- **The `db` typed-builder re-import problem in `migration.ts`**. Same flavour of problem as the TS-contract-authoring surface; out of scope here.
- **Config-digest stamping on `migration.json`** for detecting authored-vs-current stack drift. Plausible follow-up; the escape hatch is sufficient for Phase 1.
- **Applying the same DI pattern to sqlite / mysql / mongo targets**. Mongo is already class-flow and doesn't have the hard-coded-runtime-adapter sin; sqlite's equivalent (if any) can follow the same shape later.
- **Consolidating descriptor-flow and class-flow into a single pipeline**. That's PR 3 of `postgres-class-flow-migrations`; this spec only fixes the shared adapter-injection plumbing both pipelines need.
- **Removing the TypeScript contract authoring surface's type-level stack redeclaration.** Separate problem, separate spec.

## Acceptance Criteria

Grouped by theme; each item is independently verifiable.

### Plane hygiene

- [ ] `rg "from '@prisma-next/sql-runtime'" packages/3-targets/3-targets/postgres/src/core/` returns no matches.
- [ ] `rg "from '@prisma-next/adapter-postgres" packages/3-targets/3-targets/postgres/src/core/` returns no matches.
- [ ] `rg "createPostgresAdapter\\(" packages/3-targets/3-targets/postgres/src/` returns no matches (construction is owned by the orchestrator / adapter descriptor, not by target-postgres).
- [ ] `@prisma-next/target-postgres`'s `package.json` lists neither `@prisma-next/adapter-postgres` nor `@prisma-next/sql-runtime` in `dependencies` or `devDependencies`.
- [ ] `architecture.config.json` explicitly registers `packages/3-targets/3-targets/postgres/src/core/**` as shared plane.
- [ ] `pnpm lint:deps` passes repo-wide with no new plane-rule exceptions.

### Control adapter

- [ ] `SqlControlAdapter<TTarget>` declares `lower(ast, ctx)` and is structurally assignable to `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>` for lowering calls.
- [ ] `PostgresControlAdapter` accepts `PostgresAdapterOptions` in its constructor; configured identically to the runtime adapter, it produces byte-identical SQL + params for the same input AST + contract. Covered by a new shared unit test that runs both paths over a representative matrix (select / insert / update / delete, with at least one pgvector-typed column and one JSONB-typed column to exercise codec casts).
- [ ] A single rendering module under postgres-adapter's `src/core/**` is the sole source of truth for SQL rendering; both control and runtime adapter classes delegate to it.

### Migration base split

- [ ] The abstract `Migration` class (and `MigrationMeta` / `MigrationMetaSchema`) live in a shared-plane package with zero imports from `node:fs`, `node:url`, `pathe`, `c12`, or `prettier`.
- [ ] `@prisma-next/migration-tools`'s `migration-base.ts` re-exports the abstract class from the shared-plane package; the `run()` static method lives in the migration-plane entrypoint.
- [ ] `packages/2-sql/9-family/src/core/sql-migration.ts` compiles with its shared-plane registration, importing the abstract class from its new shared-plane home.
- [ ] `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` compiles likewise.
- [ ] No shared→migration or shared→runtime imports exist in any of the above files after the move.

### Config discovery + DI

- [ ] When a `migration.ts` is run directly as a node entrypoint and a valid `prisma-next.config.ts` exists up-tree, `run()` locates the config via c12 and invokes `new MigrationClass({ controlAdapter, … })`.
- [ ] When no config is found (walk-up hits the filesystem root), `run()` emits a diagnostic naming the escape hatch.
- [ ] When `config.target.targetId !== instance.targetId`, `run()` emits a target-mismatch diagnostic with both ids.
- [ ] When invoked with a pre-instantiated migration (`Migration.run(importMetaUrl, new M(customStack))`), `run()` does not attempt config discovery and uses the instance as-is.
- [ ] Target-mismatch and config-missing diagnostics each have a new error code and a dedicated unit test.

### DataTransform / operation-resolver

- [ ] `dataTransform` (class-flow) uses the migration instance's injected control adapter. No `createPostgresAdapter` call anywhere in the file.
- [ ] `operation-resolver.ts` (descriptor-flow) receives the adapter through `OperationResolverContext`. No module-scoped `postgresAdapter` constant.
- [ ] The `PN-MIG-2005` storage-hash-mismatch assertion is unchanged; its existing test still passes.

### End-to-end behaviour

- [ ] Running `node examples/prisma-next-demo/migrations/20260422T0748_migration/migration.ts` regenerates `ops.json` byte-identically to the committed version. Same check for the other two example migrations in that example.
- [ ] `data-transform-*.e2e.test.ts` and `class-flow-round-trip.e2e.test.ts` pass unchanged.
- [ ] Unit tests for `dataTransform` exercise a fake control adapter (demonstrating injection works).

## Other Considerations

### Security

No new surface. Config loading reuses the CLI's c12-based pattern and the same validator; no additional filesystem traversal beyond standard walk-up-to-root.

### Cost

No operational cost impact; code-organisation refactor.

### Observability

Orchestrator should log at verbose level (stderr) the resolved config file path and the effective adapter options when constructing the stack, to aid debugging of "my migration's `ops.json` changed after a config edit" issues. Low priority; implementation discretion.

### Data Protection

N/A — local build-time behaviour only.

### Analytics

N/A.

## References

- `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` — primary target of the fix.
- `packages/3-targets/3-targets/postgres/src/core/migrations/operation-resolver.ts` — sibling occurrence of the same pattern.
- `packages/1-framework/3-tooling/migration/src/migration-base.ts` — current home of `Migration` + `Migration.run()`; splits into two halves.
- `packages/2-sql/9-family/src/core/sql-migration.ts`, `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` — subclasses that need the relocated abstract class.
- `packages/2-sql/9-family/src/core/control-adapter.ts` — `SqlControlAdapter` interface that grows `lower()`.
- `packages/3-targets/6-adapters/postgres/src/core/adapter.ts` — runtime adapter today; rendering core factored out for shared use.
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts` — control adapter descriptor updated to construct a lowering-capable control adapter.
- `packages/1-framework/3-tooling/cli/src/config-loader.ts` — existing c12-based loader to reuse/extract.
- `packages/1-framework/1-core/config/src/config-types.ts` — `PrismaNextConfig` (`adapter`, `extensionPacks`) shape the orchestrator reads.
- `architecture.config.json` + `dependency-cruiser.config.mjs` — plane rules; confirm no new exceptions.
- `projects/postgres-class-flow-migrations/reviews/pr-2-flip/code-review.md` — PR round-trip context that surfaced the concern.
- `.cursor/rules/multi-plane-entrypoints.mdc` — pattern for the migration-tools package gaining shared- and migration-plane entrypoints.
- CodeRabbit review comment: "Keep runtime lowering out of src/core." Cited in the kickoff discussion.

## Open Questions

1. **Home for the shared abstract `Migration`**: new standalone package (e.g. `@prisma-next/migration-base` under `packages/1-framework/1-core/`) or slot into an existing shared-plane package (`framework-components` is the closest fit)? Default assumption: new package — the abstract class has a narrow, semver-critical surface and benefits from standalone versioning. Confirm or override.
2. **Stack-argument shape on the constructor**: `{ controlAdapter }`, `{ stack: { controlAdapter, … } }`, or `{ adapter }`? Default assumption: `{ controlAdapter }` at the top level, named explicitly — leaves room to add siblings (`driver`, future hooks) without overloading a generic name.
3. **`dataTransform` access shape**: method on `PostgresMigration` (`this.dataTransform(…)`) vs bound factory exposed via an instance property (`this.factories.dataTransform(…)`) vs free factory that's given the adapter through a constructor-bound closure in the base class. Default assumption: method on the class, most legible in `get operations()`. Happy to revisit if there's a DX preference for the free-factory form.
4. **Loader placement**: extract the c12-based loader from `@prisma-next/cli` into a shared-plane `@prisma-next/config-loader` (or extend the existing shared `@prisma-next/config` package) so both CLI and migration-orchestrator consume the same code, or let the orchestrator ship a minimal private copy? Default assumption: extract-and-share — two copies drift.
5. **Target-mismatch enforcement for the instance escape hatch**: when a user passes `new M(customStack)`, should `run()` still attempt any sanity-check (e.g. comparing against an available config if one is discoverable, warn only)? Default assumption: no — the user has opted into full DI and we trust them. A loud diagnostic in the auto-discovery path plus silence in the instance path is the cleanest contract.
6. **Regression anchoring for `ops.json`**: snapshot each currently-committed example migration's `ops.json` and re-run through the refactored pipeline as an explicit regression test, or lean on the existing e2e suite to catch divergence? Default assumption: add snapshots — cheap, precise, and they'd have caught any silent codec-rendering drift.
7. **Ordering vs existing Phase 3**: this work overlaps conceptually with the `postgres-class-flow-migrations` PR 3 cleanup (descriptor-flow collapse). Should it land before PR 3 (so PR 3 inherits a clean adapter-injection foundation), be folded into PR 3, or land independently on main? Default assumption: land before PR 3 as a narrow independent PR — reviewable in isolation and PR 3 benefits from not having to maintain the broken descriptor-flow adapter constant.
