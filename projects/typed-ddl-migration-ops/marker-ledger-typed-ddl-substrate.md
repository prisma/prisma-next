# Typed-DDL design substrate: query-AST DDL as target-contributed nodes

> **Draft substrate for the forthcoming ADR (TML-2923).** Records the design that landed across the marker-ledger project for the typed-DDL refactor; the ADR will be written by TML-2923 in the successor project "Typed DDL migration ops — complete the conversion" and will absorb/replace this doc. Until then, this is the durable home for the design.

## Two ASTs in play

Two distinct ASTs exist in this codebase and they are not the same thing.

1. **The query AST** (`AnyQueryAst` in `@prisma-next/sql-relational-core/ast`) — what the adapter lowers (`adapter.lower(ast, ctx) → LoweredStatement`) and the driver executes. This is the AST extended to cover DDL.
2. **The migration-plan IR** (`OpFactoryCall` → `PostgresOpFactoryCallNode` → `CreateTableCall`/`DropColumnCall`/… in the target packages) — the planner's representation of a migration. Its `toOp()` was previously concatenating raw SQL strings; the "planner adoption" slices replaced that with query-AST DDL construction lowered through the adapter.

The two share a rendering path, not a representation. The migration `*Call` IR carries migration-specific facets (operation classification, `renderTypeScript()` for `migration.ts` codegen, precheck/postcheck steps) that have nothing to do with the query AST.

## Design principles

**One way to reach the wire.** Every database interaction — including control-plane marker/ledger operations — goes through the family adapter's `lower()` → driver path. No operation reaches the driver by a side channel.

**Express, don't concatenate.** Operations are constructed as typed query-AST nodes, not assembled as raw SQL strings at the call site. Marker code was scattered because there was no node to express DDL with; the fix is to add the node, not police the strings.

**Target owns the shape; adapter owns the behaviour.** A DDL node says what exists (this table, these columns, this schema). The adapter says how it renders to dialect SQL. This split is what makes adapters interchangeable: two Postgres adapters render the same `CreateTable` node, and they cannot disagree on the table's shape because the shape is not theirs to define. See ADR — Adapter SPI for behaviour vs three-layer IR for shape.

**Target-extensible, not generic-core.** DDL constructs that only some targets have (`CREATE SCHEMA`, `CREATE EXTENSION`) are contributed by the targets that have them, never modelled as core nodes that no-op on targets that lack them. SQLite has no schemas, so SQLite contributes no `CreateSchema` node.

**Construction must be ergonomic, or callers route around it.** Hand-building frozen AST class instances by object literal is as cumbersome as raw strings — if it is painful, the next caller reaches for `driver.query(rawSql)` again and the divergence recurs. The user-facing `sql()` / `Root` builder is contract-bound (resolves tables/columns from `context.contract.storage`, infers codecs, propagates `storageHash` types), and control-plane / migration contexts have no contract. The AST extension is therefore incomplete without a contract-free builder: a thin, schema-less surface that emits query-AST + DDL nodes from string identifiers and bound params. It drops contract-derived codec inference and type propagation, but not codec handling (see Codecs section).

**One home per concern.** Each family's marker/ledger CRUD lives behind a single control-adapter SPI surface. Reads, writes, parsing, and existence-probing are defined once per family, not re-derived per call site.

**Symmetry across families.** SQL and Mongo expose the same marker-ops surface shape. Prior asymmetry was an accident of incremental growth, not a designed boundary.

## The model

### How DDL becomes a target-contributed part of the query AST

The codebase already has the mechanism, applied here to the query AST:

- **Frozen-class AST + visitor.** `AnyExpression` already dispatches via `ExprVisitor` (`expr.accept(visitor)`); the query AST nodes are frozen classes with a `kind` discriminant.
- **Three-layer polymorphic IR** (framework interface → family base → target concrete). Migration ops already use it: `OpFactoryCall` (framework) → `PostgresOpFactoryCallNode` (target base) → `CreateTableCall` (concrete), with target-only kinds (`CreateExtensionCall`) that no other target has to stub. See [`docs/architecture docs/patterns/three-layer-polymorphic-ir.md`](../patterns/three-layer-polymorphic-ir.md).

Applied to the query AST:

