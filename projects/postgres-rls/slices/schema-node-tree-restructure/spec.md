# Slice 2: schema-node-tree-restructure

Parent project: `projects/postgres-rls/` ([spec](../../spec.md) · [plan](../../plan.md)). Linear: new top-level ticket (TBD), blockedBy TML-2931, blocking TML-2869.

Audience: an implementer with no prior context. The design is stated first and is prescriptive — names, hierarchy, field placement, and consumer wiring are fixed. § Requirements names the properties the design satisfies; each unit and acceptance criterion cites them. § Alternatives records rejected options — read it only for rationale; it does not describe what to build.

## Decision

Replace the single `PostgresSchemaIR` — today simultaneously a diff-tree node, a Postgres schema, and the tree root — with a **five-class schema-diff tree** that mirrors Postgres's object hierarchy, **separate those diff nodes from the authored Contract-IR entities**, make **introspection return the tree**, and move **database→PSL inference onto the Postgres target** (where it belongs — it currently sits in SQL-family code hardcoding Postgres types).

```
PostgresDatabaseSchemaNode          root — children: namespaces; also holds roles (not yet diffed)
└── PostgresNamespaceSchemaNode     one per Postgres schema — children: tables
    └── PostgresTableSchemaNode     children: policies
        └── PostgresPolicySchemaNode  leaf
PostgresRoleSchemaNode              leaf, on the root (a sibling of namespaces, never under a table)
```

**No behaviour change.** `migration plan` / `db init` / `db update` / `db verify` and `contract infer` output are byte-for-byte unchanged; SQLite and Mongo are untouched. This is a purely structural slice — its value is that slices 3–4 build on a clean tree.

## Requirements

- **R1 — one job per node.** No class is a tree node *and* a schema *and* the root.
- **R2 — diff nodes ≠ Contract-IR entities.** The diff nodes (walked by the differ, never serialized) are distinct classes from the authored, serialized Contract-IR entities — the split tables already have (`StorageTable` vs `PostgresTableIR`).
- **R3 — the tree mirrors Postgres.** database → namespace → table → policy; roles are database-level leaves.
- **R4 — roles carried, not yet diffed.** Populated on the root, but the root's `children()` excludes them this slice (role diffing is slice 4).
- **R5 — the namespace level is real.** Tables are grouped under their owning namespace, not flattened into one bare-keyed record. This removes the current silent cross-schema table-name collision in introspection.
- **R6 — only the differ and planner are structure-aware.** They `ensure` the target node and walk the tree. **Verify** asks them for issues and asserts they're empty; the **schema view** walks a generic tree of printable nodes. Neither verify nor the view interrogates the schema-IR structure, so neither changes. No flat-read of the root, no shim, no dual representation.
- **R7 — inference is target logic.** Database→PSL inference walks the tree and owns the Postgres type/default maps, on the Postgres **target** (not the family, not the communication adapter). The framework keeps the `PslDocumentAst` view and the `printPsl` printer. No SQL-family code references Postgres types.
- **R8 — names say which tree.** Diff nodes carry the `…SchemaNode` suffix. Bare `…IR` is dropped — the repo has several IRs.
- **R9 — behaviour-neutral.** Migration and `contract infer` output byte-identical; SQLite + Mongo untouched.

## Design

### Two class families (R1, R2)

**Contract-IR entities** — authored, validated, serialized into `contract.json`, registered as entity kinds, extend `SqlNode`. `PostgresRlsPolicy` / `PostgresRole` **keep their names**, **lose `DiffableNode`** (delete `id` / `children()` / `isEqualTo()` and the `implements`), and **move out of `schema-ir/`** to sit with the other Postgres contract-IR / entity-kind definitions (`entity-kinds.ts`, `postgres-schema.ts`). Their entity-kind registration, validators, `kind`, and `freezeNode` are unchanged. The guards `isPostgresRlsPolicy` / `assertPostgresRlsPolicy` move with them and afterward have only Contract-IR callers.

