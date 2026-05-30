# Slice: migration-element-coordinates (S1.D-3)

_In-project slice. Parent project `projects/contract-ir-planes/`. Outcome: the migration tooling walks IR entities via the polymorphic `elementCoordinates(storage)` free function instead of the name-only `extractStorageElementNames` helper — completing PDoD6's migration consumer. Closes [TML-2580](https://linear.app/prisma-company/issue/TML-2580)._

## At a glance

S1.A introduced `elementCoordinates(storage)` as the idiomatic, namespace-aware IR walk. The migration aggregate still walks via the older name-only `extractStorageElementNames`. Migrate those consumers to `elementCoordinates`, resolve the `StorageBase` vs `Storage` type gap that blocks them, and delete the old helper. **Output-preserving: no on-disk shape change.**

## Chosen design

The migration aggregate consumers walk IR entities via `elementCoordinates(storage)` over a storage type that **statically carries the namespace topology** — no runtime narrowing, no duck-typing. The way that becomes true: **lift the storage topology into the foundation contract type.**

- `0-foundation/contract` declares a minimal, plain **topology shape** (a `namespaces` map; each namespace carries `id` plus entity-kind slot maps of named entries) and `StorageBase` carries it. No `IRNode`, no class machinery — pure persisted-data shape.
- `1-core/framework-components` refines that shape: `Storage` / `Namespace` extend the foundation topology and add the `IRNode`-ness and family typing.
- `elementCoordinates` types against the foundation topology (core refines it), so any `StorageBase`-typed value walks without a cast.
- The migration aggregate's element-name walk collapses to `elementCoordinates(contract.storage)`; the `hasNamespaceMap` bridge and the `storage-element-names` duck-typing are deleted, and so is the original `extractStorageElementNames` stopgap.

This is the structurally-honest close of the `StorageBase`/`Storage` gap: foundation declares the topology it actually depends on (the disjointness check is foundation-level migration safety), instead of erasing it and forcing every consumer to re-recover it by duck-typing.

## Coherence rationale

One reviewable unit: the namespace topology becomes a first-class part of the contract type, and the migration walk that needed it stops duck-typing. The substrate change and the consumer cleanup ship together as one PR because the cleanup is the *reason* for the substrate change — but they split into sequential dispatches (substrate green first, cleanup second) so the judgment site isn't buried in the type fan-out.

## Scope

**In:** the foundation storage-topology shape on `StorageBase`; the core `Storage`/`Namespace` refinement; `elementCoordinates` retyped against the topology; alignment of every family storage type + construction/fixture site so the workspace typechecks; deletion of the `hasNamespaceMap` bridge, the `storage-element-names` duck-typing, and the `extractStorageElementNames` stopgap.

**Out:** any change to the **on-disk** contract envelope (this is a type-only change — `fixtures:check` stays zero-diff); the `introspect()`-output duck-typing in `projectSchemaToSpace`'s schema-pruning half (`SqlSchemaIR`/`MongoSchemaIR` — a separate seam); the other S1.D slices and the deferred items.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `StorageBase` topology change touches a public/exported surface | **Sanctioned** | This is now the explicit point of the slice (operator decision, Round 3) — the public surface change is intended, not a refusal trigger. |
| On-disk contract bytes move | Refusal trigger | This is a **type-only** lift. If `fixtures:check` shows any diff, **HALT and report** — the hydrated-vs-serialized boundary was crossed wrongly. |
| Making `namespaces` required forces a construction site to declare a topology it doesn't honestly have (e.g. an empty-contract sentinel) | Decide + report | Prefer required (every hydrated contract carries namespaces); if a legitimate site can't, model it honestly (empty map) rather than making the field optional to dodge — surface the call. |
| Type fan-out balloons across many packages | Re-decompose | If aligning construction sites exceeds one coherent M-sized dispatch, HALT and split out a mechanical fan-out dispatch before continuing. |

## Slice-specific done conditions

- [ ] `StorageBase` (foundation) carries the namespace topology as a plain shape; core `Storage`/`Namespace` refine it; `elementCoordinates` types against it.
- [ ] No duck-typing / runtime narrowing remains in the migration aggregate's element walk: `hasNamespaceMap`, the `storage-element-names` predicate, and `extractStorageElementNames` are gone (grep-clean outside this project's docs).
- [ ] `pnpm fixtures:check` zero-diff (type-only change, no envelope movement).
- [ ] `pnpm lint:casts` does not regress (expected to improve — the bridge is removed).
- [ ] Workspace typecheck + affected package tests green.