- **DML stays core / target-uniform.** `SelectAst`/`InsertAst`/`UpdateAst`/`DeleteAst` are the same shape on every SQL target — they are canonical "target-uniform IR" per the three-layer pattern and stay in `relational-core`.
- **DDL becomes target-contributed.** A framework/family-level DDL-node base (the minimal contract every DDL node satisfies) lives low; targets ship concrete DDL node classes. Postgres contributes `CreateTable` + `CreateSchema`; SQLite contributes `CreateTable` only.
- **The renderer's closed switch becomes a target-DDL visitor the adapter owns.** To lower target-contributed DDL, the adapter dispatches through a DDL visitor (double-dispatch) it implements for its target's DDL node set. The adapter knows its own target's DDL nodes natively; the framework/family never enumerates them.

```
control-plane caller (db init/sign/verify, migration runner)
        │  calls one SPI surface (symmetric across families)
        ▼
<Family>ControlAdapter ──lower(ast, ctx)──▶ Driver.execute(lowered) ──▶ DB
   reads + writes + bootstrap DDL,            existing transport;
   expressed as query-AST nodes               no new side channel
        ▲
        │ DDL nodes contributed by the *target*; lowered by the *adapter*
        │ (target = shape, adapter = behaviour)
   target package: CreateTable (+ CreateSchema on Postgres)
```

The migration planner's `*Call` IR sits beside this: its `toOp()` builds the same query-AST DDL nodes and lowers them through the adapter, sharing the rendering path, not the IR.

### DDL visitor and dispatch API

DDL nodes live in a separate hierarchy from `AnyQueryAst`, dispatched by an adapter-owned visitor via double-dispatch, mirroring `ExprVisitor`. `AnyQueryAst` gains no DDL member — adding DDL kinds to the closed query union would break every exhaustive `AnyQueryAst` consumer across packages.

**Layering:**

- **Family (`relational-core/src/ast/ddl-types.ts`):** `abstract class DdlNode` holds only the target-agnostic contract — `kind`, `freeze()`, `collectParamRefs()`. It carries no `accept` and no visitor (the visitor type is target-specific). A runtime guard `isAnyDdlNode(value): value is DdlNode` over a kind-set `ddlAstKinds` (a membership set, not a type union, so it forces no target to implement a kind it lacks).
- **Each target package** defines its own `<Target>DdlVisitor<R>` (one method per kind that target has), a `<Target>DdlNode` abstract base (`extends DdlNode`) that declares `abstract accept<R>(v: <Target>DdlVisitor<R>): R`, and its concrete classes. Postgres: `PostgresDdlVisitor` (`createTable` + `createSchema`), `PostgresCreateTable`, `PostgresCreateSchema`. SQLite: `SqliteDdlVisitor` (`createTable`), `SqliteCreateTable`. No target stubs a kind it lacks.
- **Adapter:** `lower(ast: AnyQueryAst | <Target>DdlNode, …)`; `isAnyDdlNode(ast)` narrows to `<Target>DdlNode`, then `ast.accept(new <Target>DdlVisitor())`. The DML renderer switch is never touched.

Placement mirrors the migration-op three-layer base (`PostgresOpFactoryCallNode` in `target-postgres/src/core/migrations/`) combined with `ExprVisitor`-style double-dispatch.

### Column types and defaults

- **Column type = opaque native-type string**, chosen by the target that builds the node (`'text'`, `'jsonb'`, `'INTEGER'`). This mirrors the migration IR's `ColumnSpec.typeSql: string` and the Schema IR's `nativeType: string`. The renderer quotes and places it; it does not interpret it.
- **Column default = the literal/function expression vocabulary from contract authoring** (`literal` value vs `function` call), not a marker-specific enum. Reuses the existing `ColumnDefault` shape rather than a parallel one.

### Table-level constraints on `CreateTable`

A `constraints?: readonly DdlTableConstraint[]` field on `PostgresCreateTable` / `SqliteCreateTable`, where `DdlTableConstraint` is a frozen-class union:

```ts
class PrimaryKeyConstraint {
  readonly kind = 'primary-key';
  readonly columns: ReadonlyArray<string>;
  readonly name: string | undefined;    // present → CONSTRAINT <name> PRIMARY KEY (…)
}

class ForeignKeyConstraint {
  readonly kind = 'foreign-key';
  readonly columns: ReadonlyArray<string>;
  readonly refTable: string;
  readonly refColumns: ReadonlyArray<string>;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
  readonly name: string | undefined;    // present → CONSTRAINT <name> FOREIGN KEY …
}

class UniqueConstraint {
  readonly kind = 'unique';
  readonly columns: ReadonlyArray<string>;
  readonly name: string | undefined;    // present → CONSTRAINT <name> UNIQUE (…)
}

type DdlTableConstraint = PrimaryKeyConstraint | ForeignKeyConstraint | UniqueConstraint;
```