**Schema nodes** — derived, walked by the differ, never serialized, implement `DiffableNode`, live in `schema-ir/`. After this slice these five classes are the only residents of `schema-ir/` and the only `DiffableNode` implementors in the target.

### The five schema-node classes

All extend `SqlSchemaIRNode` directly and call `freezeNode(this)` at the end of their constructor (the `SqlTableIR`-freezes-in-its-constructor wart is carried, see § Alternatives).

| Class | `id` | `isEqualTo` | `children()` | Carries |
| --- | --- | --- | --- | --- |
| `PostgresDatabaseSchemaNode` (root) | `'database'` (no siblings; never emitted) | `true` | `Object.values(this.namespaces)` — **namespaces only** (R4) | `namespaces`, `roles`, `existingSchemas`, `pgVersion` |
| `PostgresNamespaceSchemaNode` | `this.schemaName` | `true` | `Object.values(this.tables)` | `schemaName`, `tables`, `nativeEnumTypeNames` — **and whatever the per-schema `SqlSchemaIR` interface requires** so the legacy per-schema consumers (R6) take it unchanged |
| `PostgresTableSchemaNode` (rename of `PostgresTableIR`) | `this.name` | `true` (table-attr diffing is slice 3) | `this.policies` | the `SqlTableIR` fields + `policies: readonly PostgresPolicySchemaNode[]` (renamed from `rlsPolicies`) |
| `PostgresPolicySchemaNode` (new) | `this.name` | wire-name equality¹ | `[]` | `name`, `prefix`, `tableName`, `namespaceId`, `operation`, `roles`, `using?`, `withCheck?`, `permissive` |
| `PostgresRoleSchemaNode` (new) | `this.name` | name equality | `[]` | `name`, `namespaceId` |

Each class exposes its guard as a **static `is()` method** (e.g. `PostgresTableSchemaNode.is(node)`), replacing the free `isPostgresTableIR` etc. The root's `is()` narrows on the enumerable `nodeTarget === 'postgres'` discriminant the current `isPostgresSchemaIR` uses (it must survive the `projectSchemaToSpace` spread); the root also ships static `assert()` / `ensure()` (the `ensure` reconstructs from a spread-flattened plain object, replacing `ensurePostgresSchemaIR`).

The new nodes carry **no `annotations.pg` bag** (obsolete — [annotations-bag-is-obsolete]); enum names are the typed `nativeEnumTypeNames` field.

¹ Wire-name equality, unchanged rationale: the name is `<prefix>_<sha256(body)[0..8]>`, so name-equality is body-equality; never byte-compare predicate bodies (Postgres reprints them).

### Producers build the tree (R3, R5)

- **Projection** (`contract-to-postgres-schema-ir.ts` → renamed `contract-to-postgres-database-schema-node.ts` / `contractToPostgresDatabaseSchemaNode`): group tables by owning namespace; per namespace build a `PostgresNamespaceSchemaNode` holding its `PostgresTableSchemaNode`s and their `PostgresPolicySchemaNode`s (built from the `PostgresRlsPolicy` contract entities; DDL schema resolved once per namespace via `resolveDdlSchemaForNamespaceStorage`). Roles → `PostgresRoleSchemaNode[]` on the root. Preserve the malformed-contract assert (policy whose table is absent throws).
- **Introspection** (`control-adapter.ts`): the `new PostgresSchemaIR(...)` sites build the tree; the multi-schema merge that flattened per-schema IRs into one bare-keyed record (keeping only `first.pgSchemaName`) is **replaced** by a `PostgresDatabaseSchemaNode` with one namespace node per schema (R5). `introspect()` returns `PostgresDatabaseSchemaNode`.

### Consumers (R6)

`introspect()` returns a **node** — the target's schema root (generic type, **not** `SqlSchemaIR`; SQLite returns its own node from the same method). Only the **differ** and the **planner** are structure-aware: they `ensure` the concrete target node and walk the tree, exactly as the planner already does with `options.schema: unknown` + `ensurePostgres…`. Nothing else reads the schema's structure; nothing branches on a "uniform view"; SQLite is untouched.

