# Postgres class-flow migrations

## Summary

This project moves Postgres migration authoring from today's descriptor-flow to class-flow — the same authoring model MongoDB landed in PR #349. The user-facing change is what a Postgres `migration.ts` looks like on disk and how the CLI produces it. The runner, the driver, the wire format of `ops.json`, and the attested `migration.json` are untouched.

The project also consolidates on a single data-safe Postgres planner. Today Postgres has two parallel planners (a walk-schema planner for `db update` and an issue-based planner for `migration plan`); at the end we have one, built around the issue-based architecture that produces `dataTransform` scaffolding stubs for schema changes that require user backfill.

## Grounding example

### Before — descriptor-flow

```typescript
import {
  createTable,
  addColumn,
  createIndex,
  dataTransform,
  TODO,
} from "@prisma-next/target-postgres/migration"

export default () => [
  createTable("orders"),
  addColumn("orders", "status", { nullable: true }),
  dataTransform("backfill-orders-status", { check: TODO, run: TODO }),
  createIndex("orders", ["status"]),
]
```

The CLI evaluates this module, passes the returned descriptor array to `resolveDescriptors(context)` to materialize `SqlMigrationPlanOperation[]`, and hashes the result into `ops.json`.

### After — class-flow

```typescript
#!/usr/bin/env -S node --experimental-strip-types
import { Migration } from "@prisma-next/family-sql/migration"
import {
  createTable,
  addColumn,
  createIndex,
  dataTransform,
  placeholder,
} from "@prisma-next/target-postgres/migration"
import contract from "./contract.json" with { type: "json" }
import { sql } from "@prisma-next/sql-builder/runtime"

const q = sql(contract)

export default class extends Migration {
  plan() {
    return [
      createTable("public", "orders", { /* materialized spec */ }),
      addColumn("public", "orders", "status", { nullable: true, /* materialized spec */ }),
      dataTransform(this, "backfill-orders-status", {
        check: async () => placeholder("describe safety invariant"),
        run: async () => placeholder("implement backfill"),
      }),
      createIndex("public", "orders", ["status"]),
    ]
  }
}

Migration.run(import.meta.url, (await import(import.meta.url)).default)
```

The file is directly runnable (`./migration.ts` produces `ops.json`), the factories are pure functions of fully-materialized literal arguments, and hand-authored `dataTransform` closures use a module-scoped query builder bound to the snapshotted contract.

Every user-visible change in this project is a consequence of moving from the first shape to the second, and the CLI workflows that produce and consume these files.

## Decision

We make three decisions that govern the rest of this spec:

1. **Class-flow is the sole authoring strategy for Postgres.** The descriptor IR (`OperationDescriptor`, `DataTransformDescriptor`, and associated types), the descriptor CLI branches, and the `migration emit` command are deleted. `Migration.run(import.meta.url, M)` is the only sanctioned emit driver.

2. **The issue-based diff architecture is preserved.** Today's descriptor planner (`SchemaIssue[]` → strategy chain → pattern-matched scaffolding) is retained and retargeted to emit `OpFactoryCall[]` directly. This is the feature that produces data-safe `dataTransform` stubs when `migration plan` encounters a schema change that can't be auto-applied (NOT-NULL backfill, unsafe type change, nullable tightening, enum value removal). Losing it would be a functional regression over descriptor-flow.

