# Decisions Log — Annotation Registry & Callback API

This file captures decisions I made autonomously while implementing the plan in `plan.md` so we can review them when you're back online.

## Approach

- Working from the plan in `plan.md` (six stages). Each stage is a separate `jj` commit. The tip of the work is bookmarked as `cache-middleware-new-api`.
- Plan says stages 1–3 can be parallelized via subagents. Going to do them sequentially to keep the trail tractable; subagent context-loss risk and the desire to keep diffs small for review trumps the parallelism win here, especially because stage 2 cleanly extends data structures touched in stage 1, and stage 3 plumbs through what stage 2 added.
- Plan also says stages 4–6 land sequentially because they share a write scope (lane terminals). I'm following that.

## Decisions made along the way

### Stage 1: `AnnotationRegistry.register` signature deviates slightly from the spec

The spec lists:

```typescript
interface AnnotationRegistry {
  register(handle: AnnotationHandle<unknown, OperationKind>): void;
  entries(): Readonly<Record<string, AnnotationHandle<unknown, OperationKind>>>;
}
```

Now that `AnnotationHandle<Payload, Kinds>` is a callable type, its `Payload` parameter is contravariant. Passing a concrete `AnnotationHandle<{ ttl: number }, 'read'>` to a parameter typed `AnnotationHandle<unknown, OperationKind>` is rejected by TS — `unknown` would have to flow into `{ ttl: number }`, which fails.

Resolution: keep `entries()` returning the loose `AnnotationHandle<unknown, OperationKind>` (consumers only ever read metadata or call the handle with `unknown` payloads at the runtime layer), but make `register` generic:

```typescript
register<P, K extends OperationKind>(handle: AnnotationHandle<P, K>): void;
```

Inside the implementation, the handle is stored under an internal `as unknown as AnnotationHandle<unknown, OperationKind>` cast — a single, documented widening at the storage boundary. This is the only way to bridge the variance without giving up either the registry's uniform storage or the callable-handle ergonomics.

### Stage 1: `RegistryFor` / `AnnotationBuilder` infer `Kinds` from `applicableTo` instead of the callable signature

For the same contravariance reason, `Reg[N] extends AnnotationHandle<unknown, infer Kinds>` doesn't match concrete handles — the function-parameter check fails. I infer `Kinds` from the covariant `applicableTo: ReadonlySet<Kinds>` field instead. Equivalent semantically, just different inference path.

For the builder method's payload type, I use `Reg[N] extends (payload: infer P) => unknown` (purely callable shape) to extract `P`. Same payload type as before, different inference path.

### Stage 1: `AnnotationsOf<Mw>` constraint loosened to `readonly object[]`

The spec sketch had `Mw extends readonly { annotations?: object }[]`. TypeScript rejects middleware that omit `annotations` against this constraint via the "weak type" rule ("`ObserverMw` has no properties in common with `{ annotations?: object }`"). Loosened the constraint to `readonly object[]` and made the inner conditional treat "no `annotations` field" as the empty contribution. Same observable type for all valid usage.

### Stage 2: introduce `AnyAnnotationHandle` for storage / iteration positions

