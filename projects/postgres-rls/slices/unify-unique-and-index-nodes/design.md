# Design: unique constraints and indexes are separate structural nodes

## The one principle

**One schema-IR node per schema element. The differ compares two derived schema-IR trees structurally and does nothing else** — it never transforms, normalizes, dedupes, or reconciles either tree to make the verdict come out a particular way. If a matched pair is not `isEqualTo`, or a node on one side has no partner on the other, that *is* the diff result. Full stop.

Everything below follows from that principle. Where the current `main` violates it (a pre-diff pass that massages the actual tree to fake "satisfaction"), we delete the violation. We do **not** add new machinery.

## The elements

A relational table's children are each a distinct schema element with its own node kind. This is already true for columns, primary keys, foreign keys, and check constraints. Unique constraints and indexes are **two of these peers, not one merged node**:

| Element | Node | Catalog | Created / dropped by |
| --- | --- | --- | --- |
| column | `SqlColumnIR` | `pg_attribute` | ADD/DROP COLUMN |
| primary key | `PrimaryKey` | `pg_constraint` (p) | ADD/DROP CONSTRAINT |
| foreign key | `SqlForeignKeyIR` | `pg_constraint` (f) | ADD/DROP CONSTRAINT |
| **unique constraint** | **`SqlUniqueIR`** | `pg_constraint` (u) | `ADD CONSTRAINT … UNIQUE` / `DROP CONSTRAINT` |
| **index** | **`SqlIndexIR`** | `pg_index` (not owned by a constraint) | `CREATE INDEX` / `DROP INDEX` |
| check | `SqlCheckConstraintIR` | `pg_constraint` (c) | ADD/DROP CONSTRAINT |

A unique constraint and an index are **different schema elements** — different catalog, different DDL, independent lifecycle. They are never merged into one node and there is no `constraint` flag on the index node. A **unique index** (`CREATE UNIQUE INDEX`, no owning constraint) is a *kind of index*, carried by `SqlIndexIR.unique = true`; a **unique constraint** is a constraint, carried by `SqlUniqueIR`. These are genuinely three representable, distinct catalog states: plain index (`SqlIndexIR{unique:false}`), standalone unique index (`SqlIndexIR{unique:true}`), unique constraint (`SqlUniqueIR`).

