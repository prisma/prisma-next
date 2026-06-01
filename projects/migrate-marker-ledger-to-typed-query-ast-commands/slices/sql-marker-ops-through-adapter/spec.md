# Slice: SQL DDL AST + contract-free builder (control-table bootstrap is first consumer)

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome this slice contributes: the foundational construction surfaces — a DDL query-AST and a contract-free builder — exist and are validated by their first real consumer, control-table bootstrap, so the marker-write SPI slice has stable surfaces to build on.)_

> **Fan-out note (read first).** The project plan's Slice 1 (`sql-marker-ops-through-adapter`) was authored as one unit covering {contract-free builder + DDL nodes + marker-write SPI + routing + parser/read dedup + invariant convergence}. At `drive-plan-slice` time that fails slice-INVEST *Small* (four distinct outcomes a reviewer cannot hold in one sitting — see Coherence rationale). **This slice is the first of a two-slice fan-out**, matching the boundary the project plan itself anticipated ("builder+nodes, then marker SPI"):
>
> - **This slice (foundation):** DDL AST nodes (`CREATE SCHEMA` / `CREATE TABLE`) + the contract-free builder's **DDL surface** + per-adapter DDL lowering, consumed by routing the marker/ledger **bootstrap DDL** through `adapter.lower()`.
> - **Sibling slice (marker write SPI):** widens the contract-free builder to its **DML surface** (`INSERT`(+`ON CONFLICT`)/`UPDATE`/`SELECT`/`DELETE` from strings+params), adds the `SqlControlAdapter` marker-write methods (`initMarker`/`updateMarker`/`writeLedgerEntry`), routes the marker upsert + ledger insert + sign-path write through the adapter, collapses the three read paths + two `parseContractMarkerRow` copies + the remaining write builders, and converges invariant-merge (SQLite overwrite→merge). The Orchestrator should scaffold this sibling (e.g. `slices/sql-marker-write-spi-and-routing/`) before its build loop.
>
> The directory keeps the planned slug because this slice still delivers "marker bootstrap DDL through the adapter"; the marker *writes* land in the sibling.

## At a glance

Adds two `CREATE SCHEMA` / `CREATE TABLE` nodes to the SQL query AST and a thin **contract-free builder** that constructs them (and, in the sibling slice, DML) from plain string identifiers + bound params with no contract, no codec inference, and no type propagation. The first consumer is control-table bootstrap: the runner's `ensureControlTables` and the family sign-path stop executing hand-written `CREATE …` strings and instead build a DDL AST node lowered via the family/control adapter's `lower()` → driver. Byte-identical SQL out, so golden/fixture parity holds.

## Chosen design

### New AST nodes (in `@prisma-next/sql-relational-core`, `src/ast/types.ts`)

Two frozen `QueryAst` subclasses beside `InsertAst`/`UpdateAst`/`DeleteAst`, following the three-layer frozen-class pattern already used there (`freeze()` in constructor, `rewrite`/`collectParamRefs`/`toQueryAst` overrides, static factory):

```ts
class CreateSchemaAst extends QueryAst {
  readonly kind = 'create-schema' as const;
  readonly name: string;
  readonly ifNotExists: boolean;
  // collectParamRefs() -> []   (DDL is param-free for bootstrap)
}

class CreateTableAst extends QueryAst {
  readonly kind = 'create-table' as const;
  readonly table: { schema?: string; name: string };
  readonly ifNotExists: boolean;
  readonly columns: readonly CreateTableColumn[];   // name + NEUTRAL type + nullability + NEUTRAL default + pk
  // default is a neutral kind (literal | now | empty-collection | autoincrement); renderer maps per dialect
}
```

`CreateTableColumn` carries the column name, a dialect-renderable type/default descriptor, nullability, and primary-key membership — exactly enough to express the marker + ledger tables (the only consumer this slice has). It is **not** a general `CREATE TABLE` grammar; richer DDL is the planner-adoption slice's concern (project non-goal "No general DDL-AST completeness").

**The descriptor is dialect-NEUTRAL; per-dialect resolution lives in the renderer (D2/D3) — REQUIRED, not optional.** One `createTable(...)` call produces **one** AST node that **both** adapters lower differently. This is the design-notes principle ("target-agnostic AST node renders to the target's native wire form in the adapter; dialect idioms live in lowering") and is what lets the D4 bootstrap consumer build a single AST without branching on target (`no-target-branches`). Concretely:

- **Type** is the neutral `ColumnType` (`text` / `text-array` / `jsonb` / `int` / `bigserial` / `timestamptz`). The renderer maps neutral→dialect: Postgres `text[]`/`jsonb`/`timestamptz`/`bigserial`; SQLite collapses `text-array`/`jsonb`/`timestamptz`→`TEXT` and `bigserial`→`INTEGER … AUTOINCREMENT`. Callers never pass a resolved per-dialect type.
- **Default** is a neutral `ColumnDefault` kind, **including a neutral empty-collection kind** (e.g. `{ kind: 'empty-collection' }`) that the renderer maps to Postgres `'{}'` (array literal) and SQLite `'[]'` (json-array string). A bare `lit('{}')` / `lit('[]')` is dialect-specific and is **wrong** here — the invariants column's empty default genuinely differs per dialect and MUST be expressed as the neutral kind so one AST renders correctly in both. `now` likewise maps to `now()` (PG) / `datetime('now')` (SQLite).

The builder's unit tests construct the marker/ledger tables **once** with neutral descriptors — not two dialect-specific variants. (D1 R1 drifted to dialect-specific resolved descriptors + dropped the neutral empty-collection kind; D1 R2 restores the neutral convention. Resolved by the Orchestrator from the project's target-agnostic-AST principle — not a reopenable choice.)

**Canonical marker-AST construction (pinned for the bootstrap-routing dispatch; surfaced during SQLite lowering).** `empty-collection` is specifically the **empty-array** divergence: it renders to Postgres `'{}'` (array literal) and SQLite `'[]'` (json-array text). The marker table has two "empty default" columns that are NOT the same:
- `meta` — empty JSON **object**, dialect-identical (`'{}'` on both). Construct it with `lit("'{}'")`, NOT `emptyCollection()`.
- `invariants` — empty **array**, genuinely divergent (`'{}'` PG / `'[]'` SQLite). Construct it with `emptyCollection()`.

This is the only construction that byte-matches **both** dialects with the D1 vocabulary. (The per-adapter renderer byte-equality tests in the lowering dispatches each validate their dialect's neutral→native mapping; the bootstrap-routing dispatch's end-to-end `fixtures:check` + integration paths are the ground-truth byte-equality gate using the real AST.)

### Bootstrap-routing design (Orchestrator decision — verified against the on-disk SPI)

The marker/ledger **column shape is defined exactly once**, and each target's **control adapter owns its bootstrap sequence**. This is the project's anti-divergence linchpin: the original bug was PG vs SQLite hand-writing the "same" DDL differently in independent places. After this slice there is one column definition and one rendering path.

- **Shared column helpers in `@prisma-next/family-sql`** (legal home — `family-sql` already depends on `@prisma-next/sql-relational-core` and its `control-instance.ts` already imports `sql-relational-core/ast`; `relational-core` exports `./contract-free`): `buildMarkerTableAst(qualifiedName)` and `buildLedgerTableAst(qualifiedName)` build the canonical neutral columns (with `meta: lit("'{}'")`, `invariants: emptyCollection()`), taking the target-specific qualified table name as the only parameter.
- **New `SqlControlAdapter` SPI method `ensureControlTableAsts(): readonly AnyQueryAst[]`** (DDL bootstrap — distinct from the sibling slice's marker *write* DML SPI). Postgres impl: `[createSchema('prisma_contract', { ifNotExists: true }), buildMarkerTableAst('prisma_contract.marker'), buildLedgerTableAst('prisma_contract.ledger')]`. SQLite impl: `[buildMarkerTableAst('_prisma_marker'), buildLedgerTableAst('_prisma_ledger')]` — **no schema node** (SQLite has no schema namespace). The "PG needs a schema, SQLite doesn't" knowledge is encapsulated in the adapters; consumers never branch on target.
- **All three consumers route uniformly:** `for (const ast of controlAdapter.ensureControlTableAsts()) { const { sql, params } = controlAdapter.lower(ast, { contract }); if (sql.length > 0) await driver.query(sql, params); }` — the empty-`sql` skip absorbs SQLite's `create-schema` no-op. The Postgres runner `ensureControlTables`, the SQLite runner `ensureControlTables`, and the `family-sql` `sign` path all adopt this. (The sign path currently runs PG-flavored `ensureSchemaStatement`/`ensureTableStatement` from `sql-runtime` **unconditionally** — a latent SQLite bug; routing through the target's `getControlAdapter().lower()` corrects it without a branch.)

**Dispatch split (Orchestrator, executor-sizing for Composer):** D4 is delivered as two dispatches within this one slice/PR — **D4a** (additive: shared helpers + `ensureControlTableAsts()` SPI + both impls + route the three consumers; the old `ensure*Statement` constants stay in place but go unused; gated on `test:integration` PGlite+SQLite bootstrap green) and **D4b** (delete the now-dead constants + unused exports, repoint the two renderer byte-equality tests off the deleted constants, grep gate + `fixtures:check` clean). The destructive deletion is isolated behind its own review.

