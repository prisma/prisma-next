# Slice: ir-primitive

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the substrate (the `control` field + `defaultControl` + the effective-control resolver) that every downstream control-policy slice reads._

## At a glance

Add `control: ControlPolicy` to every storage-plane IR node and `defaultControl` to the top-level contract, plus a single pure resolver for effective control. Nothing changes behaviour: the field defaults to `managed`, and because it is omitted from serialization when unset, every existing contract hashes identically.

## Chosen design

- **`ControlPolicy`** = `'managed' | 'tolerated' | 'external' | 'observed'`, declared in `@prisma-next/contract` (the `0-foundation` package, which lives under `packages/1-framework/`). It must sit there because both the top-level `Contract` type (same package) and the SQL/Mongo family IR (which already import from `@prisma-next/contract/types`) need it, and foundation cannot import upward.
- **`effectiveControl(nodeControl, defaultControl)`** → `nodeControl ?? defaultControl ?? 'managed'`. A pure, framework-agnostic free function in foundation. It takes the two raw optional values (not a node), so it needs no knowledge of family-specific node types. One function; the verifier and planner (downstream slices) are its only callers.
- **`defaultControl?: ControlPolicy`** added to the `Contract` interface.
- **`control?: ControlPolicy`** added to every storage-plane leaf, following the idiom these classes already use for optional fields — `declare readonly x?` + `if (input.x !== undefined) this.x = input.x` (see `StorageColumn`'s `typeParams`/`typeRef`/`default`). Targets: SQL `StorageTable` and `StorageColumn`, the Mongo storage entity (collection), and the target-only `PostgresEnumStorageEntry`.
- **arktype validators** gain optional `control` (on the storage entities) and `defaultControl` (on the contract).

The **no-hash-churn** guarantee falls straight out of the idiom: an unset `control` is never assigned, so it is never an own-enumerable property, so it never serializes. Existing `managed`-by-default contracts produce byte-identical JSON and identical hashes.

```ts
// StorageColumn already does exactly this for `default`; control mirrors it:
export class StorageColumn extends SqlNode {
  declare readonly control?: ControlPolicy;
  constructor(input: StorageColumnInput) {
    // …
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }
}
```

## Coherence rationale

One uniform fan-out: the same optional field threaded through every storage-plane node + its validator + one shared resolver, proved by one round-trip property test per target. A reviewer holds a single idea — "a new optional field, defaulted `managed`, omitted when default" — across the diff without re-orienting.

## Scope

**In:** `ControlPolicy`; `effectiveControl`; `Contract.defaultControl`; `control?` on SQL `StorageTable`/`StorageColumn`, the Mongo storage entity, and `PostgresEnumStorageEntry`; the arktype validators for all of those; round-trip property tests across Postgres, SQLite, Mongo; the `fixtures:check` no-churn gate.

**Out:** verifier dispatch (slice 2), planner dispatch + safety guard (slice 3), TS authoring (slice 4), PSL authoring (slice 5). The resolver lands with no production callers yet — that is the intended hand-off; consumers wire in downstream. A unit test exercises it so it is not dead code.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Adding the field rehashes every committed contract | Mitigated by design | The omit-when-default idiom keeps unset `control` out of the serialized form; `pnpm fixtures:check` is the gate that proves zero churn. This is the project's no-hash-churn cross-cutting requirement. |

Otherwise none pre-investigated — the implementer's dispatch-time grep on each storage-entity class + validator is the discovery mechanism.

## Slice-specific done conditions

- [ ] Round-trip property tests pass for Postgres, SQLite, and Mongo: a contract carrying mixed `control` values (and a `defaultControl`) survives `serialize → deserialize` with effective control preserved per node.
- [ ] `pnpm fixtures:check` shows zero churn in existing contract fixtures (managed-default contracts hash identically).

## Open Questions

1. Does `effectiveControl` belong in `@prisma-next/contract` (foundation) or `@prisma-next/framework-components` (1-core)? Working position: foundation, because `Contract` lives there and the function is framework-agnostic; `pnpm lint:deps` in the dispatch confirms no layering violation.

## References

- Parent project: [`projects/control-policy/spec.md`](../../spec.md)
- Linear issue: TML-2775
- [ADR 221 — two-plane Contract IR](../../../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- [three-layer polymorphic IR pattern](../../../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md)
