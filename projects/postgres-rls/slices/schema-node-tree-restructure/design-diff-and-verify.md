# Design: schema diffing and verification

Authoritative design for the PR #894 rework. States the positive properties the code must satisfy; grounded in `file:line` where a claim rests on current code.

## 1. The model

Schema comparison is one operation — a **differ** — and verify and plan consume it identically.

1. **The differ is an SPI:** `SchemaDiffer.diff(contract, actual) → SchemaDiff`. Expected derives from the contract; actual is the introspected live schema. How the result is computed — a relational check plus a generic node differ, how namespaces are paired — is **private**. No consumer, and no other part of this design, describes it.
2. **`SchemaDiff` is a result over two issue lists plus one method** (§4). It carries no verdict, no verification tree, no counts.
3. **Verify and plan are the same shape:** `diff → filter the issues to a contract space → iterate`. Verify emits one diagnostic per surviving issue (none ⇒ success); plan emits one operation per surviving issue. Neither knows how the diff is computed.
4. **Two issue lists stay distinct types** — `SchemaIssue` (relational) and `SchemaDiffIssue` (the node differ) — because two diffing mechanisms exist today. Merging them is a follow-on (§13).

## 2. The diff's inputs: two derived representations

- **Expected** — derived from the contract by the target's projection. All contract-dependent resolution (value-sets, storage types, control policy) happens at derivation, so the diff itself reads no contract.
- **Actual** — introspected from the live database (`family.introspect`).
- Both are the same node-tree type: database → namespace → table [→ policy].

The contract is uniformly namespaced for every target (`contract.storage.namespaces[nsId].entries.table`). No family-wide namespace-node hierarchy is introduced — SQLite/Mongo are not wrapped in a namespace node. Multiple namespaces occur only in Postgres, internal to the Postgres diff (§1).

## 3. The differ is an SPI on the target

`SchemaDiffer` names the SPI the target already implements — `diffDatabaseSchema` on the SQL target descriptor ([types.ts:499](../../../../packages/2-sql/9-family/src/core/migrations/types.ts)). No new class implements it; the family/target that owns the diff today is the implementer. Two properties:

- **It returns `SchemaDiff`, not `VerifyDatabaseSchemaResult`.** A diff is not verify-specific. The verify envelope (`ok` / `summary` / `code` / `target` / `timings`) and the pass/warn/fail tree are the verifier's, built by the verifier (§6) — never returned by the differ.
- **It lives on the target descriptor, required for every SQL target** (Postgres: relational + policy; SQLite: relational only) — schema logic on the target, not database I/O on the control adapter. Its internals are private.

## 4. `SchemaDiff` — the result

```ts
type DiffIssue = SchemaIssue | SchemaDiffIssue

class SchemaDiff {
  readonly issues: readonly SchemaIssue[]
  readonly schemaDiffIssues: readonly SchemaDiffIssue[]
  filter(keep: (issue: DiffIssue) => boolean): SchemaDiff
}
```

- Its only job is to **abstract away that there are two issue lists.** `filter` fans one predicate across both and returns a narrowed `SchemaDiff` — still a passable unit.
- The predicate takes the **union**, not a normalized descriptor: any caller doing real work with the result already understands both issue types. There is no `DiffEntry` / coordinate abstraction layer.
- **Contract-space filtering and control-policy suppression are just callers passing predicates** — no policy-specific method, nothing special. `SchemaIssue` (`kind: 'extra_table'`, `table`, `namespaceId`) and `SchemaDiffIssue` (`outcome: 'extra'`, `actual` node) each express "extra" and their coordinate in their own way; the predicate discriminates.

`SchemaIssue` ([control-result-types.ts:41](../../../../packages/1-framework/1-core/framework-components/src/control/control-result-types.ts)) and `SchemaDiffIssue` ([schema-diff.ts](../../../../packages/1-framework/1-core/framework-components/src/control/schema-diff.ts)) are the framework issue types Mongo also produces, so `filter` and the contract-space attribution (§11) are family-agnostic.

## 5. The diffing logic lives with the diff, not in "verify"

