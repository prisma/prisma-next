# M3 Implementation Plan: Polymorphic Index Generation

## Goal

Auto-derive `partialFilterExpression` for indexes declared on variant models in polymorphic Mongo collections, applied at the existing variant-merge points in both Mongo authoring paths (PSL and TS). End-to-end proof: PSL contract → emit → plan → apply → partial indexes exist on MongoDB scoped to the correct discriminator values.

## Design references

| Area | Doc |
|---|---|
| M3 spec | [m3-polymorphic-indexes.spec.md](../specs/m3-polymorphic-indexes.spec.md) |
| Polymorphism (cross-family) | [ADR 173](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) § Indexes on variant-specific fields |
| Codec-owned encoding | [ADR 184](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md) |
| Existing M2 contract types | `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts` |
| Existing PSL polymorphism + index tests | `packages/2-mongo-family/2-authoring/contract-psl/test/interpreter.polymorphism.test.ts` |

## Implementation sequence

Tasks are grouped into **phases** by dependency. Tasks within a phase are independent and can be worked in parallel. Tests precede implementation per the repo testing convention.

---

### Phase 1: Helper

#### 3.1 Tests + impl: `applyPolymorphicScopeToMongoIndex`

**Goal:** Pure helper that AND-merges a discriminator scope predicate into a `MongoStorageIndex.partialFilterExpression`, with idempotence and conflict detection.

**Package:** `packages/2-mongo-family/1-foundation/mongo-contract/`

**File:** `src/polymorphic-index-scope.ts` (new). Exported from `src/exports/index.ts`.

**API** (per spec § Helper API):

