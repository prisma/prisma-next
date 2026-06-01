# Slice `ddl-in-query-ast` — Dispatch plan

**Slice spec:** `./spec.md`

_Authored at slice pickup; refine as dispatches land. The first dispatch is the in-slice spike that settles the load-bearing visitor/dispatch API before the rest of the surface is built._

### Dispatch 1: spike — settle the DDL visitor/lowering seam

- **Outcome:** A thin vertical proof that a target-contributed `CreateTable` node lowers to correct dialect SQL through an adapter-owned visitor on **both** Postgres and SQLite, with the DML renderer switch untouched. The chosen API (DDL visitor double-dispatch vs widened `lower()` input vs kind→renderer table) is decided and recorded in `design-notes.md`.
- **Builds on:** The spec's chosen design; `ExprVisitor`/frozen-class machinery as the reference.
- **Hands to:** A settled lowering-seam API the remaining dispatches build against.
- **Focus:** Mechanism only — one node, two targets, end-to-end (`lower()` → string). May be partly throwaway; its job is to retire Open Question 1.

### Dispatch 2: family DDL-node base + target concrete nodes

- **Outcome:** The family DDL-node base (`kind`/`collectParamRefs`; no global visitor/accept) is formalized in `relational-core`; Postgres ships per-target `PostgresDdlVisitor` + `PostgresCreateTable` + `PostgresCreateSchema`, SQLite ships `SqliteDdlVisitor` + `SqliteCreateTable`, **in the target packages** (target owns shape), with column modelling as opaque native-type strings + `ColumnDefault` defaults from `@prisma-next/contract/types`. Adapters route via `isAnyDdlNode` → per-target visitor. _(No PR #661 generic-core surface on this branch — additive only. Shared `Adapter` interface type-param formalization deferred.)_
- **Builds on:** Dispatch 1's settled API + committed skeleton (`d5b19d0af`).
- **Hands to:** The target-contributed DDL node surface.
- **Focus:** Node shape + layering only; lowering wired minimally to keep it compiling.

### Dispatch 3: adapter DDL-lowering visitor (PG + SQLite)

- **Outcome:** The Postgres and SQLite adapters implement the DDL visitor with correct identifier quoting and native-type handling; the renderer's closed `switch` no longer enumerates DDL kinds; tests pin rendered SQL for `CreateTable`/`CreateSchema`; `pnpm fixtures:check` confirms DML lowering byte-identical.
- **Builds on:** Dispatch 2's node surface.
- **Hands to:** The adapter DDL-lowering seam (the stable surface slices 2 and 4 consume).
- **Focus:** Lowering behaviour; dialect correctness; DML parity.

### Dispatch 4: contract-free constructors

- **Outcome:** A schema-less constructor surface beside the AST builds the DDL nodes (and passes through the DML nodes) from string identifiers + bound params, no contract.
- **Builds on:** Dispatch 2's node surface.
- **Hands to:** The contract-free construction path marker bootstrap and the planner use.
- **Focus:** Ergonomic construction only.

### Dispatch 5: marker/ledger bootstrap through the adapter (first consumer)

- **Outcome:** Each target's control adapter builds its marker/ledger bootstrap DDL via the constructors and lowers it through `adapter.lower()`, replacing the raw-string bootstrap. No `CREATE TABLE` string remains in the bootstrap path. _(The rejected shared `family-sql` `control-tables.ts`/`buildMarkerTableAst` surface does not exist on this branch; build the bootstrap fresh per target — PG and SQLite each own their marker DDL.)_
- **Builds on:** Dispatches 3 + 4.
- **Hands to:** A validated, adapter-lowered DDL surface with marker bootstrap proving it.
- **Focus:** Bootstrap DDL only; marker DML/SPI consolidation is the next slice.
