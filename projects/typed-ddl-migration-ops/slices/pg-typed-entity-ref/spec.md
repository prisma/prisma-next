# Slice — `pg-typed-entity-ref` (spec)

**Project:** typed-ddl-migration-ops · **Linear:** TML-2927 · **Branch:** `tml-2927-introduce-a-typed-entity-reference-namespace-entitykind` (off `main`).

## Purpose

Replace the `(schemaName: string | undefined, tableName: string)` string pair carried through the Postgres migration DDL pipeline with a typed **entity reference** — a coordinate `{ namespace, id }` passed around as one value instead of two loose strings. This deletes `bound-schema.ts` and the `isPostgresSchema(ns) ? ns.ddlSchemaName(storage) : namespaceId` fallbacks.

## The design (corrected after the round-2 review)

> The original premise below — "the ref renders its own qualified identifier" — was **wrong** and is superseded. A reference is a coordinate, not a renderer; rendering to SQL is the adapter's job (lowering). See `reviews/pr-877/round-2-entity-ref-usage/`. The first-pass implementation shipped the ref-renders-itself shape; the corrected design walks it back.

**The ref is a pure coordinate.** It carries `{ namespace: <PostgresSchema node>, id: string, parent?: PostgresEntityRef }` and has **no render methods**. `id` (not `name`) is the entity's identifier — it is the dictionary key in `entries[entityKind][id]`, and `name` carried a SQL bias that doesn't belong in a cross-target coordinate. The ref keeps the live namespace **node** (not a `namespaceId` key) because the DDL renderers receive no contract to resolve a key against, and control-plane DDL (`prisma_contract`) operates on namespaces absent from the user contract.

**The adapter owns rendering.** The DDL renderers (`pgRenderCreateTable`/`pgRenderAlterTable`) compose the qualified name from `ref.namespace` + `ref.id` through the **same** composer the query path already uses (`qualifyTableFromNamespaceCoordinate` in `sql-renderer.ts`). `PostgresEntityRef.qualified()` and the `qualifyTableName` rebuild-a-namespace helper are both deleted — they were the IR-renders-SQL inversion in two places.

**`entityKind` is intentionally omitted** — the pipeline only references tables (and columns via `parent`); a kind field that is always `'table'` is speculative until extension/policy (TML-2920 / postgres-rls) need it.

**Call sites stop re-deriving.** The 14 `ref.namespace.id !== UNBOUND_NAMESPACE_ID` sentinel checks in `renderTypeScript` collapse to reading the namespace's authored-schema *data* (a polymorphic property: the schema name, or nothing for unbound). The 17 hand-rolled `"table"."column"` labels stop composing quoted names by hand. The `operations/*.ts` helpers take the ref instead of `(schemaName, tableName)` strings.

**Hydration fix (kept from the first pass):** a non-empty unbound namespace must hydrate as `PostgresUnboundSchema`, not base `PostgresSchema({ id: '__unbound__' })` whose qualifier would leak `"__unbound__"."Doc"`.

## Byte-parity contract (the hard gate)

Every rendering change is **byte-identical** — the unified adapter composer reproduces today's `"schema"."table"` (and unqualified-unbound) output exactly, reusing `quoteIdentifier` (which escapes embedded `"`). `pnpm fixtures:check` zero-diff is the gate on every step.

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