```typescript
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

**Tests** (`test/polymorphic-index-scope.test.ts`):

- Index with no `partialFilterExpression` + scalar scope → `ok`, partial filter equals `{ [field]: value }`.
- Index with existing filter on **other** fields + scope → `ok`, AND-merged filter has both the user's keys and the discriminator key.
- Index with existing filter that already sets the discriminator field to the **matching** value → `ok`, returns the input index unchanged (idempotent).
- Index with existing filter that sets the discriminator field to a **different** value → `conflict`, reason mentions the field, the user's value, and the variant's value.
- Scope value is a string → `ok`. Scope value is a number → `ok`. Scope value is a boolean → `ok`.
- Scope value is `null`, an array, or an object — these are typed-out at the API boundary, but cast through to verify the runtime guard. Each → `conflict` with a reason explaining the scalar requirement.
- Calling the helper twice with the same scope on its own output is a no-op (idempotence regression test).

**Implementation notes:**

- Don't deep-merge — use top-level key merging. Mongo `partialFilterExpression` AND-combines top-level keys, which matches the user's existing mental model from raw `filter:` arguments in `@@index`.
- Equality check for "matching value" is `===` against scalars. Don't use deep equality.

---

### Phase 2: Authoring call sites (depends on 3.1)

#### 3.2 Tests + impl: PSL interpreter calls helper at variant-merge

**Goal:** When the variant patcher merges a variant model's indexes into the base collection's index list, scope each one to the variant's discriminator before merging.

**Package:** `packages/2-mongo-family/2-authoring/contract-psl/`

**Edit:** `src/interpreter.ts`, the variant-patcher block currently around lines 260–319 (where `baseDecl.value` and `baseModel.discriminator.field` are both available).

**Tests** (extend `test/interpreter.polymorphism.test.ts` `describe('FL-09 …')` or add a new `describe('FL-09: polymorphic index scoping')`):

- Existing test "merges variant indexes into base collection" (~L379) is **strengthened** to assert that the variant index carries `partialFilterExpression: { [discriminatorField]: discriminatorValue }`.
- Existing test "merges variant indexes when variant maps to same collection as base" (~L417) is similarly strengthened.
- New test: base-declared index has **no** `partialFilterExpression` after the patch (regression — base indexes are unscoped).
- New test: variant `@@index([severity], filter: "{ \"active\": true }")` produces a merged filter `{ active: true, type: 'bug' }`.
- New test: variant `@@index([severity], filter: "{ \"type\": \"bug\" }")` (matching) is idempotent — output filter equals input filter.
- New test: variant `@@index([severity], filter: "{ \"type\": \"feature\" }")` on a `Bug` variant emits a `PSL_INVALID_INDEX` diagnostic with the index attribute span.
- New test: variant `@@index([title])` on `Bug` (where `title` is on `Task`, not on `Bug`) emits a field-not-found diagnostic on the variant model — landed via T3.2.1's new model-level diagnostic, not via existing field-resolution (see T3.2.1 below).

**Implementation notes:**

- The variant patcher already knows `baseDecl.value` and the base's `discriminator.field` (from the previous validation pass). Compute the scope once per variant before the merge loop.
- Map the helper's `conflict` result to a `ContractSourceDiagnostic` with `code: 'PSL_INVALID_INDEX'`, `sourceId`, and the original `@@index`/`@@unique` attribute's `span`. To get the span, capture it on the `MongoStorageIndex` shape during `collectIndexes` (e.g. via a parallel `Map<MongoStorageIndex, span>` rather than mutating the storage type) — or restructure `collectIndexes` to return `{ index, span }` pairs internally and strip the spans before emitting. Keep `MongoStorageIndex` storage-shape clean.

---

#### 3.2.1 Tests + impl: PSL `collectIndexes` rejects unknown field references

**Background:** Phase 2 R1 surfaced a pre-existing escapee — `collectIndexes` in `interpreter.ts` builds index keys via `fieldMappings.pslNameToMapped.get(pf.name) ?? pf.name`, silently emitting an index referencing the raw PSL name when the field isn't declared on the model. The spec's § Cross-variant indexes claim that "PSL field resolution rejects this organically" was incorrect — there is no such enforcement. Closing the escapee inline lets AC-M3-07 land cleanly and removes a footgun affecting every Mongo `@@index`/`@@unique`/`@@textIndex`.

**Goal:** Emit a `ContractSourceDiagnostic` with code `PSL_INDEX_FIELD_NOT_FOUND` for any `@@index` / `@@unique` / `@@textIndex` field-list reference that names a field not declared on the model.

**Package:** `packages/2-mongo-family/2-authoring/contract-psl/`

**Edit:** `src/interpreter.ts` — `collectIndexes` (the same function T3.2 already touches for span propagation). Field existence is checked against the same `fieldMappings.pslNameToMapped` map that's used for name resolution. Wildcard segments (e.g. `attrs.$**`) check the prefix only.

**Tests** (extend `test/interpreter.indexes.test.ts` if it exists, otherwise add to the most relevant `test/interpreter.*.test.ts` file):

- Non-polymorphic `@@index([nonexistent])` on a model emits `PSL_INDEX_FIELD_NOT_FOUND` with the index attribute's span.
- `@@unique([nonexistent])` emits the same.
- `@@textIndex([nonexistent])` emits the same.
- Wildcard `@@index([nonexistent.$**])` emits the same (prefix-checked).
- A model with both a valid and an invalid field in the field list emits one diagnostic, identifying the missing field by name.
- Polymorphic regression: `@@index([title])` on `Bug` (variant of `Task`, where `title` is declared on `Task`) emits `PSL_INDEX_FIELD_NOT_FOUND` — closes AC-M3-07 via this path.

**Implementation notes:**

- The diagnostic shape mirrors the existing `PSL_INVALID_INDEX` ones in `collectIndexes` (same `sourceId`, same `span: attr.span`).
- The check should run **before** the helper invocation in T3.2's variant-merge — the field-existence diagnostic preempts the discriminator-scope helper, which means a missing-field variant index never reaches the helper at all.
- The new code is small (~10–15 lines including the wildcard-prefix carve-out). Keep the variable naming consistent with the surrounding `collectIndexes` style.

---

#### 3.3 Tests + impl: TS contract-builder calls helper at variant-merge

**Goal:** Same rule applied in the TS authoring DSL path.

**Package:** `packages/2-mongo-family/2-authoring/contract-ts/`

**Edit:** `src/contract-builder.ts`, in `buildCollections()` (~L1226), where each model builder's indexes are flushed into its collection. A model builder is a variant when `modelBuilder.__base != null` (or however the existing TS path captures the variant→base relationship — confirm against current shape).

**Tests** (`test/contract-builder.dsl.test.ts` or a sibling `contract-builder.polymorphism.test.ts` if the DSL test file is too large already):

- Polymorphic Task/Bug/Feature contract built via `model().discriminator()` + `model().base()` + `index()` produces the same `partialFilterExpression` content as the equivalent PSL input.
- User-supplied compatible filter on a variant index merges as expected.
- User-supplied conflicting filter on a variant index throws an `Error` whose message names the model, the index, the discriminator field, the user's value, and the variant's value.
- Base-declared index has no `partialFilterExpression`.

**Implementation notes:**

- Maintain symmetry with the PSL path: the helper is called from one place, errors are mapped to the TS path's existing diagnostic shape (the current code uses thrown `Error`s — keep that).
- If the existing model-builder shape doesn't carry enough info to compute the scope at `buildCollections()` time (it should — `__base` is set during `.base()` and the discriminator is on the base builder), add the missing wiring rather than hacking around it.

---

#### 3.3.1 Tests + impl: TS contract-builder rejects unknown field references in `index({ keys })`

**Background:** Mirror of T3.2.1 on the TS authoring surface. The TS DSL's `index({ keys: { fieldName: 1 } })` accepts a `fieldName` string at runtime without checking that `fieldName` is declared on the model's `fields`. Same pre-existing escapee shape, same fix shape.

**Goal:** When `buildCollections()` flushes a model builder's `__indexes` into its collection, validate that every `keys` field reference exists in `modelBuilder.__fields` (mapped name, matching whatever name the index generates from the runtime `fieldName`). On miss, throw an `Error` naming the model, the index signature, and the missing field — matching the existing `buildCollections()` error idiom (e.g. the duplicate-index error at L1264).

**Package:** `packages/2-mongo-family/2-authoring/contract-ts/`

**Edit:** `src/contract-builder.ts`, `buildCollections()` (~L1226). The check should run **before** the polymorphic-scope helper invocation in T3.3 — same preempt rule as T3.2.1.

**Tests** (in `test/contract-builder.polymorphism.test.ts` or wherever T3.3's tests landed):

- Non-polymorphic model with `index({ keys: { nonexistent: 1 } })` throws.
- Polymorphic regression: variant declares `index({ keys: { titleFromBase: 1 } })` where `titleFromBase` is on the base model only — throws (closes the TS half of AC-M3-07).
- Mixed valid/invalid keys: throws once, identifies the missing field.

**Implementation notes:**

- The check uses `modelBuilder.__fields` (the variant's own fields) — by spec, variant fields are thin (variant-specific only). A base-inherited field is not available on the variant, which is exactly the intended rule.
- If the TS DSL's `keys` shape uses anything beyond plain `Record<string, MongoIndexFieldValue>` (e.g. nested wildcard syntax), the check accommodates it the same way T3.2.1's PSL implementation does — prefix only for wildcards, exact match otherwise. Confirm the shape during reconnaissance.

---

### Phase 3: End-to-end proof + demo (depends on Phase 2)

#### 3.4 Mongo demo: variant-specific index

**Goal:** Make the demo representative so future regressions surface during demo runs.

**Package:** `examples/mongo-demo/`

**Edit:** `prisma/contract.prisma` — add a unique or non-unique `@@index` (or `@@unique`) on a variant-specific field on `Article` or `Tutorial`. Choice depends on which field is most credible to want indexed in the demo (e.g. `@@unique([summary])` on `Article` or `@@index([duration])` on `Tutorial`).

Re-emit the demo contract via the demo's existing emit command. Sanity-check `prisma/contract.json`:
- `storage.collections.posts.indexes[]` includes the new index with `partialFilterExpression: { kind: "<variantValue>" }`.

**Tests:** none specific — the demo's existing typecheck + smoke runs are the regression net.

---

#### 3.5 Integration test: PSL → emit → plan → apply → assert

**Goal:** End-to-end proof against `mongodb-memory-server` — the core M3 acceptance criterion.

**Package:** Either extend the existing migration-runner integration test file or add a new sibling. Suggested location: `packages/3-mongo-target/2-mongo-adapter/test/mongo-runner.polymorphism.integration.test.ts`.

**What to do:**

- Hand-author or load via the test harness a polymorphic PSL contract (Task/Bug/Feature with at least one variant-specific `@@unique` index).
- Use the existing test setup pattern (mirroring `mongo-runner.schema-verify.integration.test.ts` ~L126) to: emit the contract, plan a migration from an empty origin, run it against `mongodb-memory-server`.
- Assert `db.collection('tasks').listIndexes().toArray()` contains an index whose `partialFilterExpression` deep-equals the expected `{ [discriminatorField]: variantValue }`.
- Assert the index name follows whatever the existing index naming convention is (no special partial-index naming required by M3).
- Insert one Bug document and one Feature document (with the appropriate discriminator). Verify the partial unique index is enforced: inserting a second Bug with a duplicate `severity` fails; inserting a Feature with the same `severity` value succeeds. (This last is the user-visible payoff and protects against silently-wrong derivation.)

---

#### 3.6 Round-trip introspection assertion

**Goal:** Live introspection round-trips polymorphic partial indexes correctly — no false-positive diff reported by `verifyMongoSchema` after applying an M3-produced migration.

**Package:** `packages/3-mongo-target/1-mongo-target/test/` (unit-level can mock introspection results to avoid DB) or in the integration test from 3.5.

**What to do:**

- After 3.5 applies the migration, run live introspection and `verifyMongoSchema(contract, introspectedIR)`.
- Assert no issues are reported (zero diff).
- This catches regressions where introspection canonicalization drops or transforms `partialFilterExpression` in a way that breaks the diff.

---

### Phase 4: Project doc updates

#### 3.7 Update `plan.md` and `spec.md` for M3

**Goal:** Reflect the actual M3 scope after design discussion.

**Edits:**

- `projects/mongo-schema-migrations/plan.md` § Milestone 3:
  - Replace the existing two-task description with the actual breakdown (3.1–3.6 from this plan), or summarize and link to this plan file.
  - Link the new spec at the milestone heading.
  - Add `m3-polymorphic-indexes.spec.md` and `m3-plan.md` to the "Spec/Plan" reference rows.
  - Update the Test Coverage table rows for M3 to match this plan.
- `projects/mongo-schema-migrations/spec.md` § Milestone 3 — keep the requirements but tighten the wording so it matches the spec body (planner is **not** the derivation site; authoring is). Add a sentence noting cross-family deferral.

## Test coverage summary

| Acceptance criterion | Test type | Task |
|---|---|---|
| Helper merges scalar scope into empty filter | Unit | 3.1 |
| Helper AND-merges with user filter on other keys | Unit | 3.1 |
| Helper is idempotent on matching scope | Unit | 3.1 |
| Helper detects conflicting discriminator value | Unit | 3.1 |
| Helper rejects non-scalar discriminator value | Unit | 3.1 |
| PSL: variant index gets `partialFilterExpression` | Unit | 3.2 |
| PSL: base index unchanged | Unit | 3.2 |
| PSL: user-compatible filter merges | Unit | 3.2 |
| PSL: user-conflicting filter → diagnostic with span | Unit | 3.2 |
| PSL: `@@index`/`@@unique`/`@@textIndex` rejects unknown field references | Unit | 3.2.1 |
| PSL: variant-on-base-field emits `PSL_INDEX_FIELD_NOT_FOUND` | Unit | 3.2.1 |
| TS DSL: parity with PSL output | Unit | 3.3 |
| TS DSL: conflicting filter throws | Unit | 3.3 |
| TS DSL: `index({ keys })` rejects unknown field references | Unit | 3.3.1 |
| TS DSL: variant-on-base-field throws | Unit | 3.3.1 |
| Demo emits expected `partialFilterExpression` | Smoke | 3.4 |
| End-to-end plan + apply produces correct partial index | Integration (`mongodb-memory-server`) | 3.5 |
| Partial unique constraint enforced per variant | Integration (`mongodb-memory-server`) | 3.5 |
| Introspection round-trip diff is empty | Integration (`mongodb-memory-server`) | 3.6 |

## Open items

- **Span propagation for PSL conflict diagnostics.** Currently `collectIndexes` returns `MongoStorageIndex[]` and discards source spans. The diagnostic in 3.2 needs the span. Options: (a) parallel array of spans returned from `collectIndexes`, (b) `Map<MongoStorageIndex, Span>` keyed by reference, (c) restructure `collectIndexes` to return tuples and project to indexes at the end. **Resolved (Phase 2 R1):** option (b), `Map<MongoStorageIndex, PslSpan>` keyed by reference, scoped to the interpreter call. (c) would have rippled through 5+ pass-through sites; (b) was a smaller diff with no GC concerns since the map is local to one call.
- **TS DSL variant scope discoverability.** Confirm the model builder graph in `buildCollections()` carries `__base` (or equivalent) and the base builder's `__discriminator` is reachable. **Resolved (Phase 2 R1):** confirmed — `modelBuilder.__base`, base builder's `__discriminator.field`, and `baseBuilder.__variants[variantName].value` all reachable; no wiring extension needed.
- **Demo index choice.** `@@unique([summary])` on `Article` or `@@index([duration])` on `Tutorial` — pick whichever reads better in the demo narrative.

## Risk

- **Discriminator field codec changes.** If a future codec produces non-scalar discriminator values, the helper's scalar guard surfaces a clean diagnostic, but no contract that previously emitted scalars will silently break — the behavior is forward-compatible.
- **Phase 1.75b invariants.** The helper depends on `models[V].base` and `models[B].discriminator/variants` being correct and bidirectional. Existing `validateDiscriminators`/`validateVariantsAndBases` enforce this, and 3.5's e2e test catches any breakage.
