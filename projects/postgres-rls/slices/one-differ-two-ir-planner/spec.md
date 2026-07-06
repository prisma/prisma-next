# Slice 2.5: one-differ-two-ir-planner

One differ over two schema IRs; one node-typed issue type; the planner takes `plan(start, end)`. Structural slice between slice 2 (#894) and slice 3 (`@@rls`), so the RLS slices build on the final shape.

## Decision

The legacy relational verifier (`verifySqlSchema` and its walk) is **ported onto the generic node differ** and retired. There is one differ, one issue type, and one comparison model:

1. **Node model.** Every schema element the diff compares is a node: columns, primary keys, foreign keys, uniques, indexes, and check constraints become **child nodes** of the table node (as policies already are), and a column's **default becomes a child node of the column** — it is the one legacy attribute with extra/missing/drift lifecycle of its own (`extra_default` was the sole attribute-level strict-only extra), and node-hood maps that lifecycle onto the three reasons with no attribute inspection. `isEqualTo(other)` compares the node's **own attributes only — never children** (compare two DOM elements: you don't expect `isEqualTo` to walk the subtree; the differ recurses for that). Container nodes (database, namespace) have no attributes to compare; attribute-bearing nodes (column, PK, …) compare their values.
2. **Resolution at derivation; the differ is pure.** The expected tree carries fully resolved values (native types, defaults, value-sets) stamped at contract→IR derivation; the actual tree carries normalized introspected values stamped at introspection. The differ reads no contract, no type-metadata registry, no normalizers.
3. **One issue type.** The node-typed `SchemaDiffIssue<TNode>` (path, `reason: ExpectationFailureReason`, `expected`/`actual` nodes) is THE issue. The coordinate-based `SchemaIssue`/`BaseSchemaIssue` union, the legacy `outcome` field, the `SchemaDiff` two-list split, and the `tableName` residual read in unclaimed-elements are deleted. `SchemaDiff` carries one list.
4. **Consumers filter by reason.** Strict-mode extras gating and control-policy disposition are reason-based filters in verify/plan — never inside the differ.
5. **`plan(start, end)`.** The planner takes two schema IRs and returns ops: it diffs (via the one differ), maps issue → op, and knows nothing else. Contract→expected derivation moves to the callers (aggregate orchestration; the offline `migration plan` CLI op derives both sides). `keepDiffIssue` and every issue-vocabulary input on `plan()` are deleted; sibling-space scoping is principled because issues carry their nodes (with namespaces).
6. **`kind` / `nodeKind` become required** on `SqlSchemaIRNode` — the port introduces the relational node-kind vocabulary (PR #894 review deferral, A08).

## Verify output: tree view cut

The relational walk is what produced the `SchemaVerificationNode` tree and `counts` the CLI renders. **The tree view is cut from `db verify`** (operator decision): verify output becomes issue-based — per-space verdict + issues, plus the unclaimed list. A schema view returns after the cleanup under [TML-2974](https://linear.app/prisma-company/issue/TML-2974) (native per-space rendering). `SchemaVerificationNode`, `root`/`counts`, the target `verifyDatabaseSchema` tree-producer hook, and the grafted-node machinery are deleted with the walk.

## Behaviour contract

- **Unchanged (hard):** planner ops byte-identical (`fixtures:check` clean); verify **verdicts** identical in every mode (strict/lenient, single- and multi-space, SQL/SQLite/Mongo); `contract infer` unchanged; the runner's post-apply check verdict unchanged; the multi-space guards green.
- **Changed (deliberate, this spec):** `db verify`'s rendered output — the pass/warn/fail tree and `counts` are gone; output is verdict + issues + unclaimed.

## Non-goals

- No new diffable entity kinds beyond porting what the relational verifier checks today (roles stay held-not-diffed — slice 4; RLS enablement — slice 3).
- No CLI schema-view rework beyond the cut (TML-2974).
- Mongo's diff **algorithm** is untouched (it never shared the SQL walk or the generic differ). But Mongo constructs the shared result shapes (`SchemaVerificationNode`, `root`/`counts`, `BaseSchemaIssue`), so deleting those forces a Mongo **result-envelope** rewrite to issue-only output — in scope as its own unit.

## Recorded vocabulary/scope decisions (from grounding)

- **`type_metadata_missing` / `type_consistency_warning` die with the tree.** They are tree-node-only warnings with no issue counterpart, and the planning path always passes an empty registry (the check never fires there). Deliberate removal, not an omission.
- **`check_removed` reclassifies to `reason: 'not-expected'`.** The legacy kind stamped `not-equal` despite being semantically an extra — a pre-existing inconsistency the one-vocabulary port resolves. Verdict-neutral (strict-only failure either way).

## Acceptance criteria

- **AC-1** `verifySqlSchema` and the relational walk are deleted; the generic differ is the only comparison mechanism; grep-clean for `SchemaVerificationNode`, `verifySqlSchemaTree`, `BaseSchemaIssue`, `outcome`.
- **AC-2** Table child nodes exist for columns/PK/FKs/uniques/indexes/checks; each node's `isEqualTo` compares own attributes only; the differ detects the same drift set the relational verifier detected (missing/extra/changed column, type/nullability/default drift, constraint drift) — pinned by ported tests keyed on `reason` + node.
- **AC-3** `plan(start, end)`: the planner's input carries two schema IRs and policy — no contract-derivation inside, no `keepDiffIssue`, no issue types in the signature. Ops byte-identical (`fixtures:check`).
- **AC-4** Verify is issue-based end-to-end: verdict = filtered issues empty; `db verify` renders verdict + issues + unclaimed; no tree/counts in output or `--json`.
- **AC-5** `kind`/`nodeKind` required on `SqlSchemaIRNode`; no optional discriminants; guards unchanged in behaviour.
- **AC-6** Full gate green (build, forced typecheck, whole Lint job incl. `check:upgrade-coverage --mode pr --prev <merge-base>`, fixtures, all three suites, guards).

## Grounding for the plan step

The plan must ground: today's relational check inventory (what `verifySqlSchema` compares, per entity kind — the port's checklist); every consumer of `VerifyDatabaseSchemaResult.schema.root`/`counts` (to cut); every `SchemaIssue` consumer (to port); `plan()`'s call sites (aggregate synth + offline CLI); the Mongo verifier's coupling.
