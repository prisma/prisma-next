# Design: schema diffing and verification

Authoritative design for the PR #894 rework. States the positive properties the code must satisfy; grounded in `file:line` where a claim rests on current code.

## 1. The model — four actors, cleanly separated

Schema comparison is a **differ** that produces issues; verify and plan are **orchestrations** that consume them.

1. **The differ** — an SPI on the target: `SchemaDiffer.diff(contract, actual) → SchemaDiff`. It compares two derived schema-IR trees and returns issues. How it computes them is private. It is **dumb**: one contract and the actual schema in, issues out; it knows nothing about contract spaces.
2. **`SchemaDiff`** — the result: two issue lists plus `filter` (§4). `SchemaDiffIssue` carries its **schema-IR node**, typed via a node type parameter. `SchemaDiff` carries no verdict, no verification tree, no counts.
3. **The contract-space aggregate** — **passive data**: the contract spaces and their contracts. It *answers* ownership interrogatives ("which contract nodes belong to which space", "is this entity declared by any space"). It diffs nothing, verifies nothing, classifies nothing.
4. **The orchestration** — the calling location that drives verify/plan (`verifyMigration`, `synthStrategy`). **It owns every verb**: it runs the differ per contract space, composes the per-space view, classifies extras (consulting the aggregate), and hands a space's issues to the planner. Verify's verdict is simply *does this space have any issue?* — `diff → its issues → empty ⇒ pass`.