- **The differ + the planner** (`diff-postgres-schema.ts`, `planner.ts`): `ensure` the `PostgresDatabaseSchemaNode` and walk the whole tree. Guards switch `isPostgresRlsPolicy` → `PostgresPolicySchemaNode.is`. `filterIssuesByOwnership` still reads `i.actual.namespaceId` off the policy node — unchanged. The policy-issue `path` gains a namespace segment (`[ 'database', schemaName, tableName, policyName ]`); the `policy "name" on "schema"."table"` message is preserved. No production code reads `path` positionally.
- **Verify and `toSchemaView` need no change.** Verify asks the differ/planner for issues and asserts they're empty — it never walks the tree. `toSchemaView` walks a generic tree of printable nodes and is already agnostic to the schema-IR structure. (The legacy relational diff stays side-by-side until follow-on A ports it onto the generic differ; it is part of the diff machinery — it `ensure`s and walks the target node like the planner, not a separate flat reader.)

### Inference moves to the Postgres target (R7)

Database→PSL inference is target logic — it walks the tree and knows Postgres's type/default mappings. Today it lives in SQL-family code (`sqlSchemaIrToPslAst`) hardcoding `createPostgresTypeMap` / `createPostgresDefaultMapping` — a layering violation.

- The **Postgres target descriptor** gains `inferPslContract(tree): PslDocumentAst`, beside its existing `contractSerializer`. It walks the tree (one `PslNamespace` per namespace node; each table node → a `PslModel`) and owns the Postgres type/default maps, which **move from `2-sql/9-family/psl-contract-infer/` into the Postgres target**. (Top-level entities — policies/roles → extension-block entries — are a later slice; this slice emits the same relational-only PSL as today.)
- The **family instance's `inferPslContract`** ([control-instance.ts:892](../../../../packages/2-sql/9-family/src/core/control-instance.ts)) delegates to the target's method (read off `target`, like `targetSerializer`). It still satisfies `PslContractInferCapable`; absent when a target doesn't provide it (Mongo).
- **Delete** `sqlSchemaIrToPslAst` and the flat document walker `buildPslDocumentAst`. The genuinely shape-neutral leaf transforms (name transforms, relation inference, `mapDefault`, the `PslTypeMap` types) become plain **utility functions** the Postgres target imports — not on the control instance. The Postgres tree-walk replaces the flat `.tables` iteration.
- The **framework** keeps `PslDocumentAst` + `printPsl`; the **control adapter** is untouched (inference is not communication).

## Units (build order)

Nodes first (new vocabulary), then producers/consumers/inference (depend on the nodes).

1. **Leaf split** (R1, R2) — strip `DiffableNode` from `PostgresRlsPolicy`/`PostgresRole`, move them out of `schema-ir/` to the Postgres contract-IR home; add `PostgresPolicySchemaNode` / `PostgresRoleSchemaNode` in `schema-ir/`.
2. **Table node rename** (R8) — `PostgresTableIR` → `PostgresTableSchemaNode` (+ `Input`, guard); field `rlsPolicies` → `policies`.
3. **Namespace node** (R3, R5, R6) — new `PostgresNamespaceSchemaNode`, shaped to satisfy the per-schema `SqlSchemaIR` interface.
4. **Database root** (R1, R3, R4) — new `PostgresDatabaseSchemaNode` (+ guard/assert/ensure), replacing `PostgresSchemaIR`.
5. **Producers** (R3, R5) — projection + introspection build the tree; `introspect()` returns the root.
6. **Consumers** (R6) — the differ + planner `ensure` the root and walk it; the legacy verify / relational planning / view operate on a namespace node; `introspect()` returns a generic node and each consumer `ensure`s the target type.
7. **Inference to target** (R7) — move the maps + projection to the Postgres target descriptor; family delegates; delete the flat walker; leaf transforms become utilities.

## Tests (write first)