3. **The IR contract is a framework-level interface; consumers depend on the interface, not on a class hierarchy.** `OpFactoryCall` is an interface (`{ factory, operationClass, label }`) exported from `framework-components`. Concrete call classes (`CreateTableCall`, `DataTransformCall`, …) implement the interface; type positions in renderer signatures, planner returns, and visitor inputs use the interface or a target-specific union of concrete classes. The Postgres target may use internal abstract base classes for shared plumbing — mirroring Mongo's `OpFactoryCallNode` (`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`) — provided those base classes live inside the Postgres package, are not exported, are not referenced in any cross-package signature, and are not referenced from any non-Postgres consumer. The visible contract for every other package is the framework-level `OpFactoryCall` interface; no SQL-family base class ships.

   Within Postgres, two such internal base classes serve the IR. `PostgresOpFactoryCallNode` is the abstract base for concrete call classes (visitor `accept()` plus the `OpFactoryCall` slots). Its own parent, `MigrationTsExpression`, is an abstract base for anything renderable as a TypeScript expression — `PostgresOpFactoryCallNode` itself, plus `PlaceholderExpression` (the AST node for a scaffolded `dataTransform` body). `MigrationTsExpression` defines two polymorphic members used by the TypeScript renderer: `renderTypeScript(): string` and `importRequirements(): readonly ImportRequirement[]`. Both base classes are package-private; consumers outside the Postgres package see only `OpFactoryCall` and the `PostgresOpFactoryCall` union of concrete classes.

   Mongo receives the same IR shape in this project. Its existing `OpFactoryCallNode` gains `implements OpFactoryCall` (framework interface) and `extends MigrationTsExpression` (a Mongo-internal sibling of the Postgres abstract, structurally identical, also package-private). Each Mongo concrete call class implements the polymorphic `renderTypeScript()` / `importRequirements()` methods, and Mongo's `renderCallsToTypeScript` is rewritten to walk nodes polymorphically — no change to Mongo's rendered output. `PlaceholderExpression` has no Mongo counterpart; Mongo's planner doesn't emit `dataTransform`. Keeping Mongo and Postgres byte-compatible at the IR layer means the follow-up cross-target consolidation (Open Question 6) is a pure lift rather than a harmonize-then-lift.

   The renderable-migration wrapper is a Postgres-specific concrete class for now (`TypeScriptRenderablePostgresMigration`) implementing the existing `MigrationPlanWithAuthoringSurface<TOp>` interface (ADR 194). It is structurally identical to Mongo's equivalent and is a candidate for consolidation into a framework-level `TypeScriptRenderableMigration<TCall, TOp>` in a follow-up project (see Open Question 6).

## Non-goals

- **Lifting the changes to mysql or sqlite.** Those targets don't exist yet. The family-sql base classes are sized to accept them; the concrete ports are future work.
- **Changing step content from `sql: string` to an AST.** Per ADR 191, each family chooses its step content shape; Postgres's `{ sql: string, description, meta? }` stays. A structured AST for cross-SQL DDL rendering is a separate project if we ever want it.
- **Runner or driver changes.** Out of scope. Class-flow is an authoring-surface refactor; the execute path is unchanged.
- **A friendlier DSL surface for authoring.** Factories accept fully-materialized literal arguments. Sugar layers (inline column shorthands, column builders) are out of scope; they can be layered on later if desired.
- **MongoDB functional changes.** Mongo's planner, factories, CLI wiring, and rendered migration.ts output are untouched (byte-identical). The Mongo-side changes in scope are structural-only: a Phase 1 IR sync (`implements OpFactoryCall`, `extends MigrationTsExpression`, per-class polymorphic render methods, `renderCallsToTypeScript` rewritten to be polymorphic) so Mongo and Postgres share the same IR shape, and two Phase 6 deletions (`mongoEmit`, `TargetMigrationsCapability.emit`) that land with their Postgres counterparts.

## End-to-end execution flow

Every functional requirement in this spec is anchored to a step in the developer's CLI workflow. The requirements sections below are organized around the four steps: **new**, **plan**, **edit**, **apply**.

### Step 1 — `migration new` (fresh migration, no schema change)

The developer runs `migration new --target postgres`. The CLI fetches the current contract hash from storage, asks the Postgres target descriptor for an empty migration plan, serializes the plan's TypeScript representation to disk, then invokes the scaffolded file to emit `ops.json` and `migration.json`.

**Requirements:**

