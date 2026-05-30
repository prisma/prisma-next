# Slice: migration-element-coordinates (S1.D-3)

_In-project slice. Parent project `projects/contract-ir-planes/`. Outcome: the migration tooling walks IR entities via the polymorphic `elementCoordinates(storage)` free function instead of the name-only `extractStorageElementNames` helper — completing PDoD6's migration consumer. Closes [TML-2580](https://linear.app/prisma-company/issue/TML-2580)._

## At a glance

S1.A introduced `elementCoordinates(storage)` as the idiomatic, namespace-aware IR walk. The migration aggregate still walks via the older name-only `extractStorageElementNames`. Migrate those consumers to `elementCoordinates`, resolve the `StorageBase` vs `Storage` type gap that blocks them, and delete the old helper. **Output-preserving: no on-disk shape change.**

## Chosen design

The migration aggregate consumers swap `extractStorageElementNames` for `elementCoordinates(storage)`, reading the coordinate tuple they need rather than a bare name list. The type gap — `elementCoordinates` is typed against the full `Storage` while the migration consumers hold a `StorageBase` — is resolved so the consumers can call it without a cast (widen the function's accepted type or narrow the consumer's hold, whichever doesn't enlarge a public surface). Once no caller remains, `extractStorageElementNames` is deleted.

## Coherence rationale

One reviewable unit: migrate every reader of `extractStorageElementNames` to `elementCoordinates` and delete it — one helper's consumers, one sitting, one rollback unit.

## Scope

**In:** the migration aggregate consumers of `extractStorageElementNames`; the `StorageBase`/`Storage` type-gap resolution; deletion of the helper.

**Out:** planner / validator consumers of `elementCoordinates` (already migrated in S1.A); any contract-shape change; the other S1.D slices and the deferred items.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Type-gap resolution widens a public surface | Refusal trigger | If closing the `StorageBase`/`Storage` gap requires loosening an exported type beyond the migration package, **HALT and report** — that's a structural change, not a call-site migration. |

## Slice-specific done conditions

- [ ] Grep gate clean: `extractStorageElementNames` returns zero hits outside this project's docs, and migration behaviour is unchanged (existing migration tests green, no fixture movement).

## Open Questions

None. Working position: the migration consumers need the coordinate's name component, which `elementCoordinates` yields; the type gap closes by adjusting the migration-internal hold, not a public type.

## Round 2 — review actions (PR #629)

Reviewer questioned the defensiveness in `storage-element-names.ts`. Both stand; the seam stays but loses its over-defensive dressing.

- **R1 — Drop the per-entry null sweep.** The `Object.values(namespaces).every(ns => non-null object)` loop defends against impossible input: the parameter is a typed `Contract` (not `unknown`, as it was when that guard was first written), and `elementCoordinates` already skips null slots internally. A validated contract never carries a null namespace value. Remove the sweep; `hasNamespaceMap` narrows to `object` + has-a-`namespaces`-map only.
- **R2 — Reframe the guard as a layering type-bridge, not malformed-input defence.** The guard exists because `Contract.storage` resolves to `StorageBase` (foundation, hash-only) while `namespaces` lives on the framework `Storage` interface (core); foundation can't reference `Namespace`, so the migration layer narrows `StorageBase → Storage` at runtime in lieu of a banned bare `as`. Rewrite the function doc-comment and the inline comment to say that — drop the "malformed or partially-constructed" framing.
- **Refusal trigger** — if leaning the guard out forces a bare `as` cast or a `blindCast` to satisfy `elementCoordinates`'s `Storage` parameter, **HALT and report**: the lean predicate must remain a real runtime type-guard, not a cast.

Closing the seam structurally (the contract storage type carrying `namespaces` so no narrowing is needed) ripples through `ContractSpaceMember` and every caller — out of scope here; deferred-item candidate.

## References

- Parent project: [`projects/contract-ir-planes/spec.md`](../../spec.md) — PDoD6
- Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727) (closes [TML-2580](https://linear.app/prisma-company/issue/TML-2580))
- `elementCoordinates` free function established in S1.A
