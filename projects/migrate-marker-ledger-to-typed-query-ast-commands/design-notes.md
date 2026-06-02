# Design notes: migrate-marker-ledger-to-typed-query-ast-commands

> Synthesized design document. Read this if you want to understand **what the design is**, **what principles it serves**, and **what alternatives were considered and rejected**. Not a chronological log — it captures the settled design, standing independently of the discussion that produced it.
>
> Owned by the Orchestrator. Cross-linked from `spec.md`; never block execution on a design-notes update.

## What this project actually is

The headline is not "deduplicate marker code." It is **expand the SQL query AST to represent DDL (`CREATE TABLE`, `CREATE SCHEMA`, …) alongside the DML it already represents (`SELECT`/`INSERT`/`UPDATE`/`DELETE`)** — and to do it the way the architecture already extends across targets, so the DDL surface is *target-contributed*, not a generic core bolt-on. Marker/ledger operations are the **first consumer** of that expanded AST; the migration planner's DDL is the **second**. Consolidating the scattered, divergent marker code is a *consequence* of having an AST to express it with, not the goal in itself.

Two ASTs are in play and they are **not** the same thing:

1. **The query AST** (`AnyQueryAst` in `@prisma-next/sql-relational-core/ast`) — the thing the **adapter** lowers (`adapter.lower(ast, ctx) → LoweredStatement`) and the driver executes. This is what we expand to cover DDL.
2. **The migration-plan IR** (`OpFactoryCall` → `PostgresOpFactoryCallNode` → `CreateTableCall`/`DropColumnCall`/… in the target packages) — the planner's representation of a migration. Today its `toOp()` *concatenates raw SQL strings*. It is a **consumer** of this project, not a thing we reuse as the DDL AST: its string-building is what slice "planner adopts the DDL AST" replaces with query-AST DDL construction lowered through the adapter.

Conflating the two is the trap. The migration `*Call` IR carries migration-specific facets (operation classification, `renderTypeScript()` for `migration.ts` codegen, precheck/postcheck steps) that have nothing to do with the query AST. We are not folding one into the other; we are giving both a single *rendering* path (query-AST DDL → adapter lowering) instead of two raw-string code paths.

## Principles this design serves

- **One way to reach the wire.** Every database interaction — including control-plane marker/ledger operations — goes through the family adapter's `lower()` → driver path. No operation reaches the driver by a side channel.
- **Express, don't concatenate.** Operations are constructed as typed query-AST nodes, not assembled as raw SQL strings at the call site. Marker logic scattered *because there was no node to express DDL with*; the fix is to add the node, not to police the strings.
- **Target owns the shape; adapter owns the behaviour.** A DDL node says *what* exists (this table, these columns, this schema). The adapter says *how* it renders to dialect SQL. This split is what makes adapters interchangeable on a target — two Postgres adapters render the same marker `CreateTable` node; they cannot disagree about the marker table's shape because the shape isn't theirs to define. (See ADR — Adapter SPI for behaviour vs three-layer IR for shape.)
- **Target-extensible, not generic-core.** DDL constructs that only some targets have (`CREATE SCHEMA`, `CREATE EXTENSION`) are **contributed by the targets that have them**, never modelled as core nodes that no-op on targets that don't. SQLite has no schemas, so SQLite contributes no `CreateSchema` node — rather than a core `CreateSchemaAst` that SQLite's renderer has to special-case into a no-op.
- **Construction must be ergonomic, or callers route around it.** Hand-building frozen AST class instances by object literal is as cumbersome as raw strings — if it's painful, the next caller reaches for `driver.query(rawSql)` again and the divergence recurs. The user-facing `sql()` / `Root` builder is **contract-bound** (resolves tables/columns from `context.contract.storage`, infers codecs, propagates `storageHash` types), and control-plane / migration contexts have **no contract**. So the AST expansion is incomplete without a **contract-free builder**: a thin, schema-less surface that emits the query AST + DDL nodes from string identifiers and bound params. It drops contract-derived codec *inference* and type propagation — **not** codec *handling* (see "Codecs: DDL descriptors vs DML values").
- **One home per concern.** Each family's marker/ledger CRUD lives behind a single control-adapter SPI surface. Reads, writes, parsing, and existence-probing are defined once per family, not re-derived per call site.
- **Symmetry across families.** SQL and Mongo expose the same marker-ops surface shape. Asymmetry today is an accident of incremental growth, not a designed boundary.

