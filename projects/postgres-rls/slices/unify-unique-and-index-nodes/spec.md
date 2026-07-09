# Slice 2.6: unify-unique-and-index-nodes

A unique constraint **is** a unique index. Model it as one schema-IR node kind — `SqlIndexIR` with `unique: true` — so the differ pairs uniques and indexes natively and the semantic-satisfaction normalization (`diff-tree-normalization.ts`) is deleted. Structural cleanup between slice 2.5 (`one-differ-two-ir-planner`) and slice 3 (`explicit-rls-control`); no user-visible change.

## The problem (what 2.5 left behind, accepted under protest)

The relational schema IR has **two node kinds for the same thing**:

- `SqlIndexIR` — `{ columns, unique: boolean, name?, type?, options? }`, `nodeKind: 'sql-index'`.
- `SqlUniqueIR` — `{ columns, name? }`, `nodeKind: 'sql-unique'`.

`SqlUniqueIR` is a strict subset of `SqlIndexIR` (an index with `unique: true` and no `type`/`options`) given its own node kind. Because the differ pairs strictly by `nodeKind` + id, a unique modeled as `SqlUniqueIR` on one side of the diff can never pair with a unique index modeled as `SqlIndexIR` on the other — even though they are the same object. `diff-tree-normalization.ts`'s `resolveSemanticSatisfaction` exists **only** to reconcile those two representations after the fact (reclassify an actual unique index as a unique node; synthesize an index node for a unique constraint's backing index; never count live unique indexes as extras). The ambiguity is self-inflicted by the two-kind split.

This is the same failure mode the PR #921 review surfaced repeatedly — a bespoke construct standing in for what a single well-modeled primitive already expresses. `SqlIndexIR.unique` already exists; the second node kind and its reconciliation pass should not.

## Decision

1. **Delete `SqlUniqueIR`.** A unique constraint is a `SqlIndexIR` with `unique: true`.
2. **Both sides produce the one kind.** Contract→IR **derivation** emits `SqlIndexIR { unique: true }` for a contract unique constraint (today it emits `SqlUniqueIR`); **introspection** emits `SqlIndexIR { unique: true }` for a live unique index / unique constraint. So the expected schema-IR node and the actual schema-IR node are the same kind and pair natively. (The differ is unchanged — it still compares two schema-IR nodes by kind + own attributes; nothing about contract-vs-schema comparison changes, because that was never happening.)
3. **Delete `diff-tree-normalization.ts`'s unique/index reconciliation.** With both sides one kind, `isEqualTo` compares `columns` + `type` + `options` like any other index; the cross-kind rules evaporate. The FK schema-segment neutralization in that file is a resolve-at-derivation concern — fold it into derivation (or keep it only if genuinely needed) and remove the file.
4. **The constraint-vs-index distinction is a property, not a kind.** A named unique *constraint* drops via `DROP CONSTRAINT` (and cannot be partial/expression); a bare unique *index* drops via `DROP INDEX`. Capture that on the index node (a name / "is a named constraint" marker) and branch the op-builder on it — this is the only real difference between the two and it belongs on the op, not in a second node kind.

## Behaviour contract

- **Verdicts and planner ops byte-identical** in every mode (strict/lenient, single/multi-space, SQL/SQLite). This slice preserves the exact behaviour 2.5's `resolveSemanticSatisfaction` port produced — it just achieves it by modeling instead of reconciliation. Proven by the same means (the verdict-parity suite, the planner/adapter op→SQL suites, the `migration plan` e2e journeys, the four multi-space guards, a golden diff of real `plan()` output) — **not** `fixtures:check`, which is emission-only.
- The `sql-unique` node kind and `diff-tree-normalization.ts` are gone (grep-clean).

## Non-goals

- No new drift behaviour. This is a pure remodel of an existing capability; it must not change what drift is detected or how it grades.
- The FK schema-spelling normalization only moves to derivation if that is byte-neutral; otherwise it stays until a follow-on addresses it.

## Acceptance criteria

- **AC-1** `SqlUniqueIR` and the `sql-unique` node kind are deleted; unique enforcement is `SqlIndexIR { unique: true }` on both derivation and introspection (grep-clean for `SqlUniqueIR`).
- **AC-2** `diff-tree-normalization.ts`'s unique/index reconciliation is deleted; the file is removed (or reduced to nothing that special-cases unique-vs-index).
- **AC-3** The constraint-vs-index DDL distinction is preserved as a property on the index node + op-builder branch — `DROP CONSTRAINT` vs `DROP INDEX` unchanged, pinned by exact-SQL tests.
- **AC-4** Verdict + op parity re-proven (verdict-parity suite, op→SQL suites, guards, golden diff); full slice gate green.