The relational diffing code must not sit in a `schema-verify/` module. Its logic is **not rewritten** — it **moves** to live with the diff, where it becomes the diff's private internal. The "verify" module then holds only the verifier's own concern (§6).

## 6. Verify and plan consume the diff the same way

The verifier:

1. `diff(contract, actual)` — derive expected, introspect actual, call the differ.
2. **filter the issues to the contract space** being verified (drop issues owned by other spaces).
3. iterate the surviving issues; **none ⇒ success**, else one verify diagnostic per issue.

The planner is identical, emitting one migration operation per surviving issue. Verify and plan are symmetric — `diff → filter to space → iterate` — and both are blind to how the diff is computed.

- **Tables no contract declares** are not a separate detection step: after attributing issues to spaces, they are the issues owned by **no** space. This deletes the live-entity enumeration entirely.
- **The pass/warn/fail tree (`root` / `counts`)** the CLI prints ([formatters/verify.ts](../../../../packages/1-framework/3-tooling/cli/src/utils/formatters/verify.ts), [combine-schema-results.ts](../../../../packages/1-framework/3-tooling/cli/src/utils/combine-schema-results.ts)) is the verifier's own presentation, produced by the relational walk — separate from the verdict (which is "iterate the issues") and never on `SchemaDiff`.

## 7. The schema view is unaware of the schema IR

The human-readable schema view walks its **own** tree of printable `SchemaTreeNode`s and is unaware of the schema IR. It uses no diff helper and does not flatten the schema-IR tree. How printable nodes are produced from the schema IR is the view's own concern, separate from the differ.

## 8. Node type guards (`.is` / `.assert`)

Guards downcast **from the base node to a specific node**:

- signature is `static is(node: SqlSchemaIRNode): node is XSchemaNode` (and `assert` correspondingly) — never `unknown`, never `DiffableNode`;
- they discriminate on the node's own **`nodeKind`** identifier (§9), never `instanceof`;
- applied consistently across all five node classes, and on `StorageTable` and the RLS-policy guard.

There is **no** `ensure()` that constructs a new node — a guard asserts, it does not build. Call sites `assert` and use the value in place.

## 9. Node kinds and target ids are defined identifiers

- **`nodeKind`** — *which node* (database / namespace / table / policy / role). Every one of the five nodes carries a unique `nodeKind` identifier; each §8 guard is `node.nodeKind === '<that kind>'`.
- **`nodeTarget`** — *which target*. The SQL family enumerates no target ids; no `'postgres'` literal lives in a SQL-family type.

Both are defined identifiers, not string literals scattered across guards.

## 10. `isEqualTo` — identity only

`isEqualTo` compares identity only: nodes are equal iff their `id`s match. Columns are not compared by `isEqualTo` (they become child nodes the generic differ walks). This replaces the `isEqualTo => true` stopgap.

## 11. Contract-space handling: filter the issues, never prune the schema

The framework **does not alter the schema before diffing and does not branch on any storage shape.** It diffs the full introspected schema and filters the resulting issues by contract-space ownership. Ownership is attributed with the target-agnostic `elementCoordinates(contract.storage)` — an issue belongs to whichever member claims its `(namespaceId, name)` coordinate.

Deleted:

- `projectSchemaToSpace` ([project-schema-to-space.ts](../../../../packages/1-framework/3-tooling/migration/src/aggregate/project-schema-to-space.ts)) and both family `schema-shape.ts` modules ([SQL](../../../../packages/2-sql/9-family/src/core/diff/schema-shape.ts), [Mongo](../../../../packages/2-mongo-family/9-family/src/core/schema-shape.ts)) — the schema-pruning callbacks;
- the `projectSchemaToMember` / `listSchemaEntityNames` callbacks on the family instances and their CLI wiring;
- the `TSchemaResult` generic on the aggregate verifier ([verifier.ts](../../../../packages/1-framework/3-tooling/migration/src/aggregate/verifier.ts)) — the family returns the framework issue types, which the framework reads directly.

The aggregate verifier and planner take the family's `SchemaDiffer`, diff the full schema per member, filter each member's issues to its space, and iterate. Issues owned by no member are the undeclared tables.