- **R1.1** `postgresTargetDescriptor.migrations` exposes a `MigrationPlanner` whose `emptyMigration(context)` returns a `MigrationPlanWithAuthoringSurface` — a value that both satisfies `MigrationPlan` (carries operations) and carries a `renderTypeScript()` method (per ADR 194).
- **R1.2** The plan returned by `emptyMigration` holds zero `OpFactoryCall` nodes; `renderTypeScript()` produces the class-flow boilerplate (shebang, imports, empty `class M extends Migration { plan() { return [] } }`, `Migration.run(...)`).
- **R1.3** The scaffolded `migration.ts` is directly runnable: `./migration.ts` produces `ops.json` (empty operations array) and an attested `migration.json`, without going through the CLI (per ADR 196).

### Step 2 — `migration plan` (scaffold from schema diff)

The developer runs `migration plan --target postgres` after modifying the contract. The CLI fetches `fromContract`, `toContract`, and the live database schema, then asks the planner to produce a plan covering the diff. The planner runs the issue-based pipeline and returns a `TypeScriptRenderablePostgresMigration`. The CLI serializes the plan's TypeScript, writes `migration.ts`, and invokes the file to emit `ops.json` + `migration.json`.

**Requirements:**

- **R2.1** The planner diffs via `verifySqlSchema(fromContract, currentSchema) → SchemaIssue[]`. No new diff IR is introduced; the existing family-sql `SchemaIssue` shape is the planner's input.
- **R2.2** A `MigrationStrategy` chain runs over the issue list. Each strategy consumes recognized issues and emits `PostgresOpFactoryCall[]` directly. `StrategyContext` carries `{ toContract, fromContract, schemaName, codecHooks }` so strategies can fully materialize literal arguments during call construction. Strategy signatures: `(issues, ctx) => { kind: 'match'; issues: ...; calls: PostgresOpFactoryCall[] } | { kind: 'no_match' }`.
- **R2.3** Residual unmatched issues fall through to a default issue-to-call mapping (one issue kind → one or more calls).
- **R2.4** Strategy sets are pluggable. The default `migrationPlanStrategies` set includes four data-safe strategies — NOT-NULL backfill, unsafe type change, nullable tightening, enum value removal — each of which emits a `DataTransformCall` whose `check` and `run` are `PlaceholderExpression`s for the scaffolded user code, plus the surrounding DDL calls.
- **R2.5** All context-dependent materialization (codec expansion, default rendering, extension ordering, schema qualification, contract lookup) happens during `OpFactoryCall` construction. By the time a call exists it carries only literal arguments plus planner-derived `operationClass` / `label` (per ADR 195).
- **R2.6** Schema qualification is non-optional — every DDL call carries `schemaName` as a literal field. Factories reject calls without it.
- **R2.7** The planner returns a `TypeScriptRenderablePostgresMigration` — a Postgres-specific concrete class extending the family-SQL `SqlMigration<PostgresPlanTargetDetails>` alias (itself `Migration<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`) and implementing `MigrationPlanWithAuthoringSurface<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`. It holds `readonly calls: readonly PostgresOpFactoryCall[]`, delegates `operations` to the `renderOps` visitor, and implements `renderTypeScript()` by calling `renderCallsToTypeScript(calls, meta)`. The class is a sibling of Mongo's `PlannerProducedMongoMigration` and is structurally a candidate for framework-level consolidation in a follow-up.
- **R2.8** `renderCallsToTypeScript(calls, meta)` is a polymorphic (non-visitor) traversal: it walks the node array, collects `node.importRequirements()` from every `MigrationTsExpression` it visits (including the `check` and `run` children of `DataTransformCall`), deduplicates the import list, and renders the module body by concatenating `node.renderTypeScript()` results inside the `plan()` method. The emitted source is a complete `migration.ts`: shebang, imports from `@prisma-next/family-sql/migration` and `@prisma-next/target-postgres/migration`, contract snapshot import, optional `sql(contract)` binding for data-transform closures, `export default class extends Migration { plan() { … } }`, `Migration.run(import.meta.url, …)`. `DataTransformCall` instances whose `check` or `run` is a `PlaceholderExpression` (per ADR 200) render that parameter as `() => placeholder("slot")` via `PlaceholderExpression.renderTypeScript()`, and the `placeholder` symbol is automatically surfaced in the import block via `PlaceholderExpression.importRequirements()`. The slot string is preserved end-to-end from planner construction through rendering.
- **R2.9** `renderOps(calls)` is a visitor over the `PostgresOpFactoryCall` union, dispatching each call to its corresponding pure factory. For a `DataTransformCall`, the visitor converts each `MigrationTsExpression` body into the closure the pure `dataTransform` factory expects via a local `bodyToClosure(expr)` helper. For a `PlaceholderExpression`, `bodyToClosure` returns `() => placeholder(slot)`; invoking that closure throws `errorUnfilledPlaceholder(slot)` (`PN-MIG-2001`) — runtime parity with the user hand-authoring `() => placeholder("slot")` themselves. The pure `dataTransform` factory invokes `check()` and `run()` while materializing the runtime op's pre/postcheck and execute steps, so a placeholder-bearing plan propagates the throw out through `instance.operations`. There is no `stub: boolean` flag on `DataTransformCall`; the "is this slot a stub?" question reduces to "is this body a `PlaceholderExpression`?".
- **R2.10** The planner is a single pipeline: no parallel walk-schema planner remains. `planner-reconciliation.ts` is deleted by end of project; `planner.ts` is either deleted or reduced to a thin `PostgresMigrationPlanner` shell.
- **R2.11** When `migration plan` produces a `TypeScriptRenderablePostgresMigration` containing any `PlaceholderExpression` body, the CLI writes **only** `migration.ts` to disk; it does not write `ops.json` or `migration.json`. Implementation: the CLI's serialization path attempts to materialize the plan's `operations` (which runs `renderOps` and triggers the placeholder throw from R2.9), catches `errorUnfilledPlaceholder`, and skips the two derived artifacts. The derived artifacts are re-produced when the user runs the filled-in `migration.ts` directly (via `Migration.run(import.meta.url, …)`, per R1.3), at which point every slot has user code and no throw occurs. Plans with no placeholders go through the normal path and produce all three artifacts as today.

