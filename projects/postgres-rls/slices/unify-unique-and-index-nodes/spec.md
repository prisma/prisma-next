# Slice 2.6: unify-unique-and-index-nodes

Delete the semantic-satisfaction **reconciliation pass** (`diff-tree-normalization.ts`) that transforms the schema-IR trees before the differ runs. Keep `SqlUniqueIR` and `SqlIndexIR` as the two distinct structural nodes they are — a unique constraint and an index are different SQL schema elements — and let the generic differ compare the trees structurally with no massaging. Between slice 2.5 (`one-differ-two-ir-planner`) and slice 3 (`explicit-rls-control`).

Full design: [`design.md`](./design.md). It is the authority for every detail; this spec states the decision and the acceptance bar.

## The problem (what 2.5 left behind, accepted under protest)

`diff-tree-normalization.ts`'s `resolveSemanticSatisfaction` **transforms the actual schema-IR tree before the differ walks it** — reclassifying a live unique index as a unique-constraint node, synthesizing index nodes, dropping live unique indexes so they never count as extras. Its only purpose is to implement "semantic satisfaction": a stronger live object (a unique index) silently counting as a declared weaker one (a unique constraint), and vice-versa.

That pre-diff transformation is the debt. The differ is supposed to compare two derived trees and nothing else; a pass that massages a tree to make the verdict come out "satisfied" is exactly the anti-pattern the one-differ architecture exists to remove. The two node kinds are **not** the problem — a unique constraint (`pg_constraint`) and an index (`pg_index`) are genuinely different schema elements, modeled as separate nodes just like primary keys, foreign keys, and check constraints already are.

## Decision

**One schema-IR node per schema element; the differ does pure structural comparison with no tree transformation.** (Design §"The one principle".)

1. **Delete the reconciliation pass.** Remove `resolveSemanticSatisfaction` / `normalizeFlatActualForDiff` and their call sites; both diff paths run `diffSchemas(expected, actual)` on the trees as derived. Delete the caller-less `isUniqueConstraintSatisfied` / `isIndexSatisfied`.
2. **Keep the two nodes.** `SqlUniqueIR` (unique constraint) and `SqlIndexIR` (index, with `unique: boolean`) stay as separate structural nodes. `SqlIndexIR.isEqualTo` becomes purely symmetric (drop the `(!this.unique || node.unique)` satisfaction rule). No `constraint` marker, no merging.
3. **No collision-avoidance machinery.** Because the two nodes have distinct id namespaces (`unique:` vs `index:`), there is no id collision — so **no introspection dedupe and no fail-loud derivation rule**. A live unique constraint and a separate same-column index coexist as their own nodes.
4. **Fold the FK schema-segment normalization into derivation** (target-agnostic option on `contractToSchemaIR`), so no pre-diff normalization pass survives at all.

## Behaviour contract

**This is a deliberate behaviour change, not byte-neutral.** Deleting satisfaction makes a unique-vs-index mismatch structural drift (Design §"Behaviour"):

- contract `@@unique` vs live unique **index** → fails (constraint missing + index extra).
- contract `@@index` vs live unique **constraint** → fails.
- stray live undeclared unique index → ordinary extra (strict-fails / lenient-passes).
- contract `@@unique` vs live unique **constraint** (the round-trip) → clean.

Scope is fenced to the unique/index satisfaction rules; the general strict/lenient extra-tolerance, control-policy disposition, and cross-space ownership are untouched. Proven by the verdict suite, the planner/adapter op→SQL suites, the `migration plan` e2e journeys, and the four multi-space guards — **not** `fixtures:check` (emission-only).

## Non-goals

- No merging of unique and index into one node, no `constraint` marker, no satisfaction/classification special-cases, no introspection dedupe, no fail-loud derivation rule. (Design §"Explicitly NOT in this slice".)
- No change to the general extra-tolerance / control-policy grading or cross-space ownership.

## Acceptance criteria

- **AC-1** `resolveSemanticSatisfaction` / `normalizeFlatActualForDiff` / the `SemanticSatisfaction*` types / the caller-less satisfaction predicates are deleted; `diff-tree-normalization.ts` is gone (grep-clean). Both diff paths run the differ on the trees as derived.
- **AC-2** `SqlUniqueIR` and `SqlIndexIR` remain two distinct nodes; `SqlIndexIR.isEqualTo` is symmetric; no `constraint` marker, no dedupe, no fail-loud rule anywhere (grep-clean for `isSuperfluousConstraintOnlyNotEqual`, `isBareUniqueIndexExtra`, any `constraint` marker on the index node).
- **AC-3** FK schema-segment normalization is folded into derivation; no pre-diff normalization pass survives (`neutralizeFlatExpectedFkSchemas` is not called before the differ).
- **AC-4** The structural behaviour above is pinned by rewritten verdict + planner op→SQL tests (`DROP CONSTRAINT`/`DROP INDEX`/`ADD CONSTRAINT UNIQUE`/`CREATE INDEX` per element, the four mismatch cases); the general extra-tolerance grading is provably unchanged (`schema-verify.ts` diff shows only the satisfaction deletions); full slice gate green.