`AnyQueryAst` and `queryAstKinds` gain `create-schema` / `create-table` as first-class query kinds (Open Question 1, resolved: DDL is part of the SQL AST; no runtime throw — the renderer renders it, other exhaustive switches gain real handling). Runtime DDL is anticipated as a valid capability; only the user-facing authoring surface is deferred.

### Contract-free builder (DDL surface)

A new schema-less module beside the AST (working position: `@prisma-next/sql-relational-core`, `src/contract-free/` — see Open Question 2 for altitude). It emits the DDL nodes from strings:

```ts
const ast = ddl.createTable('prisma_contract.marker', [
  ddl.col('space', 'text', { primaryKey: true, default: lit(APP_SPACE_ID) }),
  ddl.col('core_hash', 'text', { notNull: true }),
  // …
], { ifNotExists: true });
```

No `context.contract` read, no codec lookup, no `storageHash` branding — the gap the existing contract-bound `sql()` / `Root` builders cannot fill in control-plane contexts. This slice ships only the DDL methods; the DML methods are born in the sibling slice with the marker upsert as their consumer.

### Per-adapter DDL lowering

DDL nodes render in the **shared** SQL renderer that both runtime and control entrypoints already share (`@prisma-next/adapter-postgres` `src/core/sql-renderer.ts`; `@prisma-next/adapter-sqlite` `src/core/adapter.ts`), so `PostgresControlAdapter.lower` and `PostgresAdapterImpl.lower` stay byte-identical (the renderer's existing invariant). Each dialect renders its idioms: Postgres `text[]`/`jsonb`/`timestamptz`/`now()`/`bigserial`; SQLite `TEXT`/`INTEGER PRIMARY KEY AUTOINCREMENT`/`datetime('now')`, no schema qualifier. The lowered output is pinned **byte-equal** to today's hand-written constants (`ensurePrismaContractSchemaStatement`, `ensureMarkerTableStatement`, `ensureLedgerTableStatement` in each target's `statement-builders.ts`; `ensureSchemaStatement`/`ensureTableStatement` in `@prisma-next/sql-runtime` `src/sql-marker.ts`).

### Routing the bootstrap consumer

Before:

```
runner.ensureControlTables ─▶ this.executeStatement(driver, ensureMarkerTableStatement)   // raw string
control-instance.sign      ─▶ driver.query(ensureSchemaStatement.sql, …)                  // raw string
```

After:

```
runner.ensureControlTables ─▶ family.lowerAst(ddl.createTable(…), stubCtx) ─▶ driver.query(lowered.sql, lowered.params)
control-instance.sign      ─▶ adapter.lower(ddl.createSchema(…), stubCtx)  ─▶ driver.query(lowered.sql, lowered.params)
```

`lowerAst` / `lower` already exist on `SqlControlFamilyInstance` / `SqlControlAdapter` and are used by `data-transform.ts` for exactly this pattern (`adapter.lower(plan.ast, { contract })`). Control-plane DDL passes a stub `LowererContext` (`contract` is already typed `unknown`; the renderer has no codec dependency for DDL — confirm per Open Question 3). The fully-superseded `ensure*Statement` constants are deleted so no raw control-table DDL string survives.

## Coherence rationale

One reviewer holds it in one sitting because there is a **single outcome**: *the marker/ledger bootstrap DDL is expressed as an AST node and lowered through the adapter, with byte-identical SQL.* Everything in scope serves that one sentence — the nodes are the expression, the builder is the ergonomic constructor, the lowering is the rendering, the routing is the consumer. The reviewer's correctness check is one property (byte-equality of lowered DDL vs the retired constants) plus one grep (no raw control-table DDL strings remain). The marker *write* path (a second outcome — SPI shape, routing equivalence, invariant semantics) is deliberately the sibling slice so this review does not also have to hold it.

## Scope

**In:**
- `@prisma-next/sql-relational-core`: `CreateSchemaAst` + `CreateTableAst` nodes; `AnyQueryAst`/`queryAstKinds` extension; the contract-free builder **DDL surface** (new module).
- `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite`: DDL lowering in the shared renderer, exposed through the control adapter's `lower`.
- `@prisma-next/target-postgres` + `@prisma-next/target-sqlite` (runners) and `@prisma-next/family-sql` (sign path in `control-instance.ts`): route `ensureControlTables` / sign-path schema+table creation through the builder → `lower()` → driver; delete the superseded `ensure*Statement` constants.

**Out:**
- Contract-free builder **DML surface** (`INSERT`/`ON CONFLICT`/`UPDATE`/`SELECT`/`DELETE` from strings) — sibling slice.
- Marker-write SPI (`initMarker`/`updateMarker`/`writeLedgerEntry`), marker upsert + ledger insert routing, the sign-path *marker write* (`writeContractMarker`), the three `buildMergeMarkerStatements`/`writeContractMarker`/`buildWriteMarkerStatements` builders — sibling slice.
- Read-path + `parseContractMarkerRow` dedup, invariant-merge convergence (SQLite overwrite→merge) — sibling slice.
- Mongo family (parallel project slice). Migration-planner DDL adoption (project Slice 2).
- General `CREATE TABLE`/`ALTER`/`CREATE INDEX` grammar beyond what the marker + ledger tables need.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Adding DDL kinds to `AnyQueryAst` forces every `lower()`/renderer switch to gain a branch | In scope — design decision (resolved), not discovery | DDL is a first-class query kind (Open Question 1, resolved). Each exhaustive `ast.kind` switch gains **real** handling — render the DDL, `collectParamRefs() -> []`, `rewrite` identity — **not** a throw. The runtime renderer renders DDL like any kind. Surface any visitor that can't sensibly handle DDL to the Orchestrator. |
| Byte-exact reproduction of existing DDL strings (whitespace, `IF NOT EXISTS`, default literals, `bigserial` vs `INTEGER … AUTOINCREMENT`) | In scope — it is the slice's correctness property | Golden/fixture parity (`fixtures:check`) and a per-dialect byte-equality test are the gate. Any intentional whitespace normalization must be matched in the retired-constant comparison test. |

## Slice-specific done conditions

- [ ] A per-dialect test pins the lowered DDL byte-equal to the retired `ensure*Statement` constants (Postgres + SQLite), and the grep gate `rg -i "create (table|schema)" packages/3-targets … packages/2-sql/5-runtime/src` returns no raw control-table DDL outside the renderer/tests.

## Open Questions

1. **DDL nodes in `AnyQueryAst` vs a sibling `AnyDdlAst` union. — RESOLVED (operator): extend `AnyQueryAst`; DDL is a first-class query kind; NO runtime throw.** `create-schema`/`create-table` are valid members of the SQL query AST, lowerable anywhere a query is. The deciding rationale: applications may legitimately issue DDL at runtime (multi-tenant provisioning, dynamic/temp tables) — no less likely than a raw SQL statement containing DDL — so excluding DDL from the AST now would make it much harder to add later. We model DDL as a valid AST kind **now**; the user-facing *authoring* surface for runtime DDL is deferred (this slice's only consumer is control-plane bootstrap), but the type does not foreclose it. Consequence: the shared renderer renders DDL like any other kind (no throw), and exhaustive switches over `AnyQueryAst` gain **real** DDL handling (`collectParamRefs() -> []`, `rewrite` identity, render), not a `RUNTIME.*` throw. If a particular `AnyQueryAst` visitor genuinely cannot give DDL a sensible handling, surface it to the Orchestrator rather than defaulting to a throw.
2. **Contract-free builder altitude.** A module in `@prisma-next/sql-relational-core` beside the AST vs a dedicated builder package. Working position: **module in `sql-relational-core` (`src/contract-free/`)**, widened (not relocated) in the sibling slice; promote to its own package only if `lint:deps` layering forces it.
3. **Stub `LowererContext` for DDL.** Working position: **a stub `{ contract: undefined }` suffices** — the renderer has no codec dependency for DDL nodes (no `ParamRef`/codec resolution on param-free `CREATE …`). Confirm by lowering a DDL node with an empty context in the byte-equality test.

## References

- Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`; design record `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md`.
- Linear issue: TML-2753 (project slice). Project: [Marker/ledger via typed query AST](https://linear.app/prisma-company/project/markerledger-via-typed-query-ast-dc62ab25d151).
- Relevant ADRs: 021 (marker storage), 043 (advisory lock + transactional DDL), 198 (runner decoupled via visitor SPIs), 205 (execution metadata on AST), 212 (contract spaces). A new ADR for the DDL-AST + marker-write SPI is expected at the sibling slice / project close-out.
- Surfaces verified: `ast/types.ts` (`AnyQueryAst` L1876, `queryAstKinds` L1903, `InsertAst`/`UpdateAst`/`DeleteAst`/`RawSqlExpr`); shared renderer `adapter-postgres/src/core/sql-renderer.ts`; control lowering `adapter-postgres/src/core/control-adapter.ts` + `adapter-sqlite/src/core/adapter.ts`; bootstrap constants in `target-postgres`/`target-sqlite` `statement-builders.ts` + `sql-runtime/src/sql-marker.ts`; routing sites `target-{postgres,sqlite}/src/core/migrations/runner.ts` `ensureControlTables`, `family-sql/src/core/control-instance.ts` `sign`; lowering precedent `target-postgres/src/core/migrations/operations/data-transform.ts`.