`RuntimeMiddleware.annotations` and the registry's internal map both want to store handles uniformly. The strict `AnnotationHandle<unknown, OperationKind>` type is unusable here because the callable's `Payload` parameter is contravariant (typed handles aren't structurally assignable to it). Same problem as in stage 1, but now hitting the field type on `RuntimeMiddleware.annotations` directly.

Resolution: add an `AnyAnnotationHandle` type that's maximally widened on the function call signature—`(payload: never) => { __annotation: true }`—so any concrete handle is structurally assignable. The metadata fields use method-shorthand variance for the same reason. Used on the field type, the registry's `register`, and anywhere a handle is iterated en bloc. The strict `AnnotationHandle<P, K>` survives at authoring time and through `AnnotationsOf<Mw>` / `RegistryFor<K, Reg>` consumption.

### Stage 2: pre-existing `sql-runtime` typecheck failures unrelated to this work

`pnpm --filter @prisma-next/sql-runtime typecheck` fails on the cache-middleware-impl baseline (the parent of stage 1) with the same set of errors I see now: missing `invariants` on `ContractMarkerRecord`, missing `parseMarkerRow` on `AdapterProfile`, and a few outdated test fixtures in `sql-runtime/test/*` (incomplete `SqlOperationDescriptor` shape, removed `self` field on operation descriptors, etc.). These are not caused by stages 1 or 2; they're sitting on the branch already.

For the per-stage “does the changeset typecheck” gate I'll require that the framework-components package and stage-specific package(s) typecheck cleanly, and that the broader workspace doesn't regress. I'll flag if a stage adds new errors anywhere outside the existing baseline.

### Stage 2: stage-1 breakage of `cacheAnnotation.apply(...)` cascades into other packages

The plan asserts only stages 4 and 5 produce “user-visible breakage in existing call sites.” That's not quite true: stage 1 already breaks every `cacheAnnotation.apply(...)` call site because the handle is now a callable function and `.apply` resolves to `Function.prototype.apply` (whose signature is `(thisArg, args?)`, not `(payload)`). Affected: `middleware-cache/test/*`, `sql-builder/test/runtime/annotate.test.ts`, `sql-builder/test/playground/annotate.test-d.ts`, `sql-orm-client/test/annotations.test.ts`, demo source files in `examples/prisma-next-demo/src/{queries,orm-client}/*-cached.ts` and the integration tests that reference them.

This isn't fixable in stage 1 without violating its disjoint write scope (stage 1 owns only `framework-components`). The plan's stage 6 sweeps the whole repo for `.apply(` and updates everything, so the breakage is contained to commit boundaries between stage 1 and stage 6.

Decision: continue exactly as the plan sequences — framework-components is green at every commit, downstream packages may be red between stage 1 and the stage that owns them. Stage 4 fixes `sql-builder` tests, stage 5 fixes `middleware-cache` and `sql-orm-client` tests, stage 6 fixes the demo and any straggling docs/examples. The final commit is fully green workspace-wide.

### Stage 3: defer the deep `Registry` generic threading to stage 4

The plan asks stage 3 to thread `Registry` through `Db<TContract, …>`, `OrmClient<TContract, …>`, and the leaf builder types so the postgres facade can project `PostgresClient<TContract, AnnotationsOf<Mw>>`. Threading the generic through every type in the chain (`Db`, `TableProxy`, `WithSelect`, `WithJoin`, `SelectQuery`, `GroupedQuery`, mutation queries, `Collection`, `GroupedCollection`, etc.) is a sweeping refactor whose only consumer is the stage-4 `.annotate(callback)` signature.

For stage 3 I'll do the narrower runtime-only plumbing the acceptance tests actually exercise:

- New `createMetaBuilder(registry, kind)` factory in `framework-components`.
- `BuilderContext.annotationRegistry` (sql-builder) populated from the runtime via `sql({ context, annotationRegistry })`.
- `CollectionContext.annotationRegistry` (sql-orm-client) populated similarly via `orm({ runtime, context, annotationRegistry })`.
- `postgres()` builds the registry from `options.middleware`, capturing `const Mw extends readonly SqlMiddleware[]` so the type tracks the contributions.
- `PostgresClient<TContract, Registry = {}>` carries `Registry` as a phantom field; it is not yet propagated into `Db<TContract>` nor `OrmClient<TContract>`.

Stage 4 will do the deeper threading at the same time as it adds the `.annotate(callback)` signature, which is the first place `Registry` is actually consumed at the type level. That keeps the diff for stage 3 focused on runtime plumbing (matching the runtime acceptance tests in the plan) and stage 4 focused on the type-system widening + DSL surface change.

The “demo's `db.ts` still compiles without any source change” expectation in the plan can't be met regardless because of the stage-1 `.apply` cascade noted above; deferring the `Registry` generic doesn't worsen the situation.

### Stage 3: skip mongo authoring-context plumbing

Mongo does not expose `.annotate()` anywhere today (`grep .annotate packages/2-mongo-family` finds nothing). The runtime side (stage 2) already exposes `runtime.annotationRegistry` for any future consumer; threading the registry into `mongoOrm` / `mongoQuery` would create infrastructure with no consumer. When/if mongo grows a `.annotate()` API, the same SQL-side pattern applies: add an option to `mongoOrm`/`mongoQuery`, default to an empty registry, surface the runtime's registry at the user's call site.

Decision: stage 3 plumbs the registry on the SQL side (where `.annotate()` lives) only. Mongo gets the optional `annotations` field on `MongoMiddleware` via `RuntimeMiddleware` inheritance (already done in stage 2) but no factory-level surface change.

### Stage 6: custom `Collection` subclasses don't get `meta.cache` via the registry-driven callback

The demo's ORM client uses custom `Collection` subclasses (`UserCollection extends Collection<Contract, 'User'>`, `PostCollection`, `TaskCollection`) for convenience methods like `admins()`, `byEmail()`. The `orm()` factory's `ModelCollection<TContract, Collections, ModelName, Registry>` selects the custom class via `CustomCollectionForKey<Collections, ModelName>` when one is registered, falling back to `Collection<TContract, ModelName, InferRootRow<...>, DefaultCollectionTypeState, Registry>` only when no custom class is registered. The custom class is not parameterized by `Registry` — there's no way in TypeScript to project a runtime `Registry` value into a user-defined class's instance type without higher-kinded generics.

Result: `db.User.first(filter, meta => meta.cache(...))` fails with `Property 'cache' does not exist on type 'AnnotationBuilder<"read", {}>'` because the inherited `Collection.first` runs against the subclass's default `Registry = {}`, not the runtime-known `Mw`-derived registry.

Resolution for the demo: use the array escape hatch documented in the spec —

```typescript
import { cacheAnnotation } from '@prisma-next/middleware-cache';

db.User.first(
  { id: toUserId(id) },
  () => [cacheAnnotation({ ttl, skip: options.forceRefresh ?? false })],
);
```

The array form is registry-agnostic; the runtime applicability gate still validates each handle's `applicableTo` set. Spec OQ 4 already names "array escape hatch for ad-hoc / closure-captured handles" — I'm using it because custom-Collection users count as "closure-captured".

Follow-up to flag for the next pass: parameterizing custom `Collection` subclasses by `Registry` is plumbing-heavy and somewhat exotic (it'd require either a higher-kinded `Registry` slot on `Collections` config, or having users author their classes as `class UserCollection<R = {}> extends Collection<..., R>` plus a lookup that calls `new UserCollection<DemoRegistry>(...)` at the factory layer). Worth a dedicated mini-project rather than slipping into stage 6.

The SQL DSL example (`getUsersCached` in `examples/prisma-next-demo/src/queries/get-users-cached.ts`) uses the registry-driven callback form — `db.sql.user.select(...).annotate((meta) => meta.cache({ ttl }))` — because the SQL DSL's `Db<Contract, Registry>` carries the registry generic from `postgres<Contract, Mw>(...)` directly, no custom-Collection layer in the way.

## Final summary

All six stages from `plan.md` shipped on the `cache-middleware-new-api` bookmark. Six commits, one per stage, each with its own scoped diff and a green per-package gate (framework-components throughout, plus the stage-specific package). Per-stage commit summaries:

1. **stage 1 — callable annotation handles + `AnnotationRegistry`.** `framework-components` only.
2. **stage 2 — RuntimeCore aggregates middleware-contributed annotations.** `framework-components` only; SqlMiddleware / MongoMiddleware inherit the field.
3. **stage 3 — plumb the registry into authoring contexts.** `BuilderContext` / `CollectionContext` / `sql()` / `orm()` / `postgres()`. The deeper `Registry` generic threading on `Db<C, Registry>` and the leaf builder types was deferred to stage 4 (where the type-level surface is actually consumed).
4. **stage 4 — SQL DSL `.annotate(callback)`.** `sql-builder` types + impls; `Db<C, Registry>` and the chain of `TableProxy`, `SelectQuery`, `GroupedQuery`, mutation queries, `JoinedTables`, `WithSelect`, `WithJoin`, `LateralBuilder` all gain a `Registry = {}` generic.
5. **stage 5 — Collection terminals + middleware-cache annotation registration.** `Collection` and `GroupedCollection` gain `Registry`; every terminal collapses its variadic-annotations overload into a trailing optional callback. `cacheAnnotation` switches to `name`-based registration; `createCacheMiddleware` declares its `annotations` field. `OrmClient<TContract, Collections, Registry>` carries the new generic; `PostgresClient.orm: OrmClient<TContract, AnnotationsOf<Mw>>` projects it from the postgres facade.
6. **stage 6 — demo, docs, README sweep.** Demo SQL DSL example uses the registry-driven callback; demo ORM examples use the array escape hatch (custom-Collection limitation). Subsystem doc Annotations section rewritten; middleware-cache README rewritten; final `.apply(` / `ValidAnnotations` sweep through `examples/`, `packages/`, `docs/` is clean.

## Open follow-ups for review

Things I'd like to talk through tomorrow:

1. **Custom `Collection` subclasses don't propagate `Registry`** (see the "Stage 6" decision above). The demo sidesteps this with the array escape hatch, which is documented and works correctly, but the ergonomics are worse than the registry-driven `meta.cache(...)` form. A follow-up project could parameterize the `Collections` config map by `Registry`; possibly the cleanest path is to require user-defined custom classes to accept `Registry` as a generic and have the `orm()` factory project through. Worth a dedicated mini-project rather than slipping into this one.
2. **`postgres<Contract>(...)` users have to opt into the `as const` middleware tuple** to get `AnnotationsOf<Mw>` to project. The middleware-cache README and demo `db.ts` both document this. The alternative (drop the explicit `<Contract>` type arg, infer from a `contract: validateContract(...)` value) loses the contract-by-`contractJson` ergonomic. If we want “it just works” with `postgres<Contract>(...)`, we'd need a different inference dance — not obvious how to do it without TypeScript higher-kinded types.
3. **Pre-existing failures untouched.** Across the repo: `model-accessor.ts` has a long-standing `parameter implicitly has an 'any' type` error, `extension-operations.test-d.ts` is broken pre-existing, and `sql-runtime` has unrelated typecheck failures (`marker.ts` / `sql-family-adapter.ts`) and test failures (operation descriptors). I did not touch any of those. `pnpm test:packages` passes 107/110 — the three failing packages (`@prisma-next/adapter-postgres`, `@prisma-next/cli`, `@prisma-next/sql-orm-client`) fail with the same errors on the baseline (verified by stashing onto `cache-middleware-impl` and re-running).
4. **Mongo runtime side intentionally not exposed.** Mongo doesn't expose `.annotate()` anywhere, so plumbing the registry into `mongoOrm` / `mongoQuery` would be infrastructure with no consumer. The runtime side already has `runtime.annotationRegistry` via stage 2 if/when mongo grows an `.annotate()` API.
5. **`DefineAnnotationOptions.namespace` override is documented but un-tested at the lane-terminal layer.** All my tests use the default (`namespace = name`). If a real handle ever wants a different namespace, we should add a lane-side test that the override survives end-to-end. Not blocking.
6. **No `pnpm test:integration` / `pnpm test:e2e` validation.** The plan calls for those after stage 6 against the demo. The integration tests live in `examples/prisma-next-demo/test/repositories.integration.test.ts` and require a live Postgres; I've updated their inline comments but couldn't spin up the database in this environment. The cache integration tests in `middleware-cache/test/` (which use mock executors) all pass.