Key decisions:

- Constraint objects are frozen on construction, same discipline as the `DdlNode` hierarchy.
- `onDelete`/`onUpdate` reuse the `ReferentialAction` type from `@prisma-next/sql-contract/types` rather than a new enum.
- Constraint classes live in `relational-core` (not per-target) because the three kinds are universal across SQL targets; per-target variation is entirely in how the adapter renders them.
- When `constraints` is absent, the adapter renders only column defs. Existing `CreateTable` nodes with no table-level constraints render byte-identical to before.

### Codecs: DDL descriptors vs DML values

"Contract-free" drops codec inference, not codec handling. Two concerns hide behind "type":

1. **DDL column-type descriptors** (native-type strings on a `CreateTable` column). `CREATE TABLE` moves no JS values, so no value codec is involved; the renderer resolves the string to native SQL. This is the only sense in which DDL is codec-free.
2. **DML value codecs** (reading/writing marker rows — `meta` is JSON, `invariants` is an array, `updated_at` is a timestamp). Codecs are preserved. They attach to AST nodes (`ParamRef.codec`, `ProjectionItem.codec` carry a `CodecRef`) and the runtime resolves them via `contractCodecs.forCodecRef(ref)`, a registry that grows lazily for AST-supplied refs — so dispatch needs no contract walk.

The contract-free DML surface keeps full JS round-tripping. It drops only the convenience of "name a model column and the contract picks the codec"; callers attach the codec explicitly at the value site (the existing `param(value, { codecId })` path). The codec ref for JSON/array columns is target-specific (`pg/jsonb@1` lives in the Postgres target; SQLite needs its own JSON-as-`TEXT` codec) — the same target/adapter split as the DDL renderer, one layer up.

### Planner DDL lowering mechanism

The planner's `CreateTableCall.toOp()` lives in the target package and must lower a DDL-AST node. The adapter's lowering code lives in the adapter package, and `adapter-postgres` depends on `target-postgres` — so the target cannot import the adapter directly.

The adapter interface `SqlControlAdapter<TTarget>` lives in `@prisma-next/family-sql/control-adapter` (`packages/2-sql/9-family`) — a layer below both target and adapter, which both already depend on. It exposes `lower(ast: AnyQueryAst | DdlNode, ctx): LoweredStatement`. The migration class (`PostgresMigration extends SqlMigration`) holds the concrete adapter as `this.controlAdapter`. `CreateTableCall.toOp()` receives the adapter via the same threading as `dataTransform()`, builds the node with the contract-free constructor, and lowers it through the interface at plan/JSON-write time. The renderer stays in the adapter; the target depends only on the low-level interface, never the concrete adapter.

### Migration authoring API: SQL-free, builder-options methods

The migration op factories are the user-facing authoring API. No SQL may appear in that interface — not `typeSql`/`defaultSql` fragments, not raw `sql` strings. SQL is produced only by lowering a typed DDL node through the adapter at one boundary.

`createTable` / `createSchema` are `Migration` methods (mirroring the existing `dataTransform`) that take the contract-free builder's options and lower internally:

```ts
this.createTable({ schema: 'public', table: 'bug', columns: [col('severity', 'text', { notNull: true })], constraints: [primaryKey(['id'])] })
this.createSchema({ schema: 'public' })
```

The method builds the `CreateTable` DDL node from the options, lowers it through `this.controlAdapter`, and assembles the `Op`. The plan path (`CreateTableCall.toOp(lowerer)`) builds the same node from its `*Call` fields — one lowering implementation.

### The `*Call` op nodes are the common interface

The `OpFactoryCall` IR nodes (`CreateTableCall`, `CreateSchemaCall`, …) are the single common interface for a migration operation. `toOp(lowerer)` is how a `*Call` renders itself into an `Op`; `renderTypeScript()` is how it renders its authoring source. Op-assembly lives on `CreateTableCall.toOp()`. Two producers both go through the `*Call`: the planner constructs it during diffing; `PostgresMigration.createTable(options)` constructs one from the user's contract-free options and calls `.toOp(this.controlAdapter)`.

### Migration schema convention (Postgres)

Postgres `Migration` methods make `schema` required — no default, no "unspecified namespace" option. A migration must name its schema explicitly; a `search_path`-relative (unbound) default is ambiguity, and ambiguity in a migration is an antipattern. The unbound/unspecified namespace concept applies only to Mongo/SQLite (where there is no real namespace concept). The `options.schema ?? UNBOUND_NAMESPACE_ID` fallback is absent from Postgres migration methods; the `schema` field is non-optional.

