# Summary

Make the Mongo query-builder's callable field accessor (`f("address.city")`) type-safe. The callable overload becomes constrained to valid dot-paths resolved against the contract's model and value-object structure, returns an `Expression` carrying the leaf field's codec, and offers ArkType-style autocomplete for nested paths. Invalid paths are compile-time errors.

**Linear:** [TML-2281](https://linear.app/prisma-company/issue/TML-2281/type-safe-dot-path-validation-for-query-builder-callable-field)

# Description

The query-builder's `FieldAccessor<S>` in `@prisma-next/mongo-query-builder` supports two forms:

- **Property form** — `f.status`, `f.amount`: validates field names against the pipeline's current `DocShape`.
- **Callable form** — `f("address.city")`: accepts any string, returns `Expression<DocField>`.

The callable form was introduced during query-builder unification (TML-2267) as an escape hatch for nested/value-object dot-paths. It is intentionally permissive today — `f("nonexistent.path")` compiles, and the returned expression has no codec information. This gap is documented in the package README and ADR 180.

This ticket closes the gap: `f` becomes a generic whose path parameter is constrained to the valid dot-paths derivable from the contract (model fields + nested value objects + union members), and the return type reflects the resolved leaf type. The property form is unchanged.

**Users:** Every consumer of `@prisma-next/mongo-query-builder` — ORM write paths, custom pipeline queries, and the forthcoming value-object surface (ADR 180). Compile-time path validation prevents a class of latent bugs (typos, stale paths after model refactors) that would otherwise surface only at runtime as "field not found" or silent empty results.

**Prior art referenced:**

- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) prescribes the canonical `ResolvePath<T, Path>` recursive template-literal shape and lazy `PathCompletions<...>` autocomplete.
- [ADR 178 — Value objects in the contract](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) is the source of nested structure.
- [`InferModelRow`](../../../packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts) already walks value-object/union field types recursively to produce concrete row types. The new `ResolvePath` walks the same contract structure but stops at `DocField` leaves rather than concrete JS types.
- [PR #355](https://github.com/prisma/prisma-next/pull/355) §5.3.5 identified this as a framework gap.

# Requirements

## Functional Requirements

### Type utilities (new, in `@prisma-next/mongo-query-builder`)

- `NestedDocShape` — `Record<string, DocField | NestedDocShape>`. The walkable shape used only by the callable form. Sits alongside the existing flat `DocShape`, which is unchanged.
- `ModelNestedShape<TContract, ModelName>` — recursively resolves a model's fields:
  - `kind: 'scalar'` → `DocField` leaf
  - `kind: 'valueObject', name: V` → `ModelNestedShape` derived from `TContract['valueObjects'][V]['fields']`
  - `kind: 'union', members: […]` → distributes over members; each scalar member contributes its `DocField`, each value-object member contributes its nested shape
  - `many: true` → stops at a `DocField` leaf for the array itself; element-wise traversal is out of scope (see Non-goals)
- `ResolvePath<N extends NestedDocShape, Path extends string>` — template-literal recursive:
  - Leaf match → `DocField`
  - Non-leaf match → `ObjectField<SubShape>` (see below)
  - Invalid → `never`
- `ValidPaths<N extends NestedDocShape>` — union of every valid dot-path string for `N` (leaves and intermediates). Used to constrain the callable's path parameter so call-site errors read "Argument of type '\"…\"' is not assignable to parameter of type '\"address\" | \"address.city\" | …'".
- `PathCompletions<N extends NestedDocShape, Prefix extends string = "">` — lazy ArkType-style completion union: for each key `K`, yields `${Prefix}${K}` and, when `N[K]` is nested, the prefix `${Prefix}${K}.` plus the recursive expansion. TypeScript's lazy conditional-type evaluation handles self-referential value objects (ADR 180's `NavItem.children` case). No artificial depth cap for v1.
- `ObjectField<N extends NestedDocShape>` — marker DocField variant for non-leaf resolution: `{ readonly codecId: 'prisma/object@1'; readonly nullable: boolean; readonly fields: N }`. Consumed by `Expression<F>` to select the reduced operator surface.

