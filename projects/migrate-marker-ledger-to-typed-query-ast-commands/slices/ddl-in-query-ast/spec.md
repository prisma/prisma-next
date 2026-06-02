# Slice: ddl-in-query-ast

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome: the SQL query AST represents DDL as a target-contributed surface the adapter lowers, with marker bootstrap as first consumer.)_

## At a glance

Expand the SQL query AST so `CREATE TABLE` (and Postgres `CREATE SCHEMA`) are **target-contributed** frozen-class nodes lowered by the adapter through a **DDL visitor** — replacing the renderer's closed `switch` over DDL kinds — and build the marker/ledger bootstrap DDL through that path on both Postgres and SQLite so the surface ships with a real consumer.

## Chosen design

Apply the patterns the codebase already uses for migration ops and expressions — **three-layer polymorphic IR** + **frozen-class AST + visitor** — to the query AST's DDL surface.

**Layering (shape — owned by framework/family/target):**

- **Family base** (in `relational-core`): a minimal abstract DDL-node base — `kind`, `accept(visitor)`, `collectParamRefs(): []` (bootstrap DDL is parameterless), `toQueryAst()`. This is the contract the family-level machinery walks; it does **not** enumerate concrete DDL kinds.
- **Target concrete classes** (in the target packages): Postgres ships `CreateTable` + `CreateSchema`; SQLite ships `CreateTable` only. A target contributes exactly the DDL kinds it has. No core `CreateSchemaAst` that SQLite must no-op.
- **DML stays core** (`SelectAst`/`InsertAst`/`UpdateAst`/`DeleteAst`) — target-uniform, unlayered, unchanged.

**Lowering (behaviour — owned by the adapter):**

The renderer stops enumerating DDL kinds in its closed `switch (ast.kind)`. Instead the adapter implements a **DDL visitor** that the DDL node `accept`s (double-dispatch, mirroring `ExprVisitor`). The Postgres adapter's visitor renders `CreateTable`/`CreateSchema`; the SQLite adapter's renders `CreateTable`. The target defines *what*; the adapter defines *how* (dialect SQL, identifier quoting, native-type placement).

**Column modelling (no dialect enum, no bespoke default vocabulary):**

```ts
interface DdlColumn {
  readonly name: string;
  readonly type: string;          // opaque native type, e.g. 'text', 'jsonb', 'INTEGER'
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: ColumnDefault; // the literal | function vocabulary from contract authoring
}
```

The target chooses the native-type string; the adapter quotes/places it. No `ColumnType` enum and no `now`/`empty-collection` default kinds in core.

**Contract-free constructors:** a thin, schema-less surface (beside the AST) that builds these DDL nodes (and passes through the existing DML nodes) from string identifiers and bound params — no contract, no codec inference. This is what makes "express, don't concatenate" cheaper than concatenating; marker bootstrap and (later) the planner use it.

**First consumer — marker bootstrap:** each target's control adapter builds its own marker/ledger `CreateTable` (+ Postgres `CreateSchema`) via the constructors and lowers them through `adapter.lower()`. PG and SQLite build their own (legitimately different) marker DDL; there is **no** shared `family-sql` canonical-column surface.

```
before:  control adapter ─▶ driver.query("CREATE TABLE prisma_contract.marker (…)")   (raw string)
after:   target builds CreateTable node ─lower(visitor)─▶ adapter renders SQL ─▶ driver.execute
```

## Coherence rationale

One reviewer holds it because it is a single mechanism delivered with its first consumer: the AST nodes, the adapter visitor that lowers them, the constructors that build them, and the marker bootstrap that uses them are the minimal set that makes the expanded AST *real and exercised*. Splitting "nodes" from "lowering" from "a consumer" would ship an unused, unvalidated surface — the exact failure mode the project exists to avoid.

## Scope

