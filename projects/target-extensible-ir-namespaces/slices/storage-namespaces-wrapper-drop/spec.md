# Slice: storage-namespaces-wrapper-drop

_Parent project `projects/target-extensible-ir-namespaces/` (S2, GAP 1). Outcome: the emitted storage plane matches ADR 221's canonical shape — `storage.<ns>` with no `namespaces` wrapper segment — closing the first half of S1's unfinished FR2._

## At a glance

Today the emitted contract puts every namespace under a literal `storage.namespaces.<nsId>` wrapper. ADR 221's canonical shape has no such segment: namespace IDs are keys directly under `storage`, alongside the reserved `storageHash`. This slice drops the wrapper everywhere — IR types, serializer/deserializer, validators, canonicalization, emitter — and regenerates every on-disk contract. It unblocks honest runtime qualification (S4) and makes the IR match the ADR the project already shipped.

## Chosen design

ADR 221 § grounding example is the authority. The storage plane's canonical shape:

**Before (shipped by S1):**

```jsonc
"storage": {
  "namespaces": {
    "__unbound__": {
      "id": "__unbound__",
      "kind": "postgres-unbound-schema",
      "tables": { "bug": { /* columns … */ } }
    }
  }
}
```

**After (ADR 221 canonical):**

```jsonc
"storage": {
  "storageHash": "…",
  "__unbound__": {
    "id": "__unbound__",
    "kind": "postgres-unbound-schema",
    "tables": { "bug": { /* columns … */ } }
  }
}
```

The decided shape, stated precisely:

- The literal word `"namespaces"` never appears as a storage-plane IR segment (ADR 221 commitment 2). Namespace IDs are the direct keys under `storage`.
- `storageHash` is a **reserved sibling key** under `storage`, not a namespace. Any walk over `storage` that enumerates namespaces must treat `storageHash` as reserved and skip it.
- `elementCoordinates` (the canonical free-function walk) stops descending through a `namespaces` segment and instead iterates the namespace-ID keys directly under the storage object.
- This is the JSON shape **and** the in-memory shape (per the json-canonical-class-in-memory pattern). The in-memory storage representation must expose `storageHash` as a typed member while presenting namespace IDs as the entity-bearing keys; how that's typed (reserved-key handling on the family storage classes) is the implementer's call — see Open Questions.

This is a wrapper-removal refactor, not a semantic change: the same namespaces, entity kinds, and entities are present before and after; only their path shortens by one segment. Because `storageHash` is content-addressed over the canonical storage object, the hash of every contract changes — so the slice is **not** done until all on-disk artifacts are regenerated and `fixtures:check` is clean.

## Coherence rationale

One PR. The wrapper appears in one logical place (the storage shape) but is read by many consumers — the framework storage type + `elementCoordinates` walk, the SQL/Mongo family serializer/deserializer + validators, canonicalization, the emitter, and every on-disk `contract.json` / `contract.d.ts`. Splitting the type change from the consumer migration or the fixture regen would leave the IR in a half-migrated, unhashable state that can't pass `fixtures:check` — there's no coherent intermediate PR. One reviewer holds "the wrapper is gone, end to end, and hashes are regenerated" in one sitting.

## Scope

**In:**

- Framework storage IR shape + the `elementCoordinates` walk (drop the `namespaces` segment; skip the reserved `storageHash` key).
- SQL-family (`SqlStorage`) and Mongo-family storage shapes — wrapper removed.
- Serializer / deserializer hydration and the namespace-walk validators.
- Canonicalization + the contract emitter (`contract.json` + `contract.d.ts`).
- Regeneration of all on-disk artifacts: example apps, package test fixtures, extension contract spaces, and any migration metadata pinned to a `storageHash`.

**Out:**

- The `domain` plane (flat `contract.models` / `valueObjects` / `types` → `contract.domain.<ns>.{...}`) — that's GAP 2, the next slice.
- Postgres `public`-by-default at the PSL interpreter — S3.
- Runtime SQL qualification / DSL-ORM fallback — S4.
- The S1-deferred structural follow-ups (TML-2743 `findSqlTable`, TML-2744 `stripNamespaceKinds`, TML-2745 query-builder `UnboundTables`). Touch them only if the wrapper drop mechanically requires it; otherwise leave them.

## Contract-impact

Touches the contract surface directly. The `storage` plane shape changes for every target family (postgres / sqlite / mongo). No entity kinds are added or removed; the wrapper segment is removed. Downstream: `storageHash` (and therefore any `profileHash` derived over it) changes for every contract — every committed `contract.json`, `contract.d.ts`, and `storageHash`-pinned migration ref regenerates. Downstream consumers that walk the IR shape programmatically (not through DSL handles) see the shorter path; if any consumer's **source** shape changes, record upgrade instructions (see `record-upgrade-instructions`).

## Adapter-impact

All SQL targets (postgres, sqlite) and mongo are affected via their family serializers/validators. No target gains or loses capability; each family's storage shape loses the `namespaces` wrapper symmetrically.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `storageHash` enumerated as if it were a namespace | Handle | After the wrapper drops, `storageHash` is a sibling of the namespace-ID keys under `storage`. Every walk that enumerates namespaces (`elementCoordinates`, validators, serializer) must treat `storageHash` as a reserved key and skip it. |
| Fixture/hash regen doesn't cascade to extension migration pins | Handle | `pnpm fixtures:emit` regenerates `contract.{json,d.ts}` but is known not to chain the per-extension migration regen loop (TML-2698). Extension `migrations/refs/head.json` + per-migration `to`/`from` hash pins may need separate regeneration; `fixtures:check` surfaces the drift. |

## Slice-specific done conditions

- [ ] A grep gate confirms no `storage.namespaces` wrapper path remains — neither in emitted artifacts (`**/contract.json`, `**/contract.d.ts`) nor in source that reads/writes the storage shape.
- [ ] All on-disk contract + migration artifacts regenerated and committed; `pnpm fixtures:check` clean.

## Open Questions

1. **How is the reserved-key storage map typed in-memory?** Mixing a typed `storageHash: string` with namespace-ID keys (each a `Namespace`) under one object is the reserved-key-in-a-map tension the `namespaces` wrapper originally sidestepped. Working position: keep `storageHash` a typed member on the family storage class and present namespaces through the entity-coordinate walk / non-enumerable-vs-enumerable property discipline already used for `kind`; the serializer writes namespace IDs as direct keys and `storageHash` as a reserved sibling. The implementer picks the cleanest typing that avoids `any` / wide casts. **Refusal trigger:** if flattening the in-memory type forces a structural rewrite beyond this slice (e.g. a query-builder type rewrite à la TML-2745), stop and report — that's a re-decomposition, not part of GAP 1.

## References

- Parent project: [`projects/target-extensible-ir-namespaces/spec.md`](../../spec.md)
- Linear issue: [TML-2747](https://linear.app/prisma-company/issue/TML-2747)
- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) (commitment 2: `"namespaces"` never appears as an IR segment)
- [TML-2698](https://linear.app/prisma-company/issue/TML-2698) — `fixtures:emit` doesn't chain the per-extension migration regen loop (known fixture-regen footgun)