### Escape hatch for unvalidated paths — `f.raw("path")`

Some callers need a callable path that is intentionally _not_ validated against the contract — the canonical case is a data-backfill migration that writes to a field before the post-migration contract hash has rolled forward. Strict callable validation would reject those paths ("not assignable to parameter of type `never`") even though the runtime is fine.

`FieldAccessor` exposes `raw<F extends DocField = DocField>(path: string): LeafExpression<F>` as the sanctioned escape hatch:

- Accepts any string; no `ValidPaths<N>` constraint.
- Returns `LeafExpression<F>` — the full leaf operator surface (`set`, `unset`, `exists`, `inc`, `push`, …). Default `F = DocField`; callers can narrow via the explicit generic: `f.raw<StringField>("status").set("active")`.
- Independent of `N`, so it remains available in the "callable disabled" state downstream of replacement stages.
- Deliberately not an `ObjectExpression`: migration authoring is always about writing a leaf (or checking its presence), so the reduced object surface doesn't apply.

At runtime `f.raw(path)` uses the same `buildExpression(path)` helper as the strict callable, so the emitted filter/update nodes are byte-identical.

### `FieldAccessor` signature change

`FieldAccessor` gains a second generic parameter carrying the nested shape:

```ts
export type FieldAccessor<
  S extends DocShape,
  N extends NestedDocShape = Record<string, never>,
> = {
  readonly [K in keyof S & string]: Expression<S[K]>;
} & (<P extends ValidPaths<N>>(path: P) => Expression<ResolvePath<N, P>>) & {
    readonly stage: StageEmitters;
  };
```

- Default `N = Record<string, never>` → `ValidPaths<{}> = never` → the callable resolves to `(path: never) => …`, which is a type error at any call site. This is the "disabled" state for pipeline-replacing stages and the safe default for call sites that don't opt in.
- The property form (`f.status`) is unchanged.
- Autocomplete is surfaced by intersecting `ValidPaths<N>` with a companion `PathCompletions<N>` literal-prefix union at the parameter position. Implementation detail: the parameter type is written so the IDE's completions come from `PathCompletions<N>` while the inference constraint stays `ValidPaths<N>`.

### `Expression<ObjectField>` — reduced operator surface

When `ResolvePath` lands on a non-leaf, the returned `Expression` type exposes a reduced surface:

- `set(value: MongoValue): TypedUpdateOp` — whole-object replacement, per ADR 180.
- `unset(): TypedUpdateOp`
- `exists(flag?: boolean): MongoFilterExpr`
- `eq(value: null): MongoFilterExpr` — matches ADR 180's `u("workAddress").isNull()` idiom (we reuse `.eq(null)` rather than adding a new `isNull()` method).
- `ne(value: null): MongoFilterExpr`

Arithmetic, comparison, and array operators (`gt`, `lt`, `in`, `nin`, `inc`, `mul`, `push`, `addToSet`, etc.) are **not** on the object-variant interface; calling them is a type error. No trait-gating yet (ADR 202 is out of scope for this ticket).

At runtime, `buildExpression(path)` continues to produce the same uniform object — type narrowing is purely structural. The runtime methods that aren't exposed on the type are still present on the value but unreachable through the typed API.

### Pipeline-builder threading

In `src/builder.ts` and `src/state-classes.ts`, every state class carries the nested shape `N` in its type parameters alongside the flat `DocShape`:

- `from(collection)` seeds both: `S = ModelToDocShape<TContract, M>` (flat, as today) and `N = ModelNestedShape<TContract, M>` (new, nested).
- **Additive / identity stages** (`match`, `sort`, `limit`, `skip`, `sample`, `addFields`, `lookup`, `unwind`, `redact`, `densify`, `fill`, `search`, `vectorSearch`, `unionWith`) carry `N` forward unchanged. Note: `addFields` could extend `N` with the added scalar leaves; deferred to a follow-up to keep this ticket focused.
- **Replacement / shape-resetting stages** (`group`, `project`, `replaceRoot`, `count`, `sortByCount`, `bucket`, `bucketAuto`, `facet`, `geoNear`, `graphLookup`, `setWindowFields`, `searchMeta`, `pipe` when the user narrows with an explicit type parameter) reset `N` to `Record<string, never>`, which disables the callable form for that stage onward.
- **Write terminals** (`updateMany`, `updateOne`, `upsertOne`, `findOneAndUpdate`, `findOneAndDelete`) receive `N` from the preceding state; from `CollectionHandle` and `FilteredCollection` that is the model's full nested shape.

### Value-object test fixture

`test/fixtures/test-contract.ts` is extended with a model that exercises nested value objects:

- New `User` model gains `address: Address` (value-object field) and `stats: Stats` (value-object field).
- `Address` value object has at least one scalar field (`city: string`) and one nested value object (`geo: GeoPoint`).
- `GeoPoint` has scalar leaves (`lat: number`, `lon: number`).
- `Stats` has `loginCount: number`, `lastLogin: Date`.
- A nullable value object (`workAddress: Address?`) to exercise nullable non-leaf paths.

Fixture covers the single-model case required for this ticket; array-of-value-objects remains out of scope.

### Documentation updates

- `packages/2-mongo-family/5-query-builders/query-builder/README.md` — replace the "the callable form does not currently validate the path" caveat with a short description of the new behaviour and a worked example.
- `docs/architecture docs/adrs/ADR 180 - Dot-path field accessor.md` — update the implementation-status note at the top (currently points at TML-2281 as pending) to mark path validation as shipped and link the PR.
- `projects/mongo-pipeline-builder/spec.md` — add a row to the status table referencing TML-2281 and link this spec.

## Non-Functional Requirements

- No `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`. Type casts minimised; any `as unknown as T` carries a justifying comment.
- All AST node construction stays immutable / frozen (no behavioural change).
- No runtime performance regression. The `FieldAccessor` proxy shape is unchanged; only type-level machinery is added.
- TypeScript compilation time on the query-builder package should not regress by more than a small constant factor. We rely on TypeScript's lazy evaluation of recursive conditional types for self-referential value objects; no artificial depth cap for v1. If real contracts reveal a regression, a follow-up ticket will add a depth cap to `PathCompletions`.
- Builder layering unchanged. The new utilities live inside `@prisma-next/mongo-query-builder` (`src/resolve-path.ts` or colocated in `src/types.ts` depending on file size). `pnpm lint:deps` continues to pass.
- Public export surface change is additive: `NestedDocShape`, `ModelNestedShape`, `ResolvePath`, `ValidPaths`, `PathCompletions`, `ObjectField` are exported from `src/exports/index.ts`. The `FieldAccessor` generic-arity change has a default, so existing external usages that don't instantiate it explicitly still compile.

## Non-goals

- Array element / positional paths: `tags.0`, `items.$`, `items.$[]`, `items.$[elem]`. These require a distinct typing strategy and real use cases in the builder.
- Extending `addFields`, `project`-computed, `group`-accumulators, and similar to inject synthesised fields back into `N` (so that computed fields become callable-addressable). Small convenience; follow-up.
- Trait-gated operator surface on `Expression<LeafField>` per [ADR 202 — Codec trait system](../../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md). Only `ObjectField` gets a distinct (reduced) interface in this ticket; leaf expressions keep their current full op surface.
- Runtime path validation. Purely compile-time; the runtime `buildExpression` is unchanged.
- SQL JSONB path support. Mongo-only for this ticket.
- Autocomplete depth cap / perf guard — only added if needed.
- Changes to `ResolveRow` or the flat `DocShape`. Those remain leaf-only and flat.
- Changes to `mongo-orm` package beyond whatever type-signature ripple is needed to keep it compiling after the `FieldAccessor` arity change.

# Acceptance Criteria

### Type utilities

