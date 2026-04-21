# Callable Field Accessor Path Validation — Execution Plan

## Summary

Close the known gap in the Mongo query-builder's callable field accessor: `f("address.city")` becomes compile-time validated against the contract's model + value-object structure, returns an `Expression` carrying the resolved leaf's codec, and surfaces ArkType-style autocomplete. Property form is unchanged. Delivered as an additive type-level change in `@prisma-next/mongo-query-builder` with one runtime sibling (a reduced-surface `Expression<ObjectField>` for non-leaf paths).

**Spec:** [callable-field-accessor-path-validation.spec.md](../specs/callable-field-accessor-path-validation.spec.md)

**Linear:** [TML-2281](https://linear.app/prisma-company/issue/TML-2281/type-safe-dot-path-validation-for-query-builder-callable-field)

**Parent project:** [projects/mongo-pipeline-builder](../spec.md) — "Address Framework Gaps" milestone.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | Mongo-family reviewers | Signing off on `FieldAccessor` signature change and `ObjectField` op surface |

## Milestones

### Milestone 1: Type-safe callable form end-to-end

Single milestone, sequenced as a test-first slice. Each task either ships tests or ships implementation that unblocks the next tests. Because the change is additive at runtime (no new AST nodes, no adapter changes), this can land as one PR.

**Validation:** All new type-level tests in `test/field-accessor.test-d.ts` pass; every existing test in `packages/2-mongo-family/5-query-builders/query-builder/test/**` and `packages/2-mongo-family/5-query-builders/orm/test/**` continues to pass; `pnpm --filter @prisma-next/mongo-query-builder build` produces fresh `.d.mts` declarations; `pnpm lint:deps` passes; README caveat is removed; ADR 180 note is updated.

**Tasks (sequenced):**

- [ ] 1.1 — **Extend `test/fixtures/test-contract.ts`.** Add a `User` model with nested value-object fields (`address: Address`, `stats: Stats`, `workAddress: Address?`). Add `Address`, `GeoPoint`, `Stats` to `TestContract.valueObjects`. `Address` contains `city: string` and `geo: GeoPoint`; `GeoPoint` contains `lat: number`, `lon: number`; `Stats` contains `loginCount: number`, `lastLogin: Date`. Include a self-referential case (`NavItem.children: NavItem[]`) at the *type* level even if `many: true` array element traversal is out of scope — needed to prove `PathCompletions` doesn't infinitely expand. Update `testContractJson` to match.
- [ ] 1.2 — **Write `test/field-accessor.test-d.ts` (failing).** Type tests covering:
  - Property form unchanged (`f.status`, `f.email`).
  - Leaf resolution through one level (`f("address.city")` → `Expression<StringField>`).
  - Leaf resolution through two levels (`f("address.geo.lat")` → `Expression<NumericField>`).
  - Non-leaf resolution (`f("address")` → `Expression<ObjectField<AddressShape>>`).
  - Reduced op surface on `Expression<ObjectField>`: `.set({...})`, `.unset()`, `.exists()`, `.eq(null)`, `.ne(null)` compile; `.gt`, `.lt`, `.in`, `.nin`, `.inc`, `.mul`, `.push`, `.addToSet`, `.pop`, `.pull`, `.pullAll`, `.rename`, `.currentDate` are `@ts-expect-error`.
  - Invalid paths (`@ts-expect-error`): `f("bogus")`, `f("address.bogus")`, `f("address.city.nope")`.
  - Callable disabled after replacement stages: `q.from("users").group(…).then(f => f("address.city"))` is `@ts-expect-error`.
  - Callable preserved after additive stages (`match`, `sort`, `limit`, `addFields`, `lookup`, `unwind`, `sample`, `skip`, `redact`, `densify`, `fill`, `search`, `vectorSearch`, `unionWith`).
  - Write terminal callable works: `q.from("users").updateMany(f => [f("address.city").set("LA")])` compiles.
  - Self-referential value object: `f("nav.children.label")` compiles (at least one level deep); `PathCompletions<NavItemShape>` doesn't cause TypeScript to error.
  - Nullable intermediate: `f("workAddress.city")` resolves to a nullable leaf.
  - Union member: if a union VO field has a shared key across members, `f("union.sharedKey")` resolves to the union of leaf types.

  These will all fail on the current `main`; that's the point.
- [ ] 1.3 — **Add `src/resolve-path.ts`** with pure type utilities: `NestedDocShape`, `ObjectField<N>`, `ResolvePath<N, P>`, `ValidPaths<N>`, `PathCompletions<N, Prefix>`. Unit type tests in `test/resolve-path.test-d.ts` covering each utility in isolation. `types.test-d.ts` stays focused on the existing flat machinery.
- [ ] 1.4 — **Add `ModelNestedShape<TContract, ModelName>`** alongside `ModelToDocShape` in `src/types.ts`. Walks `kind: 'scalar' | 'valueObject' | 'union'` field types, resolves `valueObject.name` against `TContract['valueObjects']`, distributes unions, folds nullable intermediates into downstream leaves' `nullable: true`. `many: true` stops at a leaf (the array field) — no element traversal. Type tests in `test/resolve-path.test-d.ts` for each field-kind case.
- [ ] 1.5 — **Update `src/field-accessor.ts`:**
  - Add second generic `N extends NestedDocShape = Record<string, never>` to `FieldAccessor`.
  - Rewrite the callable signature to `<P extends ValidPaths<N>>(path: P | PathCompletions<N>) => Expression<ResolvePath<N, P>>` — with `ValidPaths<N>` as the inference constraint and `PathCompletions<N>` contributing autocomplete.
  - Split `Expression<F>` into the existing leaf interface and a new `ObjectExpression<N>` interface with the reduced op surface; let `Expression<F>` conditionally resolve to whichever applies (`F extends ObjectField<infer SubShape> ? ObjectExpression<SubShape> : LeafExpression<F>`). Keep the runtime `buildExpression` uniform (constructs the full object with every method); the object variant's type just hides non-applicable methods.
  - Update `createFieldAccessor<S, N>()` signature; the Proxy body is unchanged.
  - Runtime is backward-compatible: property access still builds a `LeafExpression`; callable still returns the same runtime object shape.
- [ ] 1.6 — **Thread `N` through state classes (`src/state-classes.ts`) and the builder (`src/builder.ts`).**
  - `CollectionHandle<TContract, M, S, N>`, `FilteredCollection<…, S, N>`, `PipelineChain<…, S, N>`: add `N` generic.
  - `from(collection)` seeds `N = ModelNestedShape<TContract, M>` alongside `S = ModelToDocShape<TContract, M>`.
  - Additive stage methods carry `N` forward.
  - Replacement stage methods reset `N` to `Record<string, never>` (so callable form becomes `(path: never) => …` — unusable).
  - Pass `N` into every `createFieldAccessor` call site so callback signatures surface it.
- [ ] 1.7 — **Export new utilities** from `src/exports/index.ts`: `NestedDocShape`, `ModelNestedShape`, `ResolvePath`, `ValidPaths`, `PathCompletions`, `ObjectField`.
- [ ] 1.8 — **Keep `@prisma-next/mongo-orm` compiling.** The ORM consumes `FieldAccessor` (see `packages/2-mongo-family/5-query-builders/orm/src/field-accessor.ts` and `collection.ts`). Thread `N` through the ORM's call sites; the existing ORM test surface (`orm-types.test-d.ts`, `collection.test.ts`) must continue to pass unchanged. If the ORM's own callable form wants to consume the same `N`, derive it from the model type and pass it through; otherwise leave `N` defaulted and the ORM's callable form remains unusable (acceptable for this ticket since ORM's callable form is an aside to TML-2281).
- [ ] 1.9 — **Runtime non-regression spot-check.** Add/extend one assertion in `test/builder.test.ts` that `f("address.city").eq("NYC")` produces the same `MongoFieldFilter.eq("address.city", "NYC")` node as today (structural equality against a snapshot). This guards against any accidental runtime divergence when splitting `Expression<F>` into conditional leaf/object variants.
- [ ] 1.10 — **Update package README** (`packages/2-mongo-family/5-query-builders/query-builder/README.md`). Remove the "does not currently validate the path" caveat in the "Field accessor" section. Add a short example showing `f("address.city").eq(...)` with a link to ADR 180.
- [ ] 1.11 — **Update ADR 180** (`docs/architecture docs/adrs/ADR 180 - Dot-path field accessor.md`). Change the top-of-file implementation-status note from "Type-safe path validation is tracked on TML-2281" to "Implemented in TML-2281" (link the PR once open).
- [ ] 1.12 — **Update project spec** (`projects/mongo-pipeline-builder/spec.md`). Add a row to the status table referencing TML-2281 and this spec; link this plan from the References section.
- [ ] 1.13 — **Local validation.** Run:
  - `pnpm --filter @prisma-next/mongo-query-builder build`
  - `pnpm --filter @prisma-next/mongo-query-builder typecheck`
  - `pnpm --filter @prisma-next/mongo-query-builder test`
  - `pnpm --filter @prisma-next/mongo-orm typecheck`
  - `pnpm --filter @prisma-next/mongo-orm test`
  - `pnpm lint:deps`
  - Confirm no `.d.mts` drift in consumers by running `pnpm build` at repo root for downstream packages that import `FieldAccessor`.