## 12. What changes (from the state after the first rework round)

| Now | Target |
| --- | --- |
| `diffDatabaseSchema` returns `VerifyDatabaseSchemaResult` ([types.ts:499]) | returns `SchemaDiff` (two lists + `filter`); the SPI is named `SchemaDiffer` |
| verify verdict reads `counts.fail` off the verification tree | verdict iterates the filtered issues; none ⇒ success |
| aggregate verifier prunes the schema per member (`projectSchemaToSpace` + family `schema-shape` callbacks) | diffs the full schema, filters the issues by contract space; callbacks + `schema-shape` + `project-schema-to-space` deleted |
| undeclared tables via `listSchemaEntityNames` enumeration | issues owned by no space |
| `TSchemaResult` generic on the verifier | gone; framework reads the framework issue types |
| guards use `instanceof` / `unknown` / `DiffableNode`; `ensure()` constructs nodes | `(node: SqlSchemaIRNode): node is X`, `nodeKind`-discriminated; no node-constructing `ensure` |

## 13. Out of scope (follow-ons)

- **Relational port / one issue type:** merging the relational check into the generic node differ so there is a single issue type. Until then `SchemaDiff` carries two lists. Separating `root` / `counts` from the relational walk rides with this port.
- **PSL-inference tree-walk (TML-2958):** inference still gathers the tree into a flat document, guarded by a fail-loud throw.
- **`annotations.pg` full retirement (TML-2936):** this rework stops *populating* the bag (§14); typed-field replacement is TML-2936.

## 14. Mechanical fixes (from the PR review, no design fork)

- Replace the bespoke `throw new Error("expected StorageTable…")` with an assertion helper.
- Remove the `(storage.types ?? {}) as ResolvedStorageTypes` casts (×3) via a real type — no cast, no fallback.
- Trim the verbose doc comments (attached, not orphaned) and sweep the whole diff for the same; add none new.
- Delete the dead operations the review flags (`verify-postgres-namespaces` and the two unused `control-instance` methods).
- Extract review additions **out** of the catch-all `migrations/types.ts` into named, logical files.
- Correct the planner's transient-id string, its unreadable comment, and the "all namespace nodes are relational" note; stop *creating* contract nodes to refer to them — find them in the live contract.
- Move the non-node file out of `schema-ir/` (so only the five node classes remain); stop populating the obsolete `annotations.pg` bag.
- Reword the PSL-inference stopgap comment to state it converts the schema-IR **tree** into the flat structure the PSL writer expects (TML-2958), assigned to Will.
- Re-run the full slice-DoD gate set.

## 15. Rejected alternatives (timeless)

- **Utility methods on the `SchemaDiffer` interface (filter / extras / verdict on the SPI).** Rejected: those are pure functions of the result; they live on `SchemaDiff`, keeping the SPI a one-method factory.
- **Normalizing the two issue lists to a common `DiffEntry` for filtering.** Rejected: expose the union — callers already understand both types.
- **`root` / `counts` (the verification tree) on `SchemaDiff`.** Rejected: that is verifier presentation, not diff output.
- **Pruning the schema IR to a member's slice before diffing (family prune + enumerate callbacks).** Rejected: don't alter the schema; diff the full schema and filter the resulting issues by contract space. The framework never branches on storage shape.
- **The diff returning `VerifyDatabaseSchemaResult`, or exposing the diff through the control adapter.** Rejected: the diff returns `SchemaDiff`; it is schema logic on the target, not verify output and not database I/O.
- **Rewriting the relational check to be a pure contract-free diff, adding `effectiveControlPolicy` / fully-expanded native types as new fields on the expected node, and moving disposition to a post-diff filter.** Rejected: the relational logic is relocated, not rewritten.
- **A uniform family-wide namespace-node hierarchy (wrapping SQLite/Mongo in a namespace node).** Rejected: unnecessary; multiple namespaces occur only in Postgres, internal to its diff.
- **The verifier or the schema view knowing how the diff works.** Rejected: they consume the issue lists / walk their own printable-node tree.
