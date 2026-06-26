# Slice — `pg-typed-entity-ref` (spec)

**Project:** typed-ddl-migration-ops · **Linear:** TML-2927 · **Branch:** `tml-2927-introduce-a-typed-entity-reference-namespace-entitykind` (off `main`).

## Purpose

Replace the `(schemaName: string | undefined, tableName: string)` string pair carried through the Postgres migration DDL pipeline with a typed **entity-reference** node. The reference carries the live namespace node and renders its own qualified identifier; the renderer asks it to render itself instead of composing `"schema"."table"` from strings. This deletes `bound-schema.ts` and the three `isPostgresSchema(ns) ? ns.ddlSchemaName(storage) : namespaceId` fallbacks.

## The design (settled at grounding — not a spike)

**The ref carries the live namespace node, not a resolved schema-name string.** Rendering delegates to the node's existing bound/unbound polymorphism, so the qualified-vs-unqualified decision lives in one place (the node) and is reached through the ref. This is what makes both the sentinel re-mapping (`bound-schema.ts`) and the three `ddlSchemaName`-fallback helpers dead — the planner hands the node to the ref instead of pre-resolving a string id.

**Entity coordinate, not table-specific** (frozen-class / visitor over entity kind):

- **Schema-qualified base** (tables, indexes, sequences, types, views): renders `"<schema>"."<name>"`, unqualified for the unbound namespace.
- **Columns** nest a parent table ref: `"<schema>"."<table>"."<column>"`.
- **Extensions** (TML-2920) and **RLS policies** (postgres-rls project) slot in later — extension overrides to database-global `"<name>"`; policy nests its table. **This slice implements table + column kinds only**, but the class family must be shaped so those slot in without reopening the base.

**Hydration fix is a hard prerequisite** (see below): a non-empty unbound namespace currently hydrates as base `PostgresSchema({ id: '__unbound__' })`, whose `qualifyTable` would render `"__unbound__"."Doc"`. The ref-carries-node design surfaces that bug, so the fix lands in this slice.

## Byte-parity contract (the hard gate)

The ref's qualified rendering must be **byte-identical** to today's renderer composition (`control-adapter.ts` ~1493/1520):

```
node.schema ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}` : quoteIdentifier(node.table)
```

So the ref's render must reuse **`quoteIdentifier`** semantics (escapes embedded `"`), **not** `PostgresSchema.qualifyTable`'s lighter raw interpolation (`"${id}"`). Both `quoteIdentifier` and the ref live in the postgres target package — no layering inversion. The ref asks the node for the bound/unbound decision + schema name; it applies `quoteIdentifier` itself. `pnpm fixtures:check` zero-diff is the gate.

## In scope

### 1. Hydration fix (foundation)

`postgres-contract-serializer.ts` `hydrateSqlNamespaceEntry` (~L93): hydrate **any** `id === UNBOUND_NAMESPACE_ID` slot as `PostgresUnboundSchema` carrying its entries — not only the empty `emptyTables && !hasValueSets` case. `PostgresUnboundSchema`'s constructor already accepts `input?` and passes it through to super, so `new PostgresUnboundSchema({ id, entries })` carries tables. Keep the empty case returning the `PostgresSchema.unbound` singleton (identity-stable) if it round-trips; otherwise a fresh unbound is fine. **Verify** the `emptyTables && !hasValueSets` condition wasn't doing other round-trip work.
- **Test:** a non-empty unbound namespace (tables, no explicit schema) round-trips through emit→hydrate and renders **unqualified** DDL (`CREATE TABLE "Doc"`, never `"__unbound__"."Doc"`).

### 2. Entity-ref class family (foundation)

New frozen-class / visitor family in the postgres target package:
- `PostgresEntityRef` abstract base + visitor; `accept<R>()`, `qualified(): string`.
- `PostgresTableRef` — carries `{ namespace: PostgresSchema, name: string }`; `qualified()` reuses `quoteIdentifier` and the node's bound/unbound decision (byte-parity contract above).
- `PostgresColumnRef` — carries `{ table: PostgresTableRef, column: string }`; `qualified()` = `table.qualified() + '.' + quoteIdentifier(column)`.
- Factory methods on `PostgresSchema`: `tableRef(name)`, `columnRef(table, column)` (so the planner builds refs from the node it resolves).
- **Tests:** bound table, unbound table (unqualified), column on bound + unbound — byte-parity unit assertions.