### Close-out

- [ ] Verify every acceptance criterion in [the spec](../specs/callable-field-accessor-path-validation.spec.md) has a corresponding passing test (see the Test Coverage table below).
- [ ] Finalise follow-up tickets: (a) "Array element / positional paths in callable FieldAccessor", (b) "Extend `addFields`/`project`/`group` to surface computed fields back into `N`", (c) "Depth cap on `PathCompletions` if CI compile time regresses", (d) "Trait-gated operator surface on `Expression<LeafField>` per ADR 202".
- [ ] PR opened, reviewed, merged.
- [ ] At parent project close-out (`projects/mongo-pipeline-builder`), ADR 180's link to this spec is replaced with a direct link to the merged PR; this spec/plan pair is deleted alongside the rest of `projects/mongo-pipeline-builder/`.

## Test Coverage

Every acceptance criterion in the spec maps to at least one test or verification step. Test types: **Type** = `.test-d.ts` via `expectTypeOf` and `@ts-expect-error`; **Unit** = `.test.ts`; **Compile** = whole-package `typecheck`.

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `ResolvePath` leaf at top level | Type | 1.3 | `resolve-path.test-d.ts` |
| `ResolvePath` leaf one level deep | Type | 1.2, 1.4 | `field-accessor.test-d.ts` + fixture |
| `ResolvePath` leaf two levels deep | Type | 1.2 | `address.geo.lat` |
| `ResolvePath` non-leaf → `ObjectField` | Type | 1.2, 1.3 | |
| `ResolvePath` invalid → `never` | Type | 1.3 | `resolve-path.test-d.ts` |
| `ValidPaths` completeness | Type | 1.3 | Snapshot union |
| `PathCompletions` contains `"address"` and `"address."` | Type | 1.3 | Progressive autocomplete |
| Self-referential VO doesn't explode | Compile | 1.3, 1.4 | `NavItem.children` fixture; whole suite compiles |
| Property form unchanged | Type | 1.2 | `f.status` continues to resolve |
| Callable leaf resolution | Type | 1.2 | `f("address.city")` |
| Callable non-leaf resolution with reduced ops | Type | 1.2 | `f("address").set(...)` etc. |
| Non-object operators on `ObjectField` are errors | Type (negative) | 1.2 | `@ts-expect-error` per operator |
| Invalid callable paths are errors | Type (negative) | 1.2 | `@ts-expect-error` |
| Error message surfaces valid-path union | Type (inspection) | 1.2 | Visual check in test output |
| Callable preserved after additive stages | Type | 1.2 | Per additive-stage case |
| Callable disabled after replacement stages | Type (negative) | 1.2 | Per replacement-stage case |
| Write terminal callable works | Type | 1.2 | `updateMany(f => [f("address.city").set("LA")])` |
| Existing query-builder tests pass | Compile + Unit | 1.13 | Full suite |
| Existing ORM tests pass | Compile + Unit | 1.13 | Full suite |
| `pnpm lint:deps` passes | Compile | 1.13 | |
| Runtime node emitted unchanged | Unit | 1.9 | `builder.test.ts` spot-check |
| README caveat removed | Manual | 1.10 | Diff review |
| ADR 180 updated | Manual | 1.11 | Diff review |
| Project spec status table updated | Manual | 1.12 | Diff review |

