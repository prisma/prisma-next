# Design: schema diffing and verification

Authoritative design for the PR #894 rework. Every "current" claim is grounded in a `file:line`; every "target" claim is a positive property the rework must satisfy.

## 1. The model

Schema comparison is **one black-box diff on the target**. Positive properties:

1. **The diff takes two derived representations and returns two issue sets:** `diffDatabaseSchema(expected, actual) → { issues: SchemaIssue[]; schemaDiffIssues: SchemaDiffIssue[] }`. How it computes them — that it runs a relational check and a structural node differ, how it pairs namespaces, anything internal — is **private to the diff**. No consumer, and no other section of this design, describes it.
2. **The diff is a target-descriptor operation**, required for every SQL target (Postgres returns relational + policy issues; SQLite returns relational only). It is **not** on the control adapter — the adapter is database I/O, not schema logic.
3. **The verifier consumes only the output:** derive the expected representation, introspect the actual, call the diff, fail iff a surviving issue is a failure. It is blind to how the diff works.
4. The two issue sets stay distinct types — `SchemaIssue` (relational) and `SchemaDiffIssue` (the generic node differ). Merging them onto one type is a follow-on (§12).

## 2. The diff's inputs: two derived representations

- **Expected** — derived from the contract by the target's projection (`contractToPostgresDatabaseSchemaNode`, [contract-to-postgres-database-schema-node.ts:41](../../../packages/3-targets/3-targets/postgres/src/core/migrations/contract-to-postgres-database-schema-node.ts)). All contract-dependent resolution (value-sets, storage types, control) happens here, at derivation, so the diff reads no contract.
- **Actual** — introspected from the live database (`family.introspect`).
- Both are the same node-tree type: database → namespace → table [→ policy].

The contract is uniformly namespaced for every target — `contract.storage.namespaces[nsId].entries.table` (grounded: the verify walk iterates the namespaces at [verify-sql-schema.ts:335](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts) and `.entries.table` at [:346](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)). No family-wide namespace-node hierarchy is introduced: SQLite/Mongo are not wrapped in a namespace node. Multiple namespaces occur only in Postgres, and that is internal to the Postgres diff (§1.1).

## 3. The diff lives on the target

The diff already exists and already does the right thing at its core: `diffPostgresDatabaseSchema` ([diff-database-schema.ts:42](../../../packages/3-targets/3-targets/postgres/src/core/migrations/diff-database-schema.ts)) invokes both mechanisms and returns `{ issues, schemaDiffIssues }`. Two changes:

- **Move it to the target descriptor and make it required.** It is currently reached through the control adapter — `SqlControlAdapter.diffDatabaseSchema`, **optional** ([control-adapter.ts:212](../../../packages/2-sql/9-family/src/core/control-adapter.ts)). It moves to the target descriptor (beside `contractSerializer` / `inferPslContract`), required for every SQL target. SQLite provides it too (relational only). The `optional`-and-fallback shape is removed.
- **The internals are private.** Whether the diff runs a relational check plus a structural differ, and how it walks namespaces, is the diff's own business — not exposed, not documented as a design concern.

## 4. The diffing logic lives with the diff, not in "verify"

The relational diffing code currently sits in the `schema-verify/` module: `verifySqlSchema` ([verify-sql-schema.ts:143](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)), `verifySqlSchemaTree` ([:1447](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)), `namespaceSchemaNodes` ([:59](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)), `restrictToNamespaceIds` ([:130](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)), `scopeContractToNamespace` ([:1380](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)), `namespaceSchemaName` ([:1367](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)), `mergeVerifyResults` ([:1407](../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)).

**Its logic is not rewritten.** It **moves** out of `schema-verify/` to live with the diff. Diffing code has no place in a "verify" module; once relocated it is the diff's private internal, and the "verify" module contains only the verifier's own concern (§5).

## 5. The verifier consumes only the output

`verifySchema` ([control-instance.ts:694](../../../packages/2-sql/9-family/src/core/control-instance.ts)) derives the expected tree, introspects the actual, calls `target.diffDatabaseSchema(expected, actual)`, and fails iff a surviving issue is a failure. Removed:

- the SQLite **fallback branch** (`controlAdapter.diffDatabaseSchema ? … : verifySqlSchemaTree(…)`, [control-instance.ts:708](../../../packages/2-sql/9-family/src/core/control-instance.ts)) — with the diff required on the target, there is no fallback;
- the `namespaceSchemaNodes` + `verifySqlSchemaTree` **imports** ([control-instance.ts:57](../../../packages/2-sql/9-family/src/core/control-instance.ts)) — the verifier references no diffing internal.