### 3. Thread the ref end-to-end + delete the dead string machinery

- **`*Call` IR** (`op-factory-call.ts`): every PG `*Call` replaces `(schemaName, tableName)` with the entity ref. (~20 classes — table-level Calls carry a `PostgresTableRef`; column-level Calls a `PostgresTableRef` + column name or a `PostgresColumnRef`.)
- **Planner construction** (`issue-planner.ts`, `planner-strategies.ts`, `planner-recipes.ts`, `postgres-migration.ts`): build refs from the resolved namespace node. `resolveDdlSchemaForNamespace` (the string-returning resolver) is replaced by resolving the node + building a ref.
- **Contract-free builders** (`contract-free/ddl.ts` `createTable`/`alterTable`) + **AST nodes** (`PostgresCreateTable`/`PostgresAlterTable`): carry the ref instead of `{ schema?, table }`.
- **Adapter renderer** (`control-adapter.ts` ~1493/1520): ask `ref.qualified()`; delete the `node.schema ? … : …` composition.
- **Marker bootstrap** (`contract-free/control-bootstrap.ts`): build refs from the `prisma_contract` schema instead of dot-literal `schema: 'prisma_contract', table: 'marker'/'ledger'`.
- **Delete** `bound-schema.ts` + all `boundSchema()` call sites; **delete** the three `isPostgresSchema(ns) ? ns.ddlSchemaName(storage) : namespaceId` fallbacks (`control-policy.ts`, `planner-strategies.ts`, `verify-postgres-namespaces.ts`) — the ref/node makes them dead.
- Still-raw `operations/*.ts` ops keep their raw SQL **bodies** (their own tickets convert those); only their table-naming switches from string composition to `ref.qualified()`.

## Out of scope

- Extension ref kind (TML-2920) and policy ref kind (postgres-rls) — design the family to admit them; don't implement.
- SQLite mirror — decide per-target vs family-hoisted when SQLite slices (TML-2921/2922) pick this up; this slice is PG-only.
- Converting still-raw `operations/*.ts` SQL bodies to typed DDL (their own tickets).
- The un-namespaced-PG→unbound resolution behaviour (TML-2916) — preserve it; don't change resolution.

## Done conditions

- `*Call` IR carries entity-ref nodes, not `(schemaName, tableName)` strings (PG side); `git grep 'schemaName'` under `postgres/.../migrations/` returns only genuinely-needed residue (e.g. catalog-filter SQL), no Call-IR fields.
- Contract-free builders + `PostgresCreateTable`/`PostgresAlterTable` carry refs, not `{ schema?, table }`.
- The renderer asks `ref.qualified()` — no `schema ? quote(schema).quote(table) : quote(table)` composition in the renderer.
- Marker bootstrap constructs refs, not dot-literal strings.
- `bound-schema.ts` deleted (`git grep boundSchema` empty); the three `ddlSchemaName`-string fallbacks deleted.
- Non-empty unbound namespace hydrates as `PostgresUnboundSchema` and renders unqualified.
- **Gates:** fresh workspace `pnpm typecheck`; target-postgres + adapter-postgres + pgvector tests; family-sql control-policy/verifier suites; `pnpm test:integration`; `pnpm fixtures:check` (byte-parity); `pnpm lint:deps`; cast ratchet delta 0.

## Notes

- The ref carries a **live node reference**, not JSON — DDL AST nodes are lowered to `{sql, params}` and only the SQL string reaches `ops.json`, so referencing the storage node introduces no serialization cycle.
- Test corpus must build namespaces via `postgresCreateNamespace` (production factory), never the framework `buildSqlNamespace` helper — a named namespace built the wrong way is a data structure impossible in production.
- `PostgresSchema.qualify(name)` was introduced + reverted in #840 (`cadcc53e0` + `a174ecbe7`); the ref's own render supersedes it — do not resurrect it.