### Step 3 — User edits `migration.ts`

The developer replaces the `placeholder()` closures in scaffolded `dataTransform` calls with real backfill logic. They may use the module-scoped `sql` query builder, bound to the snapshotted contract, for type-safe data reads and writes inside the `run` closure.

**Requirements:**

- **R3.1** Factories exported from `@prisma-next/target-postgres/migration` (`createTable`, `addColumn`, `createIndex`, `dropIndex`, `alterColumnType`, `setDefault`, `dropDefault`, `setNotNull`, `dropNotNull`, `addPrimaryKey`, `addForeignKey`, `addUnique`, `dropConstraint`, `dropTable`, `dropColumn`, `createEnumType`, `addEnumValues`, `dropEnumType`, `renameType`, `createExtension`, `dataTransform`) are pure functions of literal arguments. No factory references `OperationResolverContext`, imports codec hooks, takes a `contract` parameter, or touches a `db` handle.
- **R3.2** Factory signatures align 1:1 with the constructor arguments of the corresponding concrete call class (per ADR 195). Each concrete call class implements the framework-level `OpFactoryCall` interface (`{ factory, operationClass, label }`); type positions in renderer signatures, planner returns, and visitor inputs use the `OpFactoryCall` interface or a target-specific union of concrete classes. Adding a new factory requires changes at exactly three sites — the factory in `op-factories.ts`, the concrete call class in `op-factory-call.ts`, and the `renderOps` visitor case — and omitting any of the three is a compile error. (The TypeScript renderer side is automatic: the call class's `renderTypeScript()` / `importRequirements()` implementations are required by the abstract `MigrationTsExpression` base, so there is no separate visitor to forget.)
- **R3.3** Hand-authored `dataTransform` closures use a module-scoped `sql()` query builder bound once to the imported `contract.json` snapshot (per ADR 197). DDL factories do not interact with the query builder.

### Step 4 — `migration apply` (execute attested operations)

The developer runs `migration apply`. The CLI reads `ops.json`, validates against `migration.json`, and hands each `SqlMigrationPlanOperation` to the runner, which dispatches through the Postgres driver.

**Requirements:**

- **R4.1** `SqlMigrationPlanOperation<PostgresPlanTargetDetails>` shape is unchanged: `{ id, label, operationClass, target, precheck, execute, postcheck }` with step content `{ sql: string, description, meta? }`.
- **R4.2** `ops.json` and `migration.json` wire formats (schemas, field names, attestation shape) are unchanged. `migrationId` is still computed by the existing `computeMigrationId` (ADR 199). The *values* in re-scaffolded example migrations may differ from what's committed today — byte-identity is not a goal; see §Non-functional requirements.
- **R4.3** Runner and driver code are not modified.

## Non-functional requirements

- **Schema equivalence, not byte-identical `ops.json`.** The goal of this project is that every existing example migration continues to produce the schema its target contract expects, not that `ops.json` bytes or `migrationId` hashes stay identical. The Postgres runner's post-apply `verifySqlSchema` check already guarantees schema-shape equivalence before it commits the migration (ADR 199 background); we rely on that rather than on byte equality. Phase 3 re-scaffolds example migrations, and their regenerated `ops.json` / `migrationId` values may differ from what's committed today — that's expected. The gate for Phase 3 is "each regenerated example migration applies successfully and the runner's post-apply verify passes", exercised per-example at PR time, not an `ops.json` diff.
- **Type-safe exhaustiveness.** Adding a new concrete call class is a compile-time forcing function on every dispatch site. The `renderOps` visitor surfaces a missing case via `satisfies PostgresOpFactoryCallVisitor<R>`; the polymorphic `renderCallsToTypeScript` surfaces a missing implementation via the abstract `renderTypeScript()` / `importRequirements()` methods on `MigrationTsExpression`, which the new class must override. The same applies to any planner-side dispatch over `OpFactoryCall`.
- **No new runtime surface.** No new telemetry, no new security surface, no new operational cost. This is an authoring-tooling refactor.

## Acceptance criteria

Organized around the same four flow steps.

### Step 1 — `migration new`

- [ ] `migration new --target postgres` produces a `migration.ts` matching the class-flow shape shown in §Grounding example (empty `plan()`).
- [ ] The scaffolded file is directly executable: `node migration.ts` produces `ops.json` (empty operations) and attested `migration.json` without CLI involvement.

### Step 2 — `migration plan`

- [ ] `migration plan --target postgres` over an empty diff is a no-op (no new migration directory).
- [ ] `migration plan --target postgres` over a schema change containing a NOT-NULL add to a table with existing rows produces a `migration.ts` containing `addColumn(nullable) + dataTransform(stub) + setNotNull`, where the stub's `check` and `run` are `() => placeholder("slot")` expressions (rendered from `PlaceholderExpression` AST nodes). For the same run, the CLI does not write `ops.json` or `migration.json` (R2.11) — only `migration.ts`. Once the user fills in the placeholder bodies and runs `node migration.ts`, the two derived artifacts are produced without CLI involvement.
- [ ] Same command over an enum value removal produces the enum-rebuild recipe (`createEnumType(temp) + alterColumnType(using cast) + dropEnumType(old) + renameType(temp, old)`) wrapped by a `dataTransform(stub)` migration step; same skip-derived-artifacts behavior applies.
- [ ] Same command over a safe widening (`int4 → int8`) produces a single `alterColumnType` call, no `dataTransform` — and, having no placeholders, the CLI writes all three artifacts as normal.
- [ ] Same command over an unsafe type change produces `dataTransform(stub) + alterColumnType`; same skip-derived-artifacts behavior applies.
- [ ] The planner API accepts an alternative strategy list parameter for non-default use cases (e.g. a future dev-push set).
- [ ] The planner is a single pipeline: `grep -r planningMode` finds no residual `walk | issues` flag, `planner-reconciliation.ts` does not exist, and `planner.ts` either does not exist or is a thin shell.

### Step 3 — Edit surface

- [ ] Every Postgres factory is a pure function: no import of `OperationResolverContext`, no import of codec hooks, no `contract` parameter, no `db` handle.
- [ ] `framework-components` exports an `OpFactoryCall` interface (`{ factory, operationClass, label }`). No abstract base class is shipped at framework or family level. Postgres may use internal abstract base classes (`PostgresOpFactoryCallNode` for the concrete call classes, `MigrationTsExpression` as its parent and as the base of `PlaceholderExpression`) for shared visitor / rendering plumbing, but none of them are exported and none are referenced from any non-Postgres consumer.
- [ ] `@prisma-next/target-postgres/migration` exports the full factory surface per R3.1 (and the `placeholder` helper re-exported from `@prisma-next/errors/migration`). The `PostgresOpFactoryCall` discriminated union with one frozen class per factory (each implementing `OpFactoryCall`), the `PostgresOpFactoryCallVisitor<R>` interface, the `renderOps` visitor, and the polymorphic `renderCallsToTypeScript` function all live inside the Postgres package (consumed by the planner and by the target's capability wiring); none of them are re-exported from the user-facing `/migration` subpath.
- [ ] `DataTransformCall.check` and `DataTransformCall.run` are typed as `MigrationTsExpression`. The only concrete variant emitted by the planner in this project is `PlaceholderExpression`.
- [ ] When `migration plan` emits a plan containing any `PlaceholderExpression` body, the CLI writes `migration.ts` only — `ops.json` and `migration.json` are not written until the user fills in the slots and runs the file (R2.11).
- [ ] `TypeScriptRenderablePostgresMigration` is a concrete class extending the family-SQL `SqlMigration<PostgresPlanTargetDetails>` alias and implementing `MigrationPlanWithAuthoringSurface<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`.
- [ ] Schema qualification is a non-optional constructor argument on every DDL call class.
- [ ] Adding a new factory requires changes at exactly three sites (factory, call class, `renderOps` visitor), verified by removing a visitor case and confirming a TypeScript error. (The TypeScript renderer is automatically exhaustive because `renderTypeScript()` / `importRequirements()` are abstract on `MigrationTsExpression`.)
- [ ] Hand-authored `migration.ts` files can bind `const q = sql(contract)` at module scope and reference `q` inside `dataTransform` closures.

### Step 4 — Apply

- [ ] Every Postgres example migration (`examples/**/migrations/`) is re-scaffolded under class-flow, and each one applies successfully against a fresh Postgres with the runner's post-apply `verifySqlSchema` check passing. `migrationId` may change.
- [ ] A new live-database e2e test exercises `createTable + dataTransform + addColumn` against a Postgres container and verifies idempotency on re-apply (mirroring the Mongo coverage in PR #349).
- [ ] `SqlMigrationPlanOperation` step content remains `{ sql: string, description, meta? }`.

### Removal (end of project)

- [ ] No source file under `packages/` or `test/` imports `OperationDescriptor`, `PostgresMigrationOpDescriptor`, `DataTransformDescriptor`, `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`, `MigrationDescriptorArraySchema`, `evaluateMigrationTs`, `emitDescriptorFlow`, or `migrationStrategy`.
- [ ] `operation-descriptors.ts`, `operation-resolver.ts`, `descriptor-planner.ts` (or its renamed successor, once the walk-schema planner is absorbed), and `planner-reconciliation.ts` are deleted.
- [ ] `renderDescriptorTypeScript` is deleted from `scaffolding.ts`.
- [ ] `TargetMigrationsCapability.planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`, and `emit` methods are deleted from the framework interface.
- [ ] `migration emit` CLI command is deleted.
- [ ] `postgresEmit` and `mongoEmit` source files are deleted.
- [ ] `hints.planningStrategy` is removed from the manifest writer. Re-scaffolded example migrations' `migrationId` values may differ from their previous values; the per-example apply/verify in Phase 3 is the acceptance gate, not `migrationId` equality.

### Cross-cutting

- [ ] `pnpm -r typecheck` passes across the monorepo.
- [ ] `pnpm -r lint` passes.
- [ ] No regression in Mongo migration e2e tests (rendered migration.ts output is byte-identical after the Mongo IR sync; Mongo's existing `render-typescript` snapshot tests are the gate).

## Open questions

1. **Shape of `ColumnSpec` / `TableSpec` on IR nodes.** `AddColumnCall` needs a column specification sufficient for both the factory (DDL rendering) and the TypeScript renderer (round-trip). `StorageColumn` from `@prisma-next/sql-contract/types` carries the right data but also domain metadata the planner must strip. **Default assumption:** introduce a purpose-built `PostgresDdlColumnSpec` alongside the call classes.

2. **`CreateExtensionCall` ownership.** Today `resolveCreateDependency` expands one descriptor into multiple ops (create extension, create schema, etc.). In the new model each becomes its own `OpFactoryCall`. Does `createExtension` live under `@prisma-next/target-postgres/migration`, or graduate to `@prisma-next/family-sql/migration`? **Default assumption:** Postgres-specific; family-level lifting happens when a second SQL target needs it.

3. **Re-scaffolding existing attested example migrations.** Resolved. Re-scaffold from scratch; let `migrationId` change; rely on the runner's post-apply `verifySqlSchema` check (exercised per-example in Phase 3's PR) to confirm each regenerated migration still reconstructs the target schema. No one-off migration tool, no byte-equality check.

4. **`migration emit` downstream consumers.** Is `migration emit` called by any external documentation, scripts, or CI fixtures outside this repo? **Default assumption:** internal-only; deletion is non-breaking.

5. **Dev-push (`db update`) strategy set.** The strategy architecture accommodates a separate strategy list for destructive dev-push behavior. Does this project deliver that set, or only the data-safe `migrationPlanStrategies`? **Default assumption:** only the data-safe set. The existing `db update` path stays functional through the transition and is folded into the issue-based planner during the planner-collapse phase; a dedicated dev-push strategy set is a follow-up.

6. **Cross-target consolidation of the IR and renderable-migration class.** Once this project lands, Mongo and Postgres share the same IR shape at the leaves — `MigrationTsExpression`, `ImportRequirement`, polymorphic `renderTypeScript()` / `importRequirements()`, the `OpFactoryCall` framework interface — but each target still keeps its own package-private copies of `MigrationTsExpression` / `ImportRequirement` and its own `TypeScriptRenderableXMigration` concrete class. The structural duplication is intentional until both targets exist with the full hierarchy. **Default assumption (and known follow-up):** defer the lift. The follow-up project lifts `MigrationTsExpression`, `ImportRequirement`, and a generic `TypeScriptRenderableMigration<TCall extends OpFactoryCall, TOp>` into `framework-components`, retrofits both targets, and optionally renames `PlannerProducedMongoMigration` to `TypeScriptRenderableMongoMigration` for naming parity. The follow-up is purely structural — no behavior change, no ADR change. The Phase 1 Mongo IR sync in this project is designed so the sibling hierarchies are byte-compatible at lift time, making the follow-up a pure de-duplication.

## References

- [ADR 191 — Generic three-phase migration operation envelope](../../docs/architecture%20docs/adrs/ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md)
- [ADR 192 — ops.json is the migration contract](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)
- [ADR 193 — Class-flow as the canonical migration authoring strategy](../../docs/architecture%20docs/adrs/ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)
- [ADR 194 — Plans carry their own authoring surface](../../docs/architecture%20docs/adrs/ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md)
- [ADR 195 — Planner IR with two renderers](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)
- [ADR 196 — In-process emit for class-flow targets](../../docs/architecture%20docs/adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)
- [ADR 197 — Migration packages snapshot their own contract](../../docs/architecture%20docs/adrs/ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md)
- [ADR 199 — Storage-only migration identity](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)
- [ADR 200 — Placeholder utility for scaffolded migration slots](../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md)
- Sibling project: [`projects/mongo-migration-authoring/`](../mongo-migration-authoring/) (completed; class-flow template)
- Reference implementation: `packages/3-mongo-target/1-mongo-target/src/core/{op-factory-call.ts,migration-factories.ts,render-typescript.ts,mongo-planner.ts}` and `packages/2-mongo-family/9-family/src/core/mongo-emit.ts` (pre-deletion)
- Execution plan: [`plan.md`](./plan.md)