## Open Questions

None blocking. Working position: `StorageBase` types the **hydrated** contract (always namespace-bearing post-`deserializeContract`), which is distinct from the **serialized envelope** (target-owned; Mongo may strip) — so declaring the topology on `StorageBase` is honest and does not constrain any target's on-disk JSON.

## Round 2 — review actions (PR #629)

Reviewer questioned the defensiveness in `storage-element-names.ts`. Both stand; the seam stays but loses its over-defensive dressing.

- **R1 — Drop the per-entry null sweep.** The `Object.values(namespaces).every(ns => non-null object)` loop defends against impossible input: the parameter is a typed `Contract` (not `unknown`, as it was when that guard was first written), and `elementCoordinates` already skips null slots internally. A validated contract never carries a null namespace value. Remove the sweep; `hasNamespaceMap` narrows to `object` + has-a-`namespaces`-map only.
- **R2 — Reframe the guard as a layering type-bridge, not malformed-input defence.** The guard exists because `Contract.storage` resolves to `StorageBase` (foundation, hash-only) while `namespaces` lives on the framework `Storage` interface (core); foundation can't reference `Namespace`, so the migration layer narrows `StorageBase → Storage` at runtime in lieu of a banned bare `as`. Rewrite the function doc-comment and the inline comment to say that — drop the "malformed or partially-constructed" framing.
- **Refusal trigger** — if leaning the guard out forces a bare `as` cast or a `blindCast` to satisfy `elementCoordinates`'s `Storage` parameter, **HALT and report**: the lean predicate must remain a real runtime type-guard, not a cast.

Closing the seam structurally (the contract storage type carrying `namespaces` so no narrowing is needed) ripples through `ContractSpaceMember` and every caller — out of scope here; deferred-item candidate.

## Round 3 — scope change (operator): supersede the bridge

**The Round-2 bridge is withdrawn.** Investigation traced the duck-typing to a known layering violation (the `extractStorageElementNames` stopgap comment names it: "the framework lacks a typed primitive for storage *topology*"). The root cause is that the namespace topology is modelled **only** as core-layer IR (`Storage`/`Namespace extends IRNode`), so the foundation `StorageBase` it's threaded through can't name it — even though the disjointness check (foundation-level migration safety) depends on it.

The operator has pulled the structural fix **into this slice** (no longer deferred): lift the topology shape into foundation and refine it in core (see the updated `## Chosen design`). This supersedes Round 2's R1/R2 — there is no bridge to lean out; the bridge is deleted. The `## Scope` refusal trigger about "widening a public surface" is correspondingly retired (that change is now the point).

## Dispatch plan

Sequential; each hands a **green workspace** to the next. Lands on the existing slice branch / PR #629.

### D1 — Lift storage topology into foundation; refine in core; retype the walk

- **Outcome:** `StorageBase` carries the namespace topology as a plain foundation shape; core `Storage`/`Namespace` refine it (adding `IRNode`); `elementCoordinates` types against the topology; every family storage type + construction/fixture site is aligned so **the whole workspace typechecks and `fixtures:check` is zero-diff**. No consumer behaviour changes yet — the bridge still stands.
- **Builds on:** current PR #629 head (the leaned bridge).
- **Hands to:** a storage type that statically exposes `namespaces` from any `StorageBase`-typed value; green workspace.
- **Focus:** the substrate + the type fan-out to keep it green. Halt-and-split if the fan-out exceeds one coherent M (see edge-case table). Do **not** touch the migration consumers' duck-typing yet — that's D2, kept separate so this judgment isn't buried in the fan-out.

### D2 — Delete the duck-typing; walk through `contract.storage` directly

- **Outcome:** the migration aggregate's element walk is `elementCoordinates(contract.storage)` with no narrowing; `hasNamespaceMap`, the `storage-element-names` predicate, and `extractStorageElementNames` are deleted (grep-clean). `lint:casts` improves; all gates green.
- **Builds on:** D1's hand-off (`StorageBase` exposes namespaces statically).
- **Hands to:** the slice-DoD — no duck-typing remains, behaviour unchanged, fixtures byte-stable.
- **Focus:** subtractive cleanup; inline the helper into its callers and delete it if that reads cleaner than keeping a one-line wrapper.

## References

- Parent project: [`projects/contract-ir-planes/spec.md`](../../spec.md) — PDoD6
- Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727) (closes [TML-2580](https://linear.app/prisma-company/issue/TML-2580))
- `elementCoordinates` free function established in S1.A