A unique constraint owns a private backing index in `pg_index`. We do **not** model that backing index as a separate `SqlIndexIR` — the constraint node represents the whole unit (you cannot `DROP INDEX` a constraint's backing index; you `DROP CONSTRAINT`). Introspection's existing exclusion of constraint-backing indexes is correct catalog modeling, **not** massaging, and stays.

## Node identity and equality (both as on `main`, made purely symmetric)

- `SqlUniqueIR`: `id = "unique:<cols>"`; `isEqualTo` compares its own attributes — columns are in the id and a unique constraint carries nothing else worth diffing, so `isEqualTo` is id-identity.
- `SqlIndexIR`: `id = "index:<cols>"`; `isEqualTo` is **symmetric structural equality**: `this.unique === node.unique && this.type === node.type && indexOptionsLooselyEqual(this.options, node.options)`. Remove the `(!this.unique || node.unique)` "stronger-satisfies-weaker" rule — a unique index and a non-unique index on the same columns are different objects and are not equal. Keep `indexOptionsLooselyEqual` (introspection stringifies reloptions) and the introspection-side `type` btree→undefined normalization — those are real value normalization done at construction, not a pre-diff tree pass.

`unique:` and `index:` are **different id namespaces**, so a unique constraint and an index on the same columns are distinct nodes that never collide. There is therefore **no dedupe pass and no fail-loud derivation rule** — none is needed.

## Derivation (contract → schema IR)

- `StorageTable.uniques` (`@@unique`, field `@unique`) → `SqlUniqueIR`.
- `StorageTable.indexes` (`@@index`) → `SqlIndexIR{unique:false}`.
- FK-backing indexes → `SqlIndexIR{unique:false}` (unchanged).
- **FK referenced-namespace identity comes from the namespace node, not a string sentinel or a flag.** The contract IR answers "which namespace?" with a node — the unbound-namespace **singleton** for flat targets (`SqliteUnboundDatabase.instance`) — precisely so nothing downstream compares sentinel strings or branches on "does this database have namespaces". Derivation honors that: `convertForeignKey` resolves the FK target's namespace **node** and asks it; an **unbound** namespace stamps *no* referenced-namespace onto the FK node (absent), a bound one stamps its identity as today. Flat introspection also stamps nothing, so the two sides' FK ids meet **by construction**. There is **no `flattenReferencedNamespace` option, no caller-side flatten flag, and no `__unbound__` string ever entering schema-IR** — a flag or sentinel comparison here is papering over the model, and is forbidden. Unbound-ness is node behavior (a property/override answered by the unbound singleton class), not an id-string comparison at the consumer.
- **No fail-loud rule** for `@@unique` + `@@index` on the same columns — they are distinct nodes with distinct ids and coexist.

## Introspection (database → schema IR)

- `pg_constraint` contype='u' (SQLite `PRAGMA index_list` origin 'u') → `SqlUniqueIR`.
- `pg_index` not owned by a constraint (the existing `NOT EXISTS … table_constraints` exclusion; SQLite origin 'c') → `SqlIndexIR{unique: indisunique}`.
- **No dedupe pass.** A live unique constraint and a live *separate* same-column bare index both introspect as their own nodes (`unique:<cols>` and `index:<cols>` — distinct ids).

## Diff wiring (delete the massaging)

Both `diff-database-schema.ts` (Postgres + SQLite) run `diffSchemas(expected, actual)` on the trees **as derived** — no pre-diff transformation. Deleted:

- `resolveSemanticSatisfaction` / `normalizeFlatActualForDiff` (the entire semantic-satisfaction reconciliation) and their call sites.
- `neutralizeFlatExpectedFkSchemas` as a *pre-diff* pass (its effect moves into derivation, above).
- The caller-less `isUniqueConstraintSatisfied` / `isIndexSatisfied` satisfaction predicates.

## Planner (issue → ops) — as on `main`, no satisfaction

- `SqlUniqueIR`: `not-found` → `AddUniqueCall` (`ADD CONSTRAINT … UNIQUE`, default `<table>_<cols>_key`); `not-expected` → `DropConstraintCall` (`DROP CONSTRAINT`). No `not-equal` arm (id-identity equality).
- `SqlIndexIR`: `not-found` → `CreateIndexCall` (default `<table>_<cols>_idx`, type/options threaded); `not-expected` → `DropIndexCall`; `not-equal` → `indexIncompatible` (recreate).

A unique-vs-index mismatch is naturally a `missing` (one node kind) plus an `extra` (the other), which the planner maps independently — drop the extra, create the missing — with the existing control-policy disposition suppressing the drop under an additive policy. No cross-node logic exists in the planner.

## Behaviour

Deleting the reconciliation flips exactly the satisfaction cases to drift (the intended change; the general strict/lenient extra-tolerance and cross-space ownership are untouched):

- contract `@@unique` vs live unique **index** → constraint `missing` + index `extra` → **fails**.
- contract `@@index` vs live unique **constraint** → index `missing` + constraint `extra` → **fails**.
- stray live unique index (undeclared) → `extra` → **strict-fails / lenient-passes** (ordinary extra grading, same as a stray non-unique index).
- contract `@@unique` vs live unique **constraint** (the normal round-trip) → `SqlUniqueIR` pairs `SqlUniqueIR` → **equal / clean**.

## Explicitly NOT in this slice

- No merging unique and index into one node.
- No `constraint` marker on `SqlIndexIR`.
- No introspection dedupe (beyond the pre-existing, correct constraint-backing-index exclusion).
- No fail-loud derivation rule.
- No `isSuperfluousConstraintOnlyNotEqual` / `isBareUniqueIndexExtra` / `divergesOnlyBySuperfluousConstraint` / classifier special-cases. The classifier grades unique and index issues by granularity exactly as it does every other node kind.

## The whole slice, concretely

1. Delete `resolveSemanticSatisfaction`, `normalizeFlatActualForDiff`, the `SemanticSatisfaction*` types, and their call sites in both `diff-database-schema.ts`.
2. Delete the caller-less `isUniqueConstraintSatisfied` / `isIndexSatisfied` (confirm no callers first).
3. Make `SqlIndexIR.isEqualTo` symmetric on `unique` (drop `(!this.unique || node.unique)`).
4. FK referenced-namespace resolved at derivation **from the namespace node** (unbound singleton ⇒ absent); the pre-diff FK pass, its file, and any flatten flag/option are gone.
5. Leave `SqlUniqueIR`, `SqlIndexIR` (otherwise), the node tree, and both planners as they are on `main`.
6. Rewrite the verdict/planner tests that pinned satisfaction to the structural behaviour above.

Net: a small deletion-dominated diff that removes the tree-massaging and lets the generic differ do exactly what it already does.