## 6. The schema view is unaware of the schema IR

`toSchemaView` ([control-instance.ts:947](../../../packages/2-sql/9-family/src/core/control-instance.ts)) renders the human-readable schema view as a tree of printable `SchemaTreeNode`s. It currently reaches into the schema IR, flattening root→namespaces→tables via `namespaceSchemaNodes` ([:952](../../../packages/2-sql/9-family/src/core/control-instance.ts)) — coupling the view to a diff helper.

Target: the schema view walks its **own** tree of printable nodes and is unaware of the schema IR. It uses no `namespaceSchemaNodes` and no diff helper. (How printable nodes are produced from the schema IR is the view's own concern, separate from the differ; it does not belong to this diff/verify design.)

## 7. Node type guards (`.is` / `.assert` / `.ensure`)

Guards downcast **from the base node to a specific node**:

- signature is `static is(node: SqlSchemaIRNode): node is XSchemaNode` (and `assert`/`ensure` correspondingly take `SqlSchemaIRNode`) — never `unknown`, never `DiffableNode`;
- they discriminate on the node's own **`nodeKind`** identifier (§8), never `instanceof`.

Current state (all five wrong on both counts): `PostgresNamespaceSchemaNode.is(node: unknown)` uses `instanceof` ([postgres-namespace-schema-node.ts:78-79](../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-namespace-schema-node.ts)); `PostgresPolicySchemaNode.is(node: DiffableNode)` uses `instanceof` ([postgres-policy-schema-node.ts:79-80](../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-policy-schema-node.ts)); `PostgresRoleSchemaNode.is` ([:52-53](../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-role-schema-node.ts)); `PostgresTableSchemaNode.is(node: DiffableNode)` ([:102-103](../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-table-schema-node.ts)); `PostgresDatabaseSchemaNode.is(node: unknown)` uses `instanceof` with a field fallback ([:77-78](../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-database-schema-node.ts)).

Discriminating on the field also resolves the review's A2 asymmetry: the field is what survives the `projectSchemaToSpace` spread, so a uniform field check makes every guard survive it.

## 8. Node kinds and target ids are defined identifiers, not magic strings

Two distinct discriminants, which the code currently conflates:

- **`nodeKind`** — *which node* (database / namespace / table / policy / role). This is what the §7 guards compare, so **every one of the five nodes must carry a unique `nodeKind` identifier.** Today only `PostgresDatabaseSchemaNode` carries `nodeKind` ([postgres-database-schema-node.ts:36](../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-database-schema-node.ts) `= 'postgres-database'`); `PostgresNamespaceSchemaNode` carries only `nodeTarget`; and table / policy / role carry neither. The rework adds a unique `nodeKind` to all five; each guard is `node.nodeKind === '<that kind>'`.
- **`nodeTarget`** — *which target*. `type SqlSchemaTarget = 'sql' | 'postgres'` ([sql-schema-ir.ts:14](../../../packages/2-sql/1-core/schema-ir/src/ir/sql-schema-ir.ts)) hard-codes `'postgres'` in a SQL-*family* type (`nodeTarget` default `'sql'` at [:37](../../../packages/2-sql/1-core/schema-ir/src/ir/sql-schema-ir.ts)) — an inverted dependency.

Both are **defined identifiers**, not string literals scattered across guards, and the family enumerates no target ids.

## 9. `isEqualTo` — identity only

`isEqualTo` compares identity only: namespace nodes equal iff their `id`s match; table nodes equal iff their `id`s (names) match; columns are not compared by `isEqualTo` (columns become child nodes later, at which point the generic differ walks them). This is a real check, replacing the `isEqualTo => true` stopgap.

## 10. Framework layer purity

`1-framework/3-tooling/migration` code must not know any storage shape. Current violations: `projectSchemaToSpace` ([project-schema-to-space.ts:58](../../../packages/1-framework/3-tooling/migration/src/aggregate/project-schema-to-space.ts)) branches on `.namespaces`/`.tables`/`.collections` ([:68-104](../../../packages/1-framework/3-tooling/migration/src/aggregate/project-schema-to-space.ts)) and names `PostgresDatabaseSchemaNode` in comments; `collectLiveTableNames` ([verifier.ts:236](../../../packages/1-framework/3-tooling/migration/src/aggregate/verifier.ts)) / `detectOrphanElements` ([:203](../../../packages/1-framework/3-tooling/migration/src/aggregate/verifier.ts)) duck-type the same shapes.

Target: the family supplies these as callbacks, exactly as it already supplies `verifySchemaForMember` ([verifier.ts:32](../../../packages/1-framework/3-tooling/migration/src/aggregate/verifier.ts)). The framework calls target-agnostic callbacks — "project this schema to these owned names", "list this schema's entity names" — and touches no storage shape.

## 11. Current → target

| Component (current, grounded) | Target |
| --- | --- |
| `diffDatabaseSchema` on the control adapter, optional ([control-adapter.ts:212]) | on the **target descriptor**, required for every SQL target |
| verifier SQLite fallback branch ([control-instance.ts:708]) | deleted; the verifier only calls `target.diffDatabaseSchema` |
| verifier imports `namespaceSchemaNodes` + `verifySqlSchemaTree` ([control-instance.ts:57]) | removed |
| relational diffing lives in `schema-verify/verify-sql-schema.ts` (§4) | moved to live with the diff (logic untouched); out of the verify module |
| `toSchemaView` flattens the schema IR via `namespaceSchemaNodes` ([control-instance.ts:952]) | walks its own printable-node tree; unaware of the schema IR |
| SQLite `namespaceSchemaNodes(x)[0] ?? { tables: {} }` in [sqlite runner.ts:102] / [planner.ts:204] | SQLite goes through `diffDatabaseSchema`; the duplicated `?? {tables:{}}` fallback is gone |
| five `.is` guards using `instanceof` + `unknown`/`DiffableNode` (§7) | `(node: SqlSchemaIRNode): node is X`, `nodeKind`-discriminated |
| `isEqualTo => true` stopgap | identity comparison (§9) |
| `SqlSchemaTarget = 'sql' \| 'postgres'` ([sql-schema-ir.ts:14]); 3 of 5 nodes carry no `nodeKind` | defined `nodeKind` per node; family enumerates no target ids (§8) |
| framework `.tables/.collections/.namespaces` branching (§10) | family-supplied prune/enumerate callbacks |

## 12. Out of scope (follow-ons, not this rework)

- **Relational port / one issue type:** merging the relational check into the generic differ so there is a single issue type. The diff keeps two mechanisms and two issue types.
- **PSL-inference tree-walk (TML-2958):** `inferPostgresPslContract` ([infer-psl-contract.ts](../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-psl-contract.ts)) still gathers the tree into a flat `{ tables }` and emits one `__unspecified__` bucket. A known defect, guarded by a fail-loud throw; tracked in TML-2958.
- **`annotations.pg` full retirement (TML-2936):** this rework stops *populating* the bag (§13); typed-field replacement is TML-2936.

## 13. Mechanical fixes (from the PR review, no design fork)

- Replace the bespoke `throw new Error("expected StorageTable…")` with an assertion helper (`contractNamespaceToSchemaIR` [contract-to-schema-ir.ts:395](../../../packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts) and siblings).
- Remove `(storage.types ?? {}) as ResolvedStorageTypes` ([contract-to-schema-ir.ts:390](../../../packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts)) — real type, no cast/fallback (three occurrences: 390, 425, 471).
- Trim the verbose (attached, not orphaned) doc comments: `packages/2-sql/9-family/src/core/psl-contract-infer/printer-config.ts:9`, `packages/2-sql/9-family/src/core/migrations/types.ts:317`, `:494` — and sweep the whole diff for the same.
- Test readability: `project-schema-to-space.test.ts:185`, `array-column-introspection.integration.test.ts:47`; `ifDefined` at `rls-collect-extension-issues.test.ts:66`.
- Move `postgres-schema-ir-annotations.ts` out of `schema-ir/` (the sixth non-node resident, so "only the five nodes" is false); stop populating the obsolete `annotations.pg` bag.
- Re-run the full slice-DoD gate set.

## 14. Rejected alternatives (timeless)

- **Rewriting the relational check to be a pure contract-free diff, adding `effectiveControlPolicy` / fully-expanded native types as new fields on the expected node, and moving disposition to a post-diff filter.** Rejected: the diff is a black box whose internals are untouched. The relational logic is relocated, not rewritten.
- **Exposing the diff through the control adapter.** Rejected: the diff is schema logic on the target; the adapter is database I/O.
- **A uniform family-wide namespace-node hierarchy (wrapping SQLite/Mongo in a namespace node).** Rejected: unnecessary; multiple namespaces occur only in Postgres, internal to its diff.
- **The framework duck-typing storage shapes.** Rejected: a layer violation; the framework delegates shape-specific work to family callbacks.
- **The verifier or the schema view knowing how the diff works.** Rejected: the verifier consumes the issue sets; the schema view walks its own printable-node tree.