### Mongo: lowering happens at runner boundary, not plan time

Mongo's `ops.json` serializes typed nodes (the mongo-ops-serializer revives `CreateCollectionCommand` et al. from JSON). Lowering at plan time would degrade the serialized artifact from typed AST to opaque wire documents, violating "express, don't concatenate." Mongo therefore lowers at the runner boundary, execute-time, exactly as its data-transform ops already do. `toOp()` stays sync and stays the construction site; the adapter owns lowering; the driver executes the wire command.

This contrasts with Postgres, where `toOp(lowerer)` lowers at plan/JSON-write time because the lowered form (`sql`) is what `ops.json` serializes.

## Alternatives considered

**Generic-core DDL nodes** (a closed `ColumnType` enum + `now`/`empty-collection` defaults in `relational-core`, `CreateSchemaAst` as a core node SQLite renders as a no-op, lowering bolted onto the closed renderer switch). Rejected because it puts dialect knowledge in core, invents a default vocabulary the system already has, and makes `CreateSchema` a node that is meaningless on SQLite. The target-contributed three-layer approach is the existing architectural answer to exactly this problem.

**Reuse the migration `*Call` IR as the DDL query AST.** Rejected because they are different ASTs. The `*Call` IR carries migration facets (operation class, TS codegen, prechecks) irrelevant to a query AST the adapter lowers; the query AST carries lowering/codec facets irrelevant to the planner. They share a rendering path, not a representation.

**Target-agnostic semantic marker-command alphabet** (`ReadMarker`/`CasAdvanceMarker`/`AppendLedgerEntry`). Rejected because the intent is to express marker ops with the general DDL/DML AST, not a bespoke alphabet; it collides with ADR 204 (domain actions vs composable primitives). The semantic layer is the SPI method (`updateMarker(...)`), not an AST node.

**Move marker-ledger into the driver layer.** Rejected because routing through `adapter.lower()` → driver already puts wire concerns in the driver while keeping construction in the adapter, consistent with the ControlAdapter pattern.

**An extensible kind→renderer table** (for DDL dispatch). Duplicates dispatch the visitor already provides and recreates central-enumeration coupling. Rejected in favour of the double-dispatch visitor.

**Self-lowering DDL nodes** (each node contains its own dialect rendering). Pushes dialect/quoting knowledge into the target nodes, violating "adapter owns behaviour (including identifier quoting)."

**Per-target constraint node classes** (`PostgresPrimaryKeyConstraint` / `SqlitePrimaryKeyConstraint`). The rendering differences between Postgres and SQLite are in the DDL visitor, not in the constraint shape. Rejected: one shared class, per-adapter rendering.

**Inline constraint representation** (column-level only, no table-level array). Composite PKs cannot be expressed column-level; aggregating multiple column-level flags would require a stateful pass in the renderer. Rejected: the array-of-constraint-objects keeps rendering a simple fold.

**`onDelete`/`onUpdate` as raw SQL strings.** Raw strings allow arbitrary values and do not typecheck against valid referential actions. Rejected: `ReferentialAction` is the established vocabulary.

**For Mongo — keeping helper-based execution** (`adapter.execDdl(node)` wrapper over `MongoCommandExecutor`). Preserves exact driver-helper semantics but keeps a second execution mechanism and diverges from the SQL interface shape.

**For Mongo — a thin `MongoMigrationLowerer` wrapper** around `MongoCommandExecutor` threaded into `toOp()`. Plumbing without unification — two dispatch paths survive in the runner.

## References

- ADRs: 021 (Contract Marker Storage), 190 (CAS concurrency, Mongo), 195 (Planner IR with two renderers), 198 (Runner decoupled via visitor SPIs), 204 (Domain actions vs composable primitives), 212 (Contract spaces).
- Patterns: [`three-layer-polymorphic-ir.md`](../patterns/three-layer-polymorphic-ir.md), [`frozen-class-ast.md`](../patterns/frozen-class-ast.md), [`adapter-spi.md`](../patterns/adapter-spi.md).
- Subsystems: [`5. Adapters & Targets`](../subsystems/5.%20Adapters%20%26%20Targets.md), [`7. Migration System`](../subsystems/7.%20Migration%20System.md).
- Successor ADR ticket: TML-2923 ("DDL as a target-contributed query-AST kind + adapter DDL-lowering seam").