## The model

### How DDL becomes a target-contributed part of the query AST

The codebase already has the mechanism — it just hasn't been applied to the query AST:

- **Frozen-class AST + visitor.** `AnyExpression` already dispatches via `ExprVisitor` (`expr.accept(visitor)`); the query AST nodes are frozen classes with a `kind` discriminant.
- **Three-layer polymorphic IR** (framework interface → family base → target concrete). Migration ops already use it: `OpFactoryCall` (framework) → `PostgresOpFactoryCallNode` (target base) → `CreateTableCall` (concrete), with target-only kinds (`CreateExtensionCall`) that no other target has to stub. See [`docs/architecture docs/patterns/three-layer-polymorphic-ir.md`](../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md).

Applying both to the query AST:

- **DML stays core / target-uniform.** `SelectAst`/`InsertAst`/`UpdateAst`/`DeleteAst` are the same shape on every SQL target — they are the canonical "target-uniform IR" the three-layer pattern says *not* to layer. They stay in `relational-core`.
- **DDL becomes target-contributed.** A framework/family-level DDL-node base (the minimal contract every DDL node satisfies) lives low; **targets ship concrete DDL node classes**. Postgres contributes `CreateTable` + `CreateSchema`; SQLite contributes `CreateTable` only. A target adds the DDL kinds it actually has.
- **The renderer's closed switch becomes a target-DDL visitor the adapter owns.** Today `renderLoweredSql` is `switch (ast.kind) { case 'select': … case 'create-table': … }` over a closed union (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`). To lower *target-contributed* DDL, the adapter dispatches through a DDL visitor (double-dispatch) it implements for its target's DDL node set. The adapter (target-specific, and depends on its target package) knows its own target's DDL nodes natively; the framework/family never has to enumerate them.

**The precise visitor/dispatch API is the load-bearing unknown.** Both prior attempts mis-modelled this. The foundational slice front-loads proving it end-to-end on `CreateTable` (+ Postgres `CreateSchema`) across PG **and** SQLite before committing the rest of the surface.

### Column types and defaults: opaque strings + literal/function expressions

The rejected approach baked a closed, dialect-flavoured enum into core (`ColumnType = 'jsonb' | 'bigserial' | 'timestamptz' | …`) and a bespoke default vocabulary (`{ kind: 'now' } | { kind: 'empty-collection' }`), then mapped them to dialect SQL inside the renderer. That smuggles dialect knowledge into core and invents an abstraction the system already has elsewhere.

Instead:

- **Column type = opaque native-type string**, chosen by the target that builds the node (`'text'`, `'jsonb'`, `'INTEGER'`). This mirrors the migration IR's `ColumnSpec.typeSql: string` and the Schema IR's `nativeType: string`. The renderer quotes/places it; it does not interpret it.
- **Column default = the literal/function expression vocabulary from contract authoring** (`literal` value vs `function` call), not a marker-specific enum. Reuse the existing `ColumnDefault` shape rather than a parallel one.

### Current state (verified) — why marker code diverged

The same logical operation is implemented inconsistently across families and, within SQL, across three independent sites:

| Concern | MongoDB | Postgres | SQLite |
|---|---|---|---|
| Marker write transport | Local `db.collection().insertOne()/findOneAndUpdate()` in `marker-ledger.ts` (bypasses adapter) | `driver.query(rawSql)` from runner / control-instance | `driver.query(rawSql)` from runner |
| Write construction | Typed raw-command AST nodes — already exist, executed locally | raw strings (`statement-builders.ts`, `sql-marker.ts`) | raw strings (`statement-builders.ts`) |
| Marker read | one path | `SqlControlAdapter.readMarker` + runtime reader | + SQLite runner's **private** read (third path) |
| Row parsing | one parser | `parseContractMarkerRow` in two copies | (shares the SQL copies) |
| Marker-write SPI | full (`initMarker`/`updateMarker`/`writeLedgerEntry`) | **read-only** | (no SPI; private runner methods) |
| `invariants` merge | `$setUnion` (accumulate + dedupe) | `array(select distinct …)` (accumulate + dedupe) | **JSON string, overwritten wholesale** (does NOT accumulate) |

Two consequences:

1. **Mongo is half-done**: it builds typed AST nodes but executes them with local `db.collection()` calls (two `as` casts). Finishing means routing those nodes through `adapter.lower()` → driver.
2. **SQL has no write SPI and no AST usage**, and the hand-written builders **silently diverged**: Postgres merge-dedupes invariants; SQLite overwrites them. Nothing forced agreement because the policy had no single home. Giving each family one `updateMarker` SPI method that owns the accumulate-dedupe policy removes the divergence by construction.

### What the query AST already supports (verified)

`SelectAst | InsertAst | UpdateAst | DeleteAst | RawSqlExpr`, and `InsertAst` carries an `InsertOnConflict` node. So marker reads, the ledger insert, and the marker upsert are **already expressible** — the upsert collapses to a single `INSERT … ON CONFLICT (space) DO UPDATE SET …`. The **only** AST gap for marker ops is DDL.

### Target architecture

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

The migration planner's `*Call` IR sits beside this: its `toOp()` builds the same query-AST DDL nodes and lowers them through the adapter, instead of concatenating SQL strings — sharing the *rendering* path, not the IR.

### Codecs: DDL descriptors vs DML values

"Contract-free" drops codec **inference**, not codec **handling**. Two concerns hide behind "type":

1. **DDL column-type descriptors** (the native-type strings on a `CreateTable` column). `CREATE TABLE` moves no JS values, so no value codec is involved; the renderer resolves the string to native SQL. This is the only sense in which DDL is "codec-free", and it is correct.
2. **DML value codecs** (reading/writing marker rows — `meta` is JSON, `invariants` is an array, `updated_at` is a timestamp). Codecs are **preserved**. They attach to AST nodes (`ParamRef.codec`, `ProjectionItem.codec` carry a `CodecRef`) and the runtime resolves them via `contractCodecs.forCodecRef(ref)`, a registry that **grows lazily for AST-supplied refs** — so dispatch needs no contract walk. The contract path merely *pre-populates* the registry.

So the contract-free DML surface keeps full JS round-tripping (object ↔ `jsonb`, `string[]` ↔ `text[]`, `Date` ↔ `timestamptz`). It drops only the *convenience* of "name a model column, the contract picks the codec"; callers attach the codec explicitly at the value site (the existing `param(value, { codecId })` path). **The codec ref for JSON/array columns is target-specific** (`pg/jsonb@1` lives in the Postgres target; SQLite needs its own JSON-as-`TEXT` codec) — the same target/adapter split as the DDL renderer, one layer up. This is a marker-write (DML) concern; the foundational slice ships DDL only.

## Alternatives considered