- [ ] `ResolvePath<N, "status">` resolves to the `DocField` for `status` when `status` is a leaf in `N`.
- [ ] `ResolvePath<N, "address.city">` resolves to the leaf `DocField` for `city` when `address` is a value object and `city` is a scalar leaf under it.
- [ ] `ResolvePath<N, "address.geo.lat">` resolves correctly through two levels of nesting.
- [ ] `ResolvePath<N, "address">` resolves to `ObjectField<AddressShape>` (non-leaf).
- [ ] `ResolvePath<N, "bogus">`, `ResolvePath<N, "address.bogus">`, `ResolvePath<N, "address.city.nope">` all resolve to `never`.
- [ ] `ValidPaths<N>` contains every valid leaf and intermediate path string; does not contain any invalid path string.
- [ ] `PathCompletions<N>` contains both `"address"` and `"address."`, the latter enabling progressive autocomplete.
- [ ] Self-referential value objects (e.g. `NavItem.children: NavItem`) produce `PathCompletions` that do not infinitely expand and do not cause TypeScript to error out on deep instantiation.

### `FieldAccessor` behaviour

- [ ] Property form `f.status` continues to compile and produces `Expression<StringField>` (unchanged from today).
- [ ] Callable form `f("address.city")` compiles and produces `Expression<StringField>`.
- [ ] Callable form `f("address")` compiles and produces an `Expression<ObjectField<…>>` with the reduced surface: `.set({...})`, `.unset()`, `.exists()`, `.eq(null)`, `.ne(null)` all compile.
- [ ] Calling `.gt(…)`, `.in(…)`, `.inc(…)`, `.push(…)` (and other non-object operators) on `Expression<ObjectField<…>>` is a compile-time error.
- [ ] Callable form `f("bogus")` is a compile-time error (`@ts-expect-error`-verified).
- [ ] Callable form `f("address.bogus")` is a compile-time error.
- [ ] The compile error message for invalid paths surfaces the union of valid paths (constrained-generic approach), not just `Argument of type 'string' is not assignable to 'never'`.
- [ ] `f.raw("status")` accepts an unvalidated string path and returns a `LeafExpression<DocField>` with the full leaf operator surface (`set`, `exists`, `inc`, `push`, …).
- [ ] `f.raw` accepts paths that are not in `ValidPaths<N>` — including deeply-nested strings that don't correspond to any contract field.
- [ ] `f.raw` remains callable when `N = Record<string, never>` (i.e. downstream of replacement stages and in the default-disabled state).
- [ ] `f.raw<StringField>("status")` narrows the return to `LeafExpression<StringField>` via the explicit generic.
- [ ] The retail-store `backfill-product-status` migration uses `f.raw("status")` and typechecks under `pnpm --filter retail-store typecheck`, with `examples/retail-store/tsconfig.json` now including `migrations/**/*.ts`.

### Pipeline threading

- [ ] After an additive stage (`match`, `sort`, `limit`, `skip`, `sample`, `addFields`, `lookup`, `unwind`, `redact`, `densify`, `fill`, `search`, `vectorSearch`, `unionWith`), the callable form continues to accept all paths valid on the seeded model.
- [ ] After a replacement stage (`group`, `project`, `replaceRoot`, `count`, `sortByCount`, `bucket`, `bucketAuto`, `facet`, `geoNear`, `graphLookup`, `setWindowFields`, `searchMeta`), `f("anything")` is a compile-time error.
- [ ] Write terminals reached from `CollectionHandle` / `FilteredCollection` receive the full nested shape: `q.from("users").match(…).updateMany(f => [f("address.city").set("LA")])` compiles.
- [ ] A pipeline-style update reached from a replacement stage cannot use the callable form: `q.from("users").group(…).updateMany()` does not expose a callable form (and is not reachable via this path anyway).

### Non-regression

- [ ] Every existing test in `packages/2-mongo-family/5-query-builders/query-builder/test/**` continues to pass.
- [ ] Every existing test in `packages/2-mongo-family/5-query-builders/orm/test/**` continues to pass.
- [ ] `pnpm --filter @prisma-next/mongo-query-builder typecheck` and `test` succeed.
- [ ] `pnpm --filter @prisma-next/mongo-orm typecheck` and `test` succeed (orm consumes `FieldAccessor`; any signature ripple fixed in this ticket).
- [ ] `pnpm lint:deps` passes.
- [ ] One `builder.test.ts` spot-check confirms the runtime node emitted by `f("address.city").eq("NYC")` is byte-identical to today's output.

