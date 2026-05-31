# Slice spec: symmetric domain plane

**Umbrella:** [`projects/target-extensible-ir-namespaces`](../../spec.md)
**ADR:** [ADR 221](../../../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)

## At a glance

```jsonc
// before (today on main)
{
  "models": { "User": { /* … */ } },
  "valueObjects": { /* … */ },
  "domain": { "__unbound__": { "types": { /* codec spillover */ } } },  // partial, untyped
  "storage": {
    "storageHash": "…",
    "types": { "Embedding1536": { /* … */ } },
    "namespaces": { "public": { "tables": { /* … */ } } }
  }
}

// after (this slice)
{
  "domain": {
    "namespaces": {
      "public": {
        "models": { "User": { /* … */ } },
        "valueObjects": { /* … */ }
      }
    }
  },
  "storage": { /* unchanged envelope */ }
}
```

**Decision:** Wire the domain plane into the same `{ namespaces: { <nsId>: … } }` envelope storage already uses. Do **not** flatten storage. Framework domain has **no** `types` member — doc-scoped codec aliases remain on SQL `storage.types` only.

## Why this slice hangs together

S1 closed with storage correct and domain unfinished. ADR 221 was amended after #649 (storage flatten) was abandoned: mixing `storageHash` / `types` into the namespace key-space is the wrong trade. The remaining FR2 gap is domain-only symmetry plus consumer migration.

## Design decisions (settled)

1. **Storage untouched.** `storage.namespaces.<ns>` stays as on `main`. No reserved-key machinery, no flat `storage.<ns>`.
2. **Domain envelope mirrors storage.** `contract.domain.namespaces.<nsId>.{ models, valueObjects }`. Optional future `domainHash` sibling is out of scope unless emission already has a natural hook — do not block the slice on it.
3. **No `types` on framework domain.** Per-namespace `types` slots in the old ADR example were wrong for the framework plane. Codec/type-alias registrations that are doc-scoped stay under `storage.types` (SQL family).
4. **Logical coordinate unchanged.** Entity address remains `(plane, namespaceId, entityKind, entityName)`; path is `contract.<plane>.namespaces.<ns>.<kind>.<name>`.
5. **Walks use the same pattern as storage.** Extend or add `elementCoordinates` / domain-plane entry helpers analogous to `storageNamespaceEntries` — iterate `plane.namespaces`, not reserved-key denylists.

## Scope

**In:**

- Foundation + core `Contract` / domain IR types: remove flat `models` / `valueObjects` from contract root in emitted JSON; populate `domain.namespaces`.
- Authoring builders, PSL interpreter paths, TS contract builder: emit domain envelope.
- Serializer / deserializer / canonicalization / emitter for domain plane.
- Consumers: migration tooling, validators, tests, examples, fixtures — migrate reads off `contract.models` to `contract.domain.namespaces` (or shared walk helpers).
- Regenerate on-disk `contract.json` / `contract.d.ts` where domain shape changes.

**Out:**

- Storage plane reshape (explicitly forbidden).
- Postgres `public` default (next slice, S3).
- Runtime SQL qualification (S4).
- `domainHash` content-addressing unless trivially aligned with existing profile hash work — do not expand scope.

## Done conditions

- [ ] Emitted contracts have `domain.namespaces.<ns>.models` (and valueObjects when present); flat root `models` absent from canonical emission.
- [ ] `storage.namespaces` unchanged; `pnpm fixtures:check` green.
- [ ] `elementCoordinates` (or domain equivalent) walks `domain.namespaces` without reserved-key hacks.
- [ ] Standard validation gates green (typecheck, test:packages, test:integration, test:e2e, lint:deps).
- [ ] Upgrade instructions recorded if `examples/` or `packages/3-extensions/` *source* changes.

## Refusal triggers

- Implementer needs to flatten `storage.namespaces` or add `STORAGE_PLANE_RESERVED_KEYS` — **stop and report** (wrong direction).
- Implementer adds `types` to framework `Domain` plane type — **stop and report**.

## Edge cases

- Contracts with only `__unbound__` namespace: preserve sentinel behavior; domain namespaces map must still include `__unbound__` when models live there today.
- Cross-namespace relation pairs: unchanged encoding; resolution paths must read models via domain namespaces walk.
- Partial `domain` bag today: remove or migrate spillover `domain.__unbound__.types` into correct homes (`storage.types` or per-model fields) as part of wiring — do not leave duplicate type registries.