- **Generic-core DDL nodes** (a closed `ColumnType` enum + `now`/`empty-collection` defaults in `relational-core`, `CreateSchemaAst` as a core node SQLite renders as a no-op, lowering bolted onto the closed renderer switch). This is what PR #661 built. **Rejected because:** it puts dialect knowledge in core, invents a default vocabulary the system already has, and makes `CreateSchema` a node that's meaningless on SQLite. The target-contributed three-layer approach is the existing architectural answer to exactly this.
- **Reuse the migration `*Call` IR as the DDL query-AST.** **Rejected because:** they are different ASTs. The `*Call` IR carries migration facets (operation class, TS codegen, prechecks) irrelevant to a query AST the adapter lowers; the query AST carries lowering/codec facets irrelevant to the planner. They share a *rendering path*, not a representation.
- **Target-agnostic semantic marker-command alphabet** (`ReadMarker`/`CasAdvanceMarker`/`AppendLedgerEntry`). **Rejected because:** the intent is to express marker ops with the *general* DDL/DML AST, not a bespoke alphabet; it collides with ADR 204 (domain actions vs composable primitives). The semantic layer is the SPI method (`updateMarker(...)`), not an AST node.
- **Move marker-ledger into the driver layer** (the original ticket's suggestion). **Rejected because:** routing through `adapter.lower()` → driver already puts wire concerns in the driver while keeping construction in the adapter, consistent with the ControlAdapter pattern.

## Open questions

- **DDL visitor / dispatch API (load-bearing) — RESOLVED (foundational-slice spike, validated end-to-end on `CreateTable` across Postgres + SQLite):** frozen-class DDL nodes in a **separate hierarchy** from `AnyQueryAst`, dispatched by an adapter-owned visitor via double-dispatch, mirroring `ExprVisitor`. Concretely:
  - A `DdlNode` abstract base (in `relational-core`, module `ast/ddl-types.ts`): `kind` discriminant, `freeze()` in constructor, `accept<R>(visitor: DdlVisitor<R>): R`, `collectParamRefs(): []` (bootstrap DDL is parameterless). Plus an `AnyDdlNode` union, `ddlAstKinds`, and an `isAnyDdlNode()` guard — parallel to the query-AST machinery, **not** folded into it. `AnyQueryAst` gains **no** DDL member (this is the bright line vs the rejected approach — adding DDL kinds to the closed query union breaks every exhaustive `AnyQueryAst` consumer across packages).
  - `DdlVisitor<R>` with one method per concrete DDL kind. Concrete nodes implement `accept` → `visitor.<kind>(this)`. The adapter implements `DdlVisitor<string>`.
  - `lower()` receives DDL via a **widened input** (`AnyQueryAst | AnyDdlNode`) with an `isAnyDdlNode(ast)` guard routing to `renderLoweredDdl(ast)` (`ast.accept(new <Target>DdlVisitor())`) vs the existing `renderLoweredSql`. **The DML renderer `switch` is never touched.**
  - **Alternatives rejected on spike evidence:** an extensible kind→renderer table duplicates dispatch the visitor already provides and recreates central-enumeration coupling; self-lowering nodes push dialect/quoting knowledge into the target nodes, violating "adapter owns behaviour (incl. identifier quoting)."
  - **Per-target visitor for target-only kinds — RESOLVED (operator-approved).** Because some DDL kinds are target-only (Postgres `CreateSchema`; SQLite has none), the visitor is **not** one global interface (that would force SQLite to stub `createSchema` — the rejected generic-core no-op). Instead, the dispatch is layered:
    - **Family (`relational-core/src/ast/ddl-types.ts`):** `abstract class DdlNode` holds only the target-agnostic contract — `kind`, `freeze()`, `collectParamRefs()`. It carries **no** `accept` and **no** visitor (the visitor type is target-specific). A runtime guard `isAnyDdlNode(value): value is DdlNode` over a kind-set `ddlAstKinds` (the union of all targets' kinds — a membership set, not a type union, so it forces no target to implement a kind it lacks). The concrete `CreateTable` + the global `DdlVisitor` the spike put here are **removed**.
    - **Each target package** defines its own `<Target>DdlVisitor<R>` (one method per kind that target has), a `<Target>DdlNode` abstract base (`extends DdlNode`) that declares `abstract accept<R>(v: <Target>DdlVisitor<R>): R`, and its concrete classes. Postgres: `PostgresDdlVisitor` (`createTable` + `createSchema`), `PostgresCreateTable`, `PostgresCreateSchema`. SQLite: `SqliteDdlVisitor` (`createTable`), `SqliteCreateTable`. No target stubs a kind it lacks. This mirrors the migration-op three-layer base (`PostgresOpFactoryCallNode` in `target-postgres/src/core/migrations/`) for placement + layering, combined with `ExprVisitor`-style double-dispatch.
    - **Adapter:** `lower(ast: AnyQueryAst | <Target>DdlNode, …)`; `isAnyDdlNode(ast)` narrows to `<Target>DdlNode` (the `AnyQueryAst` arm has no `DdlNode` member), then `ast.accept(new <Target>DdlVisitor())`. Impl-level signature widening (as the spike used) is sufficient and type-safe; formalizing the shared `Adapter` interface type-param is deferred unless a compile forces it.
  - **Columns:** `DdlColumn` gains `default?: ColumnDefault`, reusing the contract-authoring `ColumnDefault` vocabulary (sourced from `@prisma-next/contract/types` / the sql contract validators — **not** a new enum). Type stays an opaque native-type string.
- **Migration adoption: reuse vs extract.** Whether the `*Call` factories build the query-AST DDL directly, or a thin shared DDL-construction helper sits between them. **Working position:** factories build query-AST DDL directly via the contract-free constructors; extract a helper only if duplication bites. Settled at the planner-adoption slice.
- **Contract-free builder altitude + surface.** Where it lives (a module in `relational-core` beside the AST vs a dedicated package) and how much of the AST it covers in the first pass. **Working position:** beside the AST, covering exactly the marker/migration DDL+DML needs, widened as consumers demand. Settled at slice-planning time.
- **DDL identifier quoting / literal escaping — Deferred to planner adoption (explicit precondition).** The contract-free DDL renderers emit identifiers (`schema`, `table`, column names/types) and string-literal defaults verbatim — no `quoteIdentifier`/`escapeLiteral`, unlike the DML renderer in the same adapter. This is safe and byte-correct for the foundational slice because its only consumer is control-plane bootstrap with fixed, trusted identifiers. Real quoting/escaping is **load-bearing only once the migration planner feeds user-derived identifiers through this path**, so it lands with the planner-adoption slice (which already owns dialect quoting via `buildColumnDefaultSql` and `sql-utils`). The deferral is recorded as a precondition in the `createTable`/`createSchema` JSDoc rather than left implicit, so callers can't assume the path is injection-safe.
- **Invariant-merge realization — Resolved:** a domain operation on the adapter's `updateMarker`, not an AST node. SQL computes the unioned set in the adapter (the advance runs under the migration txn + advisory lock — no read-then-write race) and emits a plain parameterized `UPDATE`; Mongo keeps its server-side `$setUnion` because its CAS path has no external lock. The AST stays general-purpose.
- **Postgres-merge vs SQLite-overwrite divergence — Resolved (operator-confirmed):** converge on accumulate-dedupe; SQLite's overwrite is a latent bug. The slice that lands it states the observable SQLite change in its PR.
- **Upsert via `INSERT … ON CONFLICT`** — collapse the insert/update branching. **Working position:** yes where capability-supported (both Postgres and SQLite).
- **"Single SPI" altitude** — per-family vs a shared cross-family marker-ops interface hoisted to `framework-components`. **Working position:** per-family; hoist only if clean.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Linear ticket: TML-2253
- ADRs: 021 (Contract Marker Storage), 190 (CAS concurrency, Mongo), 195 (Planner IR with two renderers), 198 (Runner decoupled via visitor SPIs), 204 (Domain actions vs composable primitives), 212 (Contract spaces).
- Patterns: [`three-layer-polymorphic-ir.md`](../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md), [`frozen-class-ast.md`](../../docs/architecture%20docs/patterns/frozen-class-ast.md), [`adapter-spi.md`](../../docs/architecture%20docs/patterns/adapter-spi.md).
- Subsystems: [`5. Adapters & Targets`](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md), [`7. Migration System`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
