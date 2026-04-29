# M3: Polymorphic Index Generation

## Summary

Auto-derive `partialFilterExpression` for indexes declared on variant models in polymorphic Mongo collections (single-table inheritance). When a variant index is merged into the base collection, the Mongo authoring path attaches a discriminator-scoped partial filter so the resulting MongoDB index is constrained to documents of that variant.

Cross-family — the same problem applies to SQL STI with Postgres/SQLite partial indexes (and a no-op-with-warning for MySQL) — is **out of scope** for M3. SQL solves SQL when it gets there, in whatever shape its families/targets prefer; this milestone is Mongo-only.

## Linear

[TML-2232](https://linear.app/prisma-company/issue/TML-2232)

## Grounding example

A polymorphic `Task` collection with `Bug` and `Feature` variants, each with a unique index on a variant-specific field:

```prisma
model Task {
  id    ObjectId @id @map("_id")
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
  @@index([title])
}

model Bug {
  id       ObjectId @id @map("_id")
  severity String

  @@base(Task, "bug")
  @@unique([severity])
}

model Feature {
  id       ObjectId @id @map("_id")
  priority Int

  @@base(Task, "feature")
  @@unique([priority])
}
```

Today (post-Phase-1.75b polymorphism + post-M2 index authoring) the Mongo PSL interpreter merges variant indexes into the base collection, producing this `storage.collections.tasks`:

```json
{
  "indexes": [
    { "keys": [{ "field": "title", "direction": 1 }] },
    { "keys": [{ "field": "severity", "direction": 1 }], "unique": true },
    { "keys": [{ "field": "priority", "direction": 1 }], "unique": true }
  ]
}
```

That is wrong: the unique index on `severity` would treat all Feature documents (which have no `severity`) as colliding on `null`. The same is true for `priority` against Bug documents.

After M3, those variant-specific indexes carry a discriminator-scoped partial filter:

```json
{
  "indexes": [
    { "keys": [{ "field": "title", "direction": 1 }] },
    {
      "keys": [{ "field": "severity", "direction": 1 }],
      "unique": true,
      "partialFilterExpression": { "type": "bug" }
    },
    {
      "keys": [{ "field": "priority", "direction": 1 }],
      "unique": true,
      "partialFilterExpression": { "type": "feature" }
    }
  ]
}
```

The base index on `title` is unchanged — base-declared indexes apply to every document in the collection.

The Mongo planner, runner, schema IR, and migration-runner integration paths already carry `partialFilterExpression` end-to-end from M2; the only change M3 makes is that those partial filters now exist on the contract in the first place.

## Decision

The rule is applied **inline at the existing variant-merge points in the Mongo authoring layer**:

- `mongo-contract-psl/src/interpreter.ts` — the variant patcher that merges a variant model's indexes into its base collection's index list.
- `mongo-contract-ts/src/contract-builder.ts` — `buildCollections()`, where each model builder's indexes are flushed into the named collection (and where variants already have their `__collection` patched to the base's collection).

Both call sites use a single shared helper in `@prisma-next/mongo-contract` so they cannot drift.

There is **no** framework-level helper, target-capability SPI, or emit-pipeline change. Mongo has a 1:1 family-to-target mapping today, so the inline-per-target rule reduces to the inline-per-authoring-path rule above. Targets that aren't Mongo solve their version of this problem in their own authoring code (or wherever else makes sense for them) when the time comes.

### Helper API

In `@prisma-next/mongo-contract`, a new module `polymorphic-index-scope.ts`:

```typescript
import type { MongoStorageIndex } from './contract-types';

export type PolymorphicIndexScope = {
  readonly discriminatorField: string;
  readonly discriminatorValue: string | number | boolean;
};

export type ApplyScopeResult =
  | { readonly kind: 'ok'; readonly index: MongoStorageIndex }
  | { readonly kind: 'conflict'; readonly reason: string };

export function applyPolymorphicScopeToMongoIndex(
  index: MongoStorageIndex,
  scope: PolymorphicIndexScope,
): ApplyScopeResult;
```

Behavior:

1. If `scope.discriminatorValue` is not a JSON scalar (string/number/boolean), return `conflict` with a reason explaining that variant-scoped indexes require scalar discriminator values.
2. Compute `merged = { ...index.partialFilterExpression, [scope.discriminatorField]: scope.discriminatorValue }`. Effectively, top-level keys of `partialFilterExpression` are AND-combined.
3. If `index.partialFilterExpression?.[scope.discriminatorField]` already equals `scope.discriminatorValue` exactly, return the original index unchanged (idempotent — re-running the helper produces the same result).
4. If it exists with a different value, return `conflict` describing the mismatch (the user's filter contradicts the variant's discriminator).
5. Otherwise return `{ kind: 'ok', index: { ...index, partialFilterExpression: merged } }`.

The helper is pure, target-specific only in that it operates over Mongo storage types, and entirely independent of the contract model graph. The authoring call sites compute the scope from `discriminator` + `variants` + `base` metadata and pass it in.

### Discriminator value origin

The discriminator value comes from the variant's `base` declaration:

- PSL: `@@base(Task, "bug")` → `"bug"` (always a string at the PSL boundary today).
- TS DSL: `discriminator({ field, variants: { Bug: { value: "bug" } } })` and corresponding `base()` call → whatever the user passed.

ADR 184 (codec-owned value serialization) places discriminator value encoding under the discriminator field's codec. Today the only practical codecs produce JSON scalars, so the helper's scalar-only assertion is satisfied. If a future codec produces a non-scalar JSON value, the helper surfaces a clean diagnostic at authoring time.

### Conflict surfacing

Both authoring paths translate `conflict` results into their existing diagnostic shapes:

- PSL interpreter pushes a `ContractSourceDiagnostic` with code `PSL_INVALID_INDEX` and the index attribute's source span.
- TS contract-builder throws an `Error` with a clear message (matching its existing index-validation conventions, e.g. the duplicate-index error in `buildCollections()`).

### Cross-variant indexes

Variant `fields` are thin per ADR 173 — variant-specific only. The intended rule is that `@@index([title])` on `Bug` should fail because `Bug` doesn't declare `title` (it inherits it from `Task`); indexing a base-inherited field with variant scope is not supported in M3. The base-collection-wide case is expressed by declaring `@@index([title])` on `Task`.

**Pre-M3 gap surfaced during implementation (Phase 2 R1):** the Mongo PSL interpreter's `collectIndexes` and the TS contract-builder both silently emitted indexes referencing fields that aren't declared on the model. The pre-existing escapee affects every `@@index`/`@@unique` field reference, not just polymorphism — but it's exactly what allows the cross-variant rule above to bite. M3 closes the escapee on both authoring surfaces:

- **PSL path (T3.2.1):** `collectIndexes` emits `PSL_INDEX_FIELD_NOT_FOUND` (a `ContractSourceDiagnostic` with the index attribute's span) when an `@@index`/`@@unique`/`@@textIndex` field-list references a field not declared on the model.
- **TS path (T3.3.1):** the contract-builder throws an `Error` naming the model, the index's signature, and the missing field when an `index({ keys: { ... } })` declaration on a model builder names a field not present on the model's `fields`.

The variant-on-base-field regression test (`@@index([title])` on `Bug`) routes through the new diagnostic. Same-shape regression on the TS DSL.

## Acceptance criteria

- [ ] `applyPolymorphicScopeToMongoIndex` exists in `@prisma-next/mongo-contract` and matches the semantics above (scalar guard, idempotence, AND-merge with conflict detection).
- [ ] Mongo PSL interpreter calls the helper for each variant index it merges into the base collection. The output `MongoStorageIndex` carries `partialFilterExpression` with the discriminator field set to the variant's value.
- [ ] Mongo TS contract-builder calls the helper at the equivalent merge point. Output is identical for equivalent inputs to the PSL path.
- [ ] An index declared on the base model (not on a variant) is unchanged — no `partialFilterExpression` is added by M3.
- [ ] When a user-supplied `filter:` argument on a variant index is compatible with the variant's discriminator (no overlap, or overlap with matching value), the helper merges them and the AND-combined filter appears in the contract.
- [ ] When a user-supplied `filter:` sets the discriminator field to a value that disagrees with the variant's discriminator, the authoring layer emits a diagnostic (PSL: `ContractSourceDiagnostic`; TS: `Error`).
- [ ] An attempt to index a base-inherited field on a variant model produces a field-resolution diagnostic (regression). Both surfaces:
  - PSL: `@@index([title])` on `Bug` emits `PSL_INDEX_FIELD_NOT_FOUND` with the attribute's span.
  - TS DSL: the contract-builder throws an `Error` naming the model, index signature, and missing field.
- [ ] **Model-level field-existence diagnostic (closes the pre-M3 escapee):** any non-polymorphic `@@index([nonexistent])` / `@@unique([nonexistent])` / `index({ keys: { nonexistent: 1 } })` declaration on a Mongo model also surfaces the same diagnostic — the rule applies model-wide, not just to polymorphic variants.
- [ ] The existing "merges variant indexes into base collection" tests in `interpreter.polymorphism.test.ts` are extended to assert `partialFilterExpression` content (not just key membership).
- [ ] `examples/mongo-demo/prisma/contract.prisma` declares an index on a variant-specific field on at least one of the existing polymorphic variants (`Article` or `Tutorial`) and the emitted `contract.json` carries the expected `partialFilterExpression`.
- [ ] **End-to-end**: a polymorphic PSL contract with at least one variant-specific index runs through `migration plan` → `migration apply` against `mongodb-memory-server`, and the resulting MongoDB index reported by `db.collection.listIndexes()` has the expected `partialFilterExpression` set to `{ [discriminatorField]: discriminatorValue }`.
- [ ] Round-trip introspection: introspecting a partial index produced by M3 → diffing against the contract that produced it via the existing `verifyMongoSchema` path yields no false-positive issues.

## Non-goals

- **SQL parity.** Postgres/SQLite/MySQL partial-index handling is out of scope. Each SQL target solves its own version when SQL polymorphism work tackles indexes; this milestone does not pre-bake an SPI for them.
- **Cross-variant or mixed-base+variant indexes.** Indexes that combine a base field and a variant field, or fields from multiple variants, are not supported. PSL field resolution rejects them organically. A future ticket can add explicit diagnostics or expand support.
- **Indexing inherited base fields with variant scope.** A user cannot declare `@@index([title])` on `Bug` to mean "title-index scoped to bugs only". The base-field-on-variant path is not in scope.
- **Reverse derivation from existing contracts.** M3 only attaches partial filters at authoring time. Hand-edited `contract.json` that omits `partialFilterExpression` on a variant index is not auto-corrected at validation or planning time.
- **Capability gating.** No new contract `capabilities` entry is introduced; partial-index support in MongoDB is a baseline assumption.

## Risk

- **Variant `base` declaration coverage.** The helper relies on `models[V].base` and `models[B].discriminator/variants` being populated correctly. Phase 1.75b polymorphism work did this; if any future change breaks the bidirectional invariant, M3 derivation breaks too. Mitigated by integration tests asserting end-to-end behavior on real PSL.
- **User-supplied filter conflicts.** Changing the user's authored filter shape (by AND-merging) could surprise. Mitigated by idempotence and the explicit conflict diagnostic.
- **Discriminator value typing.** Today PSL forces strings; this assumption may shift as discriminator codecs broaden. Helper validates scalar-ness defensively to surface a clean diagnostic if the assumption breaks.

## References

- [ADR 173 — Polymorphism via discriminator and variants](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) § Indexes on variant-specific fields
- [ADR 184 — Codec-owned value serialization](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md)
- Project plan: [`projects/mongo-schema-migrations/plan.md`](../plan.md) § Milestone 3
- Mongo contract types: `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts`
- Mongo PSL interpreter (variant-merge block): `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts` (~L260–L319)
- Mongo TS contract-builder (`buildCollections`): `packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts` (~L1226–L1291)
- Existing variant-index merging tests: `packages/2-mongo-family/2-authoring/contract-psl/test/interpreter.polymorphism.test.ts` (~L379–L454)
- Existing planner test for polymorphic collections: `packages/3-mongo-target/1-mongo-target/test/mongo-planner.test.ts` (~L1330–L1376)
- Mongo demo: `examples/mongo-demo/prisma/contract.prisma`