Two issue lists stay distinct types — `SchemaIssue` (relational) and `SchemaDiffIssue` (the generic node differ's) — because two diffing mechanisms exist today; merging them is a follow-on (§13).

## 2. The diff's inputs: two derived representations

- **Expected** — derived from the contract by the target's projection. All contract-dependent resolution (value-sets, storage types, control policy) happens at derivation, so the diff itself reads no contract.
- **Actual** — introspected from the live database (`family.introspect`).
- Both are the same node-tree type: database → namespace → table [→ policy].

The contract is uniformly namespaced for every target (`contract.storage.namespaces[nsId].entries.table`). No family-wide namespace-node hierarchy is introduced — SQLite/Mongo are not wrapped in a namespace node. Multiple namespaces occur only in Postgres, internal to the Postgres diff (§1).

## 3. The differ is an SPI on the target

`SchemaDiffer` names the SPI the target already implements — `diffDatabaseSchema` on the SQL target descriptor. No new class implements it; the family/target that owns the diff is the implementer. Two properties:

- **It returns `SchemaDiff`, not `VerifyDatabaseSchemaResult`.** A diff is not verify-specific. The verify envelope and the pass/fail view are the orchestration's (§6), never returned by the differ.
- **It lives on the target descriptor, required for every SQL target** (Postgres: relational + policy; SQLite: relational only) — schema logic on the target, not database I/O on the control adapter. Its internals are private.

## 4. `SchemaDiff` — the result

```ts
type DiffIssue<TNode extends DiffableNode = DiffableNode> = SchemaIssue | SchemaDiffIssue<TNode>

class SchemaDiff<TNode extends DiffableNode = DiffableNode> {
  readonly issues: readonly SchemaIssue[]
  readonly schemaDiffIssues: readonly SchemaDiffIssue<TNode>[]
  filter(keep: (issue: DiffIssue<TNode>) => boolean): SchemaDiff<TNode>
}
```

- Its only job is to **abstract away that there are two issue lists.** `filter` fans one predicate across both and returns a narrowed `SchemaDiff`. The predicate takes the union; callers already understand both types.
- **Every issue carries `reason: ExpectationFailureReason`** — `'not-expected' | 'not-found' | 'not-equal'` — the three ways an actual state can fail an expectation: it contains a node not expected, lacks a node expected, or holds an unequal node. Expected = the desired side, actual = the current side of whatever comparison produced the issue (contract-vs-database, or contract-vs-contract in an offline plan), so the vocabulary is comparison-relative and never ambiguous about a base. The failure reason is a **structural characteristic carried as a declared field, never a string convention**: consumers filter on `issue.reason`, not by enumerating kind strings (`extra_*`/`missing_*`) or family-invented node codes. `SchemaDiffIssue` carries `reason` alongside its legacy `outcome` (both stamped at the one producer site; `outcome` retires with the slice-2.5 issue-type merge); `BaseSchemaIssue` gains `reason`, stamped by the family verifiers; grafted verify-tree nodes carry `reason` too, so the aggregate strip is one structural check on the root's children.
- **`SchemaDiffIssue<TNode>` carries its `expected` / `actual` schema-IR node**, so a caller reaches the node it concerns by a property access, not a lookup. `TNode` is **defaulted to `DiffableNode`** — a purely additive change: every existing caller keeps the default and is unbroken; only a caller that wants the concrete node opts in. The Postgres side uses `SqlSchemaDiffNode = SqlSchemaIRNode & DiffableNode` (the honest constraint — `SqlSchemaIRNode` alone is *not* a `DiffableNode`, since its relational subclasses lack `id`/`isEqualTo`/`children`; only the five `Postgres*SchemaNode` classes implement it): the differ returns `SchemaDiff<SqlSchemaDiffNode>` and the planner consumes it, dropping the per-issue `asSchemaNode` cast. The coupling is to the **schema IR** — the layer the differ diffs — never back to the contract IR it was derived from (§6). `SchemaIssue` (relational) stays coordinate-based; node-typing it is the relational-port follow-on (§13).

## 5. The diffing logic lives with the diff, not in "verify"

The relational diffing code must not sit in a `schema-verify/` module. Its logic is **not rewritten** — it lives with the diff as the diff's private internal. The "verify" module holds only the orchestration's concern (§6).

## 6. Verify and plan: the orchestration owns the verbs

The **contract-space aggregate is passive** — it holds the spaces and their contracts and answers ownership questions; it runs nothing. The **orchestration** (`verifyMigration`, `synthStrategy`) owns every verb.

**Verify produces two distinct outputs.** A diff of expected-vs-actual reports *against the contract*, but an **unclaimed** live element has no place in a contract's structure — so it is not forced into one. The verifier presents:

1. **Per contract space — is the contract satisfied?** The orchestration runs the differ (`diff(space.contract, actual)`) and composes the space's view: its declared nodes, each *pass* or *fail* by whether a **missing/mismatch** issue concerns it. Verdict = the space has no missing/mismatch issue. Extras are **not** represented here.
2. **Across the database — which live elements are unclaimed?** A separate, standalone list: introspected elements no contract space declares. The orchestration takes the diff's **extra** findings, deduplicates them, and asks the passive aggregate "does any contract declare this?" — the ones no contract claims are the unclaimed list, reported **once**. Its disposition is a rendering policy over the one list (strict fails on it; lenient shows it informationally).

The CLI renders both. This dissolves the "represent an unclaimed element against a contract" problem — it is a second list, never a contract-tree node — and fixes today's bug (an unclaimed element duplicated once per space, N times, across `issues` / `counts` / tree). Because the differ runs **per space**, a space's missing/mismatch issues are inherently its own; the `SchemaDiff` result is never consulted for ownership and never references the contract IR — the aggregate answers ownership for the unclaimed list.

**Plan.** The orchestration owns the space-scoping; the planner interprets nothing about spaces. The differ is reachable only on the family target descriptor (not from framework orchestration), the diff recipe is planner-internal (`strict` derives from the planner's policy), and `plan()` consumes the schema for its own existence probes — so the diff itself stays inside `plan()`, and the orchestration injects the scoping as a **blind predicate**: `plan({ …, keepDiffIssue })`, which the planner applies verbatim via `SchemaDiff.filter` before building ops. The predicate — built by the orchestration over the passive aggregate's `declaringSpaces` — drops `extra` findings for elements a sibling space declares and keeps everything else (undeclared extras stay eligible for destructive-policy DROPs; missing/mismatch untouched). The planner requires nothing about spaces. The typed node on each `SchemaDiffIssue` is what the planner builds the op from (§4).

**The two-part split lives in the aggregate layer, not the family differ.** `verifySqlSchema` (the single-space family check) is **shared** with the migration planner (reads its `issues`) and the runner's post-apply verify (reads its `ok` = `counts.fail`, a tree walk) — so it stays **unchanged**; it keeps grafting `extra_*` as fail nodes, and the single-space verdict planner/runner depend on is preserved byte-identical. The two-part output is inherently an aggregate concern — "unclaimed by *any* space" only has meaning across spaces — so the aggregate driver (`verifyMigration`, **replacing** `scope-schema-result`) does the split: from each per-space result it strips the `extra_*` nodes/issues to leave **Part 1** (the space's declared nodes), and gathers the stripped extras, deduplicated and filtered by the passive aggregate's ownership query, into **Part 2** (the unclaimed list). No per-space tree post-scoping, no per-family counts recompute.

## 7. The schema view is unaware of the schema IR

The human-readable *live-schema* view (the `inspect live schema` rendering) walks its **own** tree of printable `SchemaTreeNode`s and is unaware of the schema IR. It is a separate rendering of the actual schema, distinct from the verify pass/fail view (§6).

## 8. Node type guards (`.is` / `.assert`)

Guards downcast **from the base node to a specific node**:

- signature is `static is(node: SqlSchemaIRNode): node is XSchemaNode` (and `assert` correspondingly) — never `unknown`, never `DiffableNode`;
- they discriminate on the node's own **`nodeKind`** identifier (§9), never `instanceof`;
- applied consistently across all five node classes, and on `StorageTable` and the RLS-policy guard.

There is **no** `ensure()` that constructs a new node — a guard asserts, it does not build.

## 9. Node kinds and target ids are defined identifiers

- **`nodeKind`** — *which node* (database / namespace / table / policy / role). Every one of the five nodes carries a unique `nodeKind`; each §8 guard is `node.nodeKind === '<that kind>'`.
- **`nodeTarget`** — *which target*. The SQL family enumerates no target ids; no `'postgres'` literal lives in a SQL-family type.

## 10. `isEqualTo` — identity only

`isEqualTo` compares identity only: nodes are equal iff their `id`s match. Columns are not compared by `isEqualTo` (they become child nodes the generic differ walks). This replaces the `isEqualTo => true` stopgap.

## 11. Contract-space ownership is a passive interrogative; nothing prunes or post-scopes

The framework alters no schema and post-scopes no result. The **contract-space aggregate** answers, from the contracts it holds, "is this entity declared by any space, and by which one." The **orchestration** uses that answer to classify the extras from each per-space diff. That is the whole of contract-space handling — positive ownership ("my contract declares this node"), so two spaces in the same namespace are unambiguous, and a genuine double-claim surfaces as a real conflict rather than a silent mis-attribution.

Deleted outright:

- **`scope-schema-result.ts`** — the per-space tree pruning + counts/verdict recompute. The aggregate two-part split (§6) replaces it: strip each per-space result's extras to Part 1, gather them into the Part 2 unclaimed list — no post-scoping. All three bugs it produced (a column false-pass, an enum-node false-pass, a Mongo counts-flip) disappear with the file.
- **`entitiesOwnedByOtherSpaces`** (the planner `plan()` input) and **`otherMemberEntityNames`** (the set-subtraction) — the planner receives its space's issues; it needs no "other spaces" input.
- The earlier pruning layer (`projectSchemaToSpace`, both family `schema-shape.ts`, the `projectSchemaToMember` / `listSchemaEntityNames` callbacks) stays removed.

There is no bare-name keying, no name-subtraction, and no qualified-coordinate follow-on — positive ownership retires all three. The term is **contract space**, never "member"; there is no "schema result".

**The framework never matches family-invented strings.** Verify-node `kind`s (`'table'`, `'collection'`) and node `code`s (`'EXTRA_COLLECTION'`) are family vocabulary; the framework reads only framework-declared structure — the `reason` field (§4) on issues and grafted nodes. The aggregate strip and the unclaimed-elements collection are structural filters plus dedup plus the passive ownership check; no kind/code allowlists, no family node-shape reads. Code comments describe what the code does — no design-document section labels ("Part 2").

## 12. What changes (this pass)

| Now | Target |
| --- | --- |
| `scope-schema-result.ts` prunes each space's verification tree + recomputes counts/verdict | deleted; the per-space view is composed from the space's declared nodes + attached issues, scoped by construction (§6) |
| verify verdict = `counts.fail === 0` off the (post-scoped) tree | verdict = the space's issue list is empty |
| planner takes the full schema + `entitiesOwnedByOtherSpaces`; filters extras itself | planner takes its space's issues and maps issue → op; `entitiesOwnedByOtherSpaces` / `otherMemberEntityNames` deleted |
| `SchemaDiffIssue.expected/actual: DiffableNode`; planner `asSchemaNode` casts | `SchemaDiffIssue<TNode>` carries the typed node (default `DiffableNode`); planner takes `SchemaDiff<SqlSchemaDiffNode>` (= `SqlSchemaIRNode & DiffableNode`), per-issue casts gone (one boundary narrowing at the differ) |
| the contract-space aggregate driver diffs / scopes / classifies | the aggregate is passive (answers ownership); the orchestration owns those verbs |
| "member" throughout the aggregate | "contract space" |

Behaviour to preserve: `db verify` output (the per-space pass/fail view and undeclared-table reporting), planner ops, `contract infer`, single-space verify — all unchanged. The compose step must reproduce the view the post-scoped tree produced; validate byte-identity (fixtures + the multi-space guards).

## 13. Out of scope (follow-ons)

- **Relational port / one issue type:** merge the relational check into the generic node differ so there is a single, node-typed issue type (which also node-types `SchemaIssue`). Until then `SchemaDiff` carries two lists.
- **Multi-namespace verify-tree shaping:** the family verify retains only the first namespace's tree while its counts sum every namespace (`mergeVerifyResults`), so a stripped extra in a non-first namespace can leave a conservative false-*fail* in SQL-strict. Rooted in that pre-existing partial-root limitation; rides with the tree-shaping follow-on.
- **PSL-inference tree-walk (TML-2958):** inference still flattens the schema-IR tree into a flat document, fail-loud guarded.
- **`annotations.pg` full retirement (TML-2936).**

## 14. Mechanical fixes (landed in the earlier passes; kept here for the record)

Assertion helper over the bespoke `throw`; `(storage.types ?? {}) as ResolvedStorageTypes` casts removed; verbose doc comments trimmed; the two Postgres diff files consolidated into one and the diff-SPI types extracted to `schema-differ.ts`; dead `bootstrapSignMarkerQueries` (family) removed (`verify-postgres-namespaces` and `contract-to-postgres-database-schema-node` are **live/distinct** and stay); planner transient IDs / unreadable comments fixed; non-node file moved out of `schema-ir/`; `annotations.pg` not populated; the PSL-inference stopgap comment cites TML-2958.

## 15. Rejected alternatives (timeless)

- **Coupling the diff result back to the contract IR** (a contract-node handle on the issue). Rejected: the differ works in schema IR; the result couples to the schema IR node, never back to the authoring layer it was derived from. Contract knowledge lives in the aggregate, consulted for ownership — not on the result.
- **Post-scoping the verification tree per space (`scope-schema-result`).** Rejected: compose the per-space view from the space's own declared nodes so it is scoped by construction; there is nothing to prune.
- **Passing "other spaces' names" to the planner; the planner working out which issues are its own.** Rejected: the orchestration owns every ownership semantic and injects a blind keep-predicate; the planner applies it verbatim and interprets nothing.
- **The orchestration running the diff itself and handing the planner pre-scoped issues.** Rejected: the differ lives on the family target descriptor (invisible to framework orchestration without new SPI); the diff recipe is planner-internal; `plan()` consumes the schema for existence probes regardless; and offline `migration plan` callers have no orchestration to pre-diff — the planner would keep a duplicated internal diff.
- **The contract-space aggregate performing verbs (diff / verify / classify).** Rejected: the aggregate is passive data that answers ownership; the orchestration owns the verbs.
- **Utility methods on the `SchemaDiffer` interface; normalizing the two issue lists to a common `DiffEntry`.** Rejected: utilities live on `SchemaDiff`; `filter` takes the union.
- **String conventions for structural characteristics** (filtering by `extra_*` kind enumeration, `'extra_table'`/`'EXTRA_COLLECTION'` node codes, `'table'`/`'collection'` kind allowlists). Rejected: the failure reason is a declared enum field (`reason`, §4); a filter needs no utility function once the characteristic is a field.
- **Change-verb reason names (`added`/`removed`/`changed`) or side names (`expectedOnly`/`actualOnly`).** Rejected: change verbs anchor to a base that flips between contract-vs-database and contract-vs-contract comparisons; the landed names state the expectation failure itself (`not-expected`/`not-found`/`not-equal`).
- **Renaming `SchemaDiffIssue.outcome` now.** Rejected: `reason` is added alongside; `outcome`'s consumers are target/family internals that the slice-2.5 issue-type merge retires — renaming would churn them twice.
- **Family-owned strip/collect operations on the family instances.** Superseded: with `reason` a declared field, the framework filters structurally and needs no family callbacks for the strip.
- **`root` / `counts` on `SchemaDiff`; the diff returning `VerifyDatabaseSchemaResult`; the diff on the control adapter.** Rejected: the diff returns `SchemaDiff` — schema logic on the target, not verify output and not database I/O.
- **Rewriting the relational check pure / adding `effectiveControlPolicy` fields / a family-wide namespace-node hierarchy.** Rejected: the relational logic is relocated not rewritten; multiple namespaces are internal to the Postgres diff.
