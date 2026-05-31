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

---

# Rework: commit fully to the namespaced model (no back-compat, namespace-aware identity)

The first implementation pass landed the *envelope* (`domain.namespaces.<ns>`) but kept a flat mental model underneath, bridged by a back-compat compatibility layer. Review surfaced this as design defects, not patchable nits. This rework replaces that layer.

## The underlying problem

The shape is namespaced on the outside; the identity model is still flat-by-name on the inside. Three load-bearing symptoms:

1. **A legacy-flat read path.** `LegacyFlatDomainRoot`, the `DomainContractInput` union, `isLegacyFlatDomainRoot`, and `normalizeLegacyDomainRoot` exist to read the *old* flat `contract.models` shape. The contract is content-addressed and every fixture is regenerated — there is no on-disk legacy contract that must be read. This is back-compat for a shape that never ships, and the project rule is no back-compat unless asked.
2. **Validation collapses namespaces.** `validate-domain.ts` unwraps the namespaced domain and immediately re-flattens it to a single `{ models }` bag (`flattenDomainContract` → `contractModels`), then validates against a flat `Set<modelName>`. `auth.User` and `public.User` collapse to one identity — destroying exactly the collision-realism the two-plane design exists to guarantee. Cross-namespace relation/base/owner targets cannot be checked correctly.
3. **Flat-by-name projection is the default everywhere.** `contractModels` / `contractValueObjects` (runtime) and `ContractModelsMap` / `ContractValueObjectsMap` (type-level) merge across all namespaces with `Object.assign` / `UnionToIntersection`. The emitter (`generate-contract-dts.ts`) consumes the merged map and emits every model under a hardcoded `__unbound__`. The merge is identity-collapsing and silent.

## Design principle (the decision)

**Within the framework, a domain entity's identity is its coordinate `(namespaceId, entityName)` — never a bare name.** The framework never collapses namespaces into a name-keyed bag for any identity-sensitive purpose (validation, canonicalization, diffing, hashing).

A **flat-by-name view is not an identity primitive; it is a query-surface convenience** owned by a later slice (`runtime-qualification`), where it is produced deliberately by resolving a bare name through a per-family **default namespace**. It must be impossible for the framework to silently merge two distinct coordinates into one name.

Corollary: a single-namespace *projection* (the only case that exists today) is legitimate **only when it names its precondition** — it takes or asserts one namespace, rather than merging across all of them and hoping they don't collide.

## What changes

### 1. Delete the back-compat layer
- Remove `LegacyFlatDomainRoot`, `DomainContractInput`, `isLegacyFlatDomainRoot`, `normalizeLegacyDomainRoot`, and their exports.
- `domain.namespaces` is the *only* shape the deserializer, validator, emitter, and read helpers accept. No dual-branch reads, no normalize-on-read.
- Reconcile with the fixtures already migrated by the prior pass (they call `buildDomainPlaneFromFlat`; see rename below).

### 2. Namespace-aware validation (kills the "deeply suspicious" flatten)
- `validate-domain.ts` validates **over the namespaced structure**. Model existence, relation targets, base/variant links, ownership, and roots all resolve by `CrossReference` `{ namespace, model }` against the target namespace's models — not a global name `Set`.
- Identity and duplicate detection are per-`(namespace, name)`. Two namespaces may each hold a `User`.
- `flattenDomainContract` is removed.

### 3. Replace identity-collapsing helpers
- Remove the cross-namespace merge in `contractModels` / `contractValueObjects`. Where a consumer genuinely needs to walk every entity, it uses the coordinate walk (`domainElementCoordinates`) and keeps the namespace.
- Where a consumer needs a single-namespace map *today* (emitter, DSL inference pending `runtime-qualification`), provide an explicit **single-namespace projection** that takes a `namespaceId` (or asserts exactly one namespace and throws otherwise). No silent cross-namespace `Object.assign`.
- `ContractModelsMap` / `ContractValueObjectsMap`: reduce to the single-namespace projection that the DSL inference consumes today (mirror whatever the runtime helper does). Drop the `UnionToIntersection` cross-namespace merge — it only models a multi-namespace DSL surface that this slice does not deliver and `runtime-qualification` will design properly.

### 4. Emitter honesty about single-namespace
- The emitter today emits all models under a hardcoded `__unbound__`. Keep it single-namespace for this slice, but route it through the **explicit single-namespace projection** (assert/throw on multi-namespace) so the limitation is loud, not silent. True per-namespace `contract.d.ts` emission is deferred to `runtime-qualification` (it co-designs with the DSL surface).

### 5. Use the existing path-pattern helper
- Replace the hand-rolled `currentPath.length === 6 && currentPath[0] === 'domain' && …` checks in `canonicalization.ts` with `matchesPathPattern(path, ['domain','namespaces','*','models','*','relations'])` (and siblings), the helper already in `canonicalization-path-match.ts`.

### 6. Naming
- Rename `DomainContractSlice` — "slice" is reserved vocabulary here and not domain language. Use `ContractWithDomain` (or inline the type).
- Rename `buildDomainPlaneFromFlat` to an honest single-namespace authoring constructor (e.g. `domainPlaneOf({ models, valueObjects, namespaceId? })`). It is an authoring/test convenience for the single-namespace case, not a legacy bridge — the name must not imply migration-from-flat.

## Scope boundary (what stays out)

- **Multi-namespace DSL query surface and per-namespace `contract.d.ts` emission** — `runtime-qualification`'s job. This slice keeps the DSL/emitter single-namespace but makes the single-namespace assumption *explicit and loud* instead of an implicit merge.
- Storage plane — untouched (as before).

## Rework done conditions (in addition to the originals above)

- [ ] No `LegacyFlatDomainRoot` / `DomainContractInput` / `normalizeLegacyDomainRoot` / `isLegacyFlatDomainRoot` anywhere; deserializer accepts only `domain.namespaces`.
- [ ] `validate-domain.ts` resolves identity by `(namespace, model)`; a fixture with the same model name in two namespaces validates as two distinct models (add a test pinning this).
- [ ] No cross-namespace `Object.assign` / `UnionToIntersection` merge of models or value objects; single-namespace projection takes/asserts a namespace.
- [ ] Canonicalizer domain checks go through `matchesPathPattern`.
- [ ] `DomainContractSlice` and `buildDomainPlaneFromFlat` renamed per above; call sites updated (incl. fixtures migrated by the prior sweep).
- [ ] Emitter throws (not silently merges) if asked to emit a multi-namespace domain.

## Additional refusal triggers

- Implementer reaches for a cross-namespace flat merge to "make types line up" — **stop and report**; the single-namespace projection must name its namespace.
- Implementer expands into multi-namespace DSL typing or per-namespace d.ts emission — **stop and report** (that is `runtime-qualification`).