- New node tests (`postgres-database-schema-node.test.ts`, `…-namespace-…`, `…-policy-…`, `…-role-…`): `id` / `isEqualTo` / `children` per the table; the root's `children()` returns **namespaces, not roles** (R4); a namespace node satisfies the per-schema `SqlSchemaIR` shape (R6).
- `rls-diffable-nodes.test.ts`: rebuilt; assert `PostgresRlsPolicy`/`PostgresRole` are **not** `DiffableNode` (R2).
- `diff-postgres-schema.test.ts`: fixtures build the nested tree; policy path now `[ 'database', schemaName, tableName, policyName ]`; all current behaviours hold (same-wire-name-on-two-tables, initial-migration missing-policy, multi-schema unbound→public, ownership at the caller, the message).
- Projection/planner/introspection/walking-skeleton suites rebuilt for the tree; `migration plan` still emits `ENABLE RLS` + `CREATE POLICY`.
- **Legacy relational `planner.*.test.ts` + `verify-postgres-namespaces.test.ts` + the `toSchemaView` path**: fed namespace nodes; **expected output unchanged** (R6, R9).
- **`contract infer` fixtures**: unchanged output, proving target-owned inference reproduces today's PSL (R7, R9).

## Acceptance criteria

- **AC-1 (R1, R8)** The five `…SchemaNode` classes are the only residents of `schema-ir/` and the only `DiffableNode` implementors in the target.
- **AC-2 (R2)** `PostgresRlsPolicy`/`PostgresRole` are Contract-IR only — no `DiffableNode`, out of `schema-ir/`, still entity kinds, `contract.json` byte-identical.
- **AC-3 (R3, R5)** The tree is database → namespace → table → policy, roles on the root and not in `children()`; no cross-namespace flattening; the old merge's collision is gone.
- **AC-4 (R6)** The relational verify/planner/view logic is unchanged and operate on a namespace node; nothing flat-reads the root; no shim and no second representation.
- **AC-5 (R7)** Inference runs on the Postgres target descriptor; no SQL-family file imports Postgres type/default maps; `sqlSchemaIrToPslAst` and the flat walker are deleted; framework `PslDocumentAst` + `printPsl` and the adapter are untouched.
- **AC-6 (R9)** Migration + `contract infer` output byte-identical; SQLite + Mongo untouched. Full gate set green: build, `typecheck --force`, `turbo run lint`, `lint:deps`, `lint:casts`, `check:upgrade-coverage --mode pr`, `fixtures:check`, all suites.

## Alternatives considered

Captured so the rejected paths are not re-litigated. None is what we build.

- **Flat accessors on the root** (`get tables()` flattening namespaces). Rejected (R6): bolts the old flat-schema shape back onto the clean node — the conflation disguised as a getter.
- **A `toLegacyFlatPostgresSchema` adapter / a tree→flat "projection seam" for the legacy consumers.** Rejected: a `PostgresNamespaceSchemaNode` *is* the per-schema `SqlSchemaIR` shape, so the legacy consumers take a namespace node directly. No conversion exists.
- **Make the family `SqlSchemaIR` itself a namespace tree** (SQLite = one namespace). Unnecessary — the legacy consumers take an unchanged-shape namespace node; no family/SQLite reshape.
- **Fold relational diffing into the generic differ** (give table/column nodes real `isEqualTo`). That is follow-on A (the relational port); not needed here. The legacy relational verify/planner keep hand-rolling their diff, just fed a namespace node.
- **Keep inference in the family / add an inference method to `SqlControlAdapter`.** Wrong layer: inference is target logic (no DB I/O), so it lives on the target descriptor — not in shared family code (the current layering violation) and not on the communication adapter.
- **Rename the policy/role leaves to `…SchemaNode` and leave them dual-purpose.** Rejected (R2): they're the authored, serialized Contract-IR entities; naming them `…SchemaNode` mislabels them. Split instead.
- **Fix the `freezeNode`-in-constructor wart** so nodes extend `SqlTableIR`/`SqlSchemaIR`. A family-base change touching SQLite; orthogonal; carried deliberately.
- **TS contract inference now.** Out of scope and doesn't exist (only `PslContractInferCapable`, PSL-only). The target-owned, format-specific design accommodates a future `inferTsContract` sibling walking the same tree; not built here.