**In:**
- Family DDL-node base + visitor interface in `relational-core`. _(Note: PR #661's generic-core `CreateSchemaAst`/`CreateTableAst`/`ColumnType`/`ColumnDefault` surface is **absent** on this branch — #661 was closed unmerged and this branch is fresh off `origin/main`. There is nothing to remove; the work is purely additive. The done-condition grep stays as a guard that the rejected surface is never introduced.)_
- Target-contributed `CreateTable` (PG + SQLite) and `CreateSchema` (PG) nodes.
- Adapter DDL-lowering visitor in the Postgres and SQLite adapters; renderer `switch` no longer enumerates DDL kinds; correct identifier quoting + native-type handling.
- Contract-free constructors for the DDL nodes (+ DML pass-through marker bootstrap needs).
- Marker/ledger **bootstrap DDL** built and lowered through this path on both targets, replacing the raw-string bootstrap.

**Out:**
- Marker/ledger **DML** (reads, writes, ledger append), SPI consolidation, invariant-merge convergence — slice `sql-marker-ops-through-adapter`.
- Migration-planner DDL adoption — slice `planner-ddl-adopts-ast`.
- Mongo — slice `mongo-marker-ledger-through-adapter`.
- A user-facing runtime DDL authoring builder.
- DDL beyond `CREATE TABLE`/`CREATE SCHEMA` (`ALTER`, `CREATE INDEX`, constraints, enums) — added when the planner adopts them.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| SQLite has no schemas | By construction | SQLite contributes no `CreateSchema` node; not a core no-op. |
| Identifier quoting | Must fix | PR #661's renderer didn't quote identifiers; the adapter visitor must quote (PG `"…"`, SQLite per its `sql-utils`). |
| `bigserial`/autoincrement dialect skew | Native-type string is the target's choice | Opaque type strings sidestep the PR's neutral-enum→dialect mapping smell; each target emits its own. |
| `IF NOT EXISTS` semantics | Carry on the node | Bootstrap is idempotent; the node carries `ifNotExists`; both dialects support it for tables/schemas. |
| DML golden parity | Guard with fixtures | Converting the renderer switch to visitor dispatch must keep every existing DML lowering byte-identical (`pnpm fixtures:check`). |

## Slice-specific done conditions

- [ ] The visitor/dispatch API (Open Question 1) is settled by the first dispatch and recorded in `design-notes.md` before the rest of the surface is built.
- [ ] `CreateTable` (PG + SQLite) and `CreateSchema` (PG) lower correctly through the adapter on both targets, validated by tests that pin the rendered SQL.
- [ ] No generic-core `ColumnType` enum, `now`/`empty-collection` default vocabulary, or `CreateSchema` core node remains; `git grep` for them returns zero in `relational-core`.
- [ ] The renderer's closed `switch` no longer contains DDL `case`s; DDL lowers via the visitor.
- [ ] Marker/ledger bootstrap DDL is built via the contract-free constructors and lowered through `adapter.lower()` on both targets; no raw `CREATE TABLE` string remains in the bootstrap path.
- [ ] `pnpm fixtures:check` green (DML lowering byte-identical).

## Open Questions

1. **DDL visitor / dispatch API — SETTLED (dispatch 1 spike, validated on `CreateTable` across PG + SQLite).** A separate `DdlNode` hierarchy (`ast/ddl-types.ts`) with `accept(visitor: DdlVisitor)` double-dispatch mirroring `ExprVisitor`; `AnyQueryAst` gains no DDL member; `lower()` input widened to `AnyQueryAst | AnyDdlNode` with an `isAnyDdlNode` guard routing to `renderLoweredDdl` vs the untouched `renderLoweredSql`. Alternatives (kind→renderer table; self-lowering nodes) rejected on spike evidence. Full record + the D2/D3 follow-on (formalize `Adapter<AnyQueryAst | AnyDdlNode>`; relocate concretes to target packages) in `design-notes.md § Open questions`.
2. **Where the family DDL-node base lives.** Working position: `relational-core` (beside the existing AST + `ExprVisitor`); target concrete classes in the target packages, lowering in the adapter packages.
3. **Contract-free constructor home.** Working position: a module in `relational-core` beside the AST; revisit if a dedicated package is cleaner.

## References

- Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
- Design notes: `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md`
- Linear issue: [TML-2761](https://linear.app/prisma-company/issue/TML-2761) (standalone; project "Marker/ledger via typed query AST"; related to TML-2753/2754/2253).
- Patterns: [three-layer polymorphic IR](../../../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md), [frozen-class AST + visitor](../../../../docs/architecture%20docs/patterns/frozen-class-ast.md), [adapter SPI](../../../../docs/architecture%20docs/patterns/adapter-spi.md).
- Superseded: PR #661 (generic-core DDL in `AnyQueryAst`).