### Documentation

- [ ] Package README no longer contains the "callable form does not currently validate the path" caveat.
- [ ] ADR 180 implementation note updated to mark TML-2281 as shipped.
- [ ] `projects/mongo-pipeline-builder/spec.md` status table references TML-2281.

# Other Considerations

## Security

No additional security surface. Purely compile-time type machinery. Paths were already user-authored strings at the runtime layer; type-safety reduces the risk of authoring typos that would otherwise surface as no-op queries or zero-match updates.

## Cost

None. Compile-time only. No runtime allocations, no infrastructure impact.

## Observability

No change. `FieldAccessor` proxy still emits `MongoAggFieldRef.of(path)` and `MongoFieldFilter.*(path, …)` nodes. The `lane: "mongo-query"` marker on `MongoQueryPlan` is unaffected.

## Data Protection

No change. No data is introduced; no logging is added.

## Analytics

N/A — framework type-level change.

## Compilation Performance

Recursive template-literal types have a reputation for slowing down the compiler on deep unions. Mitigations baked in:

- `PathCompletions` uses the same lazy pattern ArkType uses, so self-referential value objects don't explode.
- `ValidPaths` and `PathCompletions` are distinct types; the callable constraint uses the narrower `ValidPaths`, which is the leaner union.
- `ModelNestedShape` is computed once per model (not per pipeline stage) by threading a stable type through the builder, so each stage's type-check does a cheap parameter carry rather than a recompute.
- If contracts with 5+ levels of nesting or wide fan-out trigger compile slowdowns in CI, we add a depth cap to `PathCompletions` as a follow-up.

# References

- [TML-2267 — Mongo query builder unification](https://linear.app/prisma-company/issue/TML-2267) — introduced the callable form as an untyped escape hatch.
- [PR #355](https://github.com/prisma/prisma-next/pull/355) — code review §5.3.5 identified this gap.
- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)
- [ADR 178 — Value objects in the contract](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)
- [ADR 179 — Union field types](../../../docs/architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md)
- [ADR 202 — Codec trait system](../../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md) — out of scope here; informs the reduced `ObjectField` operator surface.
- [`field-accessor.ts`](../../../packages/2-mongo-family/5-query-builders/query-builder/src/field-accessor.ts) — current site of the callable overload.
- [`types.ts`](../../../packages/2-mongo-family/5-query-builders/query-builder/src/types.ts) — current `DocField` / `DocShape` / `ResolveRow` / `ModelToDocShape`.
- [`contract-types.ts`](../../../packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts) — `InferModelRow` shows the pattern for walking value objects and unions.

# Open Questions

1. **Union member resolution.** ADR 179 (union field types) permits a field to be one of several value-object shapes. For v1, `ResolvePath` walks every member and unions the leaf types. This means `f("container.payload.field")` resolves to a union if `payload` is a union of VOs that share a field. **Default:** union the resolved leaves. If members diverge (a key exists in only some members), exclude the path from `ValidPaths`. Confirm in implementation; adjust if it hurts ergonomics.
2. **`addFields`-extended callable paths.** Should a computed field added via `addFields(f => ({ fullName: … }))` become addressable via `f("fullName")` in a subsequent stage's callable form? Default: **no** for this ticket (property form is enough); log a follow-up for the convenience.
3. **Nullable intermediate behaviour.** For a nullable value-object path (`workAddress?.city`), does `f("workAddress.city")` resolve to `Expression<StringField>` (nullability folded in at runtime) or `Expression<NullableStringField>`? Default: **fold nullability downward** — any nullable intermediate marks the leaf's `nullable` as `true` in the resolved `DocField`. Matches how MongoDB dot-path access behaves (missing parent → missing leaf).