## Open Items

Carried forward from the spec's Open Questions. These are execution-time decisions; defaults are stated in the spec.

1. **Union member resolution in `ResolvePath`.** Default: union the resolved leaves; drop paths where a key is missing from any member. Revisit if ergonomics suffer.
2. **`addFields`-extended callable paths.** Default: not in scope. If a compelling use case emerges during implementation, file follow-up; do not expand here.
3. **Nullable intermediate behaviour.** Default: fold nullability downward (nullable intermediate → leaf's `nullable = true`). Implementation note for task 1.4.
4. **Compile-time performance.** No depth cap on `PathCompletions` for v1. Monitor CI time during PR; if the query-builder package's typecheck time regresses meaningfully, add a cap and file a follow-up.
5. **ORM callable form.** In scope only to the extent of keeping the ORM compiling. If the ORM already derives a nested shape equivalent to `N`, wire it through; otherwise leave its callable form defaulted (unusable) and file a follow-up.
6. **Unvalidated string paths for migration authoring.** **Resolved in review round 1 (F12/F13).** Strict validation breaks backfill migrations that write to fields not yet present in the pre-migration contract (the canonical case: the `retail-store` `backfill-product-status` migration writes to `status` before the post-migration contract hash rolls forward). Resolution: add an explicit `f.raw("path")` escape hatch on `FieldAccessor` that returns `LeafExpression<DocField>` with the verbatim path, callable-form validation bypassed. Migration authoring uses `f.raw("status")` in place of `f("status")`. Additionally, example consumer tsconfigs must include `migrations/**/*.ts` so the typecheck exercises migration code (the `retail-store` tsconfig was updated accordingly). Follow-up: audit other example/package tsconfigs for the same exclusion pattern and file a separate ticket if others are found.
