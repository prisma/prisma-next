# Summary

Replace the current "import an annotation handle, call `.apply(...)`, pass it as a variadic argument" surface with a registry-driven, callback-based authoring API. Annotations register through the middleware that reads them. Lane terminals expose a `.annotate(callback)` method whose argument is a kind-filtered, chainable annotation builder derived from the registry. The runtime applicability gate becomes structural — if a middleware isn't enabled, its annotations don't exist on the call site. `.apply(...)` and the `ValidAnnotations<K, As>` intersection trick both go away.

# Description

The shipped annotation API ([projects/middleware-intercept-and-cache](../middleware-intercept-and-cache/spec.md), TML-2143) achieves type safety and applicability gating through a tuple-intersection type:

```typescript
annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
  ...annotations: As & ValidAnnotations<'read', As>
): this
```

It works, but the surface has friction:

1. **Per-call import ceremony.** Every call site imports `cacheAnnotation` (or whatever) and calls `cacheAnnotation.apply({ ttl })`. Two-step ceremony for one logical operation.
2. **No discoverability.** Users don't know which annotations a runtime accepts without grepping the docs of every middleware they enabled.
3. **No enforced consumer pairing.** A user can `defineAnnotation(...)` and pass it to `.annotate(...)` even when no middleware reads it. The annotation lands silently in `plan.meta.annotations` and does nothing.
4. **Complicated typing.** `As & ValidAnnotations<K, As>` is load-bearing in a way that shows up in error messages and requires an explanatory comment everywhere it appears.
5. **Not extensible to "list available annotations".** Tooling that wants to enumerate the annotations a runtime accepts has nowhere to read them from.

The new design moves the source of truth to a registry assembled from the runtime's middleware list, mirroring how `OperationRegistry` is assembled. Lane terminals consume the registry via a callback so the resulting type narrows automatically to the kind-applicable subset.

# Before / After

## Defining an annotation

**Before** — a handle with a `.apply(...)` method:
```typescript
import { defineAnnotation } from '@prisma-next/framework-components/runtime';

export const cacheAnnotation = defineAnnotation<CachePayload, 'read'>({
  namespace: 'cache',
  applicableTo: ['read'],
});
```

**After** — the handle becomes a callable; an additional `name` field identifies it in the registry:
```typescript
import { defineAnnotation } from '@prisma-next/framework-components/runtime';

export const cacheAnnotation = defineAnnotation<CachePayload, 'read'>({
  name: 'cache',                  // registry key; also default namespace
  applicableTo: ['read'],
  // namespace?: string,          // optional override; defaults to `name`
});

// Calling the handle creates an AnnotationValue. No more `.apply`.
const value = cacheAnnotation({ ttl: 60 });
```

`read` semantics (`cacheAnnotation.read(plan): Payload | undefined`) are unchanged.

## Registering annotations through middleware

**Before** — annotations exist independently of middleware:
```typescript
export function createCacheMiddleware(): SqlMiddleware {
  return { name: 'cache', intercept, onRow, afterExecute };
}
```

**After** — middleware declares the annotations it owns; the runtime aggregates them into a registry:
```typescript
export function createCacheMiddleware() {
  return {
    name: 'cache',
    annotations: { cache: cacheAnnotation },   // <-- NEW
    intercept,
    onRow,
    afterExecute,
  } satisfies RuntimeMiddleware & {
    annotations: { readonly cache: typeof cacheAnnotation };
  };
}
```

`RuntimeMiddleware` gains an optional `annotations?: Readonly<Record<string, AnnotationHandle<unknown, OperationKind>>>` field. Middleware that own no annotations (telemetry, lints, budgets) omit it.

## Authoring a query

**Before** — handle import + variadic argument; `.apply(...)`:
```typescript
import { cacheAnnotation } from '@prisma-next/middleware-cache';

const plan = db.sql.user
  .select('id', 'email')
  .annotate(cacheAnnotation.apply({ ttl: 60 }))
  .build();

const user = await db.User.first({ id }, cacheAnnotation.apply({ ttl: 60 }));
```

**After** — chainable builder closure derived from the runtime's registry:
```typescript
const plan = db.sql.user
  .select('id', 'email')
  .annotate(meta => meta.cache({ ttl: 60 }))
  .build();

const user = await db.User.first({ id }, meta => meta.cache({ ttl: 60 }));

// Multiple annotations chain:
.annotate(meta => meta.cache({ ttl: 60 }).otel({ traceId }))

// Array escape hatch for ad-hoc / closure-captured handles:
.annotate(meta => [meta.cache({ ttl: 60 }), customHandle({ x: 1 })])

// Applicability is enforced structurally — `cache` simply doesn't exist on
// the write-builder's `meta`. No "does not satisfy ValidAnnotations" error
// chain; it's a property-not-found error from the type system.
db.User.create(input, meta => meta.cache({ ttl: 60 }));
//                          ~~~~~~~~~~ Property 'cache' does not exist on type
//                                     AnnotationBuilder<'write', { audit: ... }>.
```

# Goals

- Drop `.apply(...)` from the public surface. Handles become callable.
- Move the source of truth for "which annotations does this runtime accept" into a registry assembled from middleware.
- Ship a chainable builder for the `.annotate(callback)` argument so multiple annotations compose without spread or array boilerplate.
- Keep the runtime applicability gate (`assertAnnotationsApplicable`) as belt-and-suspenders for cast-bypass cases. The type-level gate becomes structural property access.
- No backward-compat shims. Per `AGENTS.md`, update call sites instead.

# Non-goals

- **No new annotation semantics.** Storage under `plan.meta.annotations[namespace]`, last-write-wins on duplicate namespaces, brand-checked `read`, reserved-namespace policy — all unchanged.
- **No new operation-kind taxonomy.** `'read' | 'write'` stays the binary; the deferred finer-grained split (`'select' | 'insert' | 'update' | 'delete' | 'upsert'`) is still deferred.
- **No invalidation, no scope-aware cache semantics.** That work belongs to the May milestone tracked in TML-2143.
- **No registry beyond middleware.** Users cannot register annotations that no middleware reads. (See [Open Questions](#open-questions) for why.)
- **No automatic re-export of middleware-owned handles.** Users importing `cacheAnnotation` directly is still supported (escape hatch / tests / power use), but the mainline path is the registry callback.

# Requirements

## Functional Requirements

### Annotation core (`@prisma-next/framework-components`)

1. **`defineAnnotation` returns a callable handle.** Signature:
   ```typescript
   defineAnnotation<Payload, Kinds extends OperationKind>(options: {
     readonly name: string;
     readonly applicableTo: readonly Kinds[];
     readonly namespace?: string;     // defaults to `name`
   }): AnnotationHandle<Payload, Kinds>;

   type AnnotationHandle<P, K extends OperationKind> =
     ((value: P) => AnnotationValue<P, K>)
     & {
       readonly name: string;
       readonly namespace: string;
       readonly applicableTo: ReadonlySet<K>;
       read(plan: { readonly meta: { readonly annotations?: Record<string, unknown> } }): P | undefined;
     };
   ```
   The handle is a function plus attached metadata. Calling it produces a branded `AnnotationValue` (same brand-stamping as today). `read` semantics are unchanged.

2. **`.apply(...)` is removed.** Per `AGENTS.md`, no compatibility shims.

3. **`ValidAnnotations<K, As>` is removed** along with all references in TSDoc and tests. The structural registry filter replaces it.

4. **`AnnotationRegistry`.** Mirrors `OperationRegistry`:
   ```typescript
   interface AnnotationRegistry {
     register(handle: AnnotationHandle<unknown, OperationKind>): void;
     entries(): Readonly<Record<string, AnnotationHandle<unknown, OperationKind>>>;
   }
   function createAnnotationRegistry(): AnnotationRegistry;
   ```
   Registration is by `handle.name`. Re-registering the **same handle by identity** is a silent no-op (so two middleware can both list the same handle without error). Registering a **different handle** under a name already in use throws (`'Annotation "<name>" is already registered with a different handle'`).

5. **Builder brand.** A unique symbol (e.g. `ANNOTATION_BUILDER`) marks objects produced by the chainable callback so the framework can extract values without confusing them with arrays of `AnnotationValue`.

### Middleware SPI

1. **Optional `annotations` field on `RuntimeMiddleware`.**
   ```typescript
   interface RuntimeMiddleware<TPlan extends QueryPlan = QueryPlan> {
     readonly name: string;
     readonly familyId?: string;
     readonly targetId?: string;
     readonly annotations?: Readonly<Record<string, AnnotationHandle<unknown, OperationKind>>>;  // NEW
     intercept?(...): Promise<InterceptResult | undefined>;
     beforeExecute?(...): Promise<void>;
     onRow?(...): Promise<void>;
     afterExecute?(...): Promise<void>;
   }
   ```
   `SqlMiddleware`, `MongoMiddleware` inherit the field through their `extends` of `RuntimeMiddleware`.

2. **`RuntimeCore` aggregates the registry.** At construction, `RuntimeCore` walks `options.middleware`, calls `registry.register(handle)` for each entry of each middleware's `annotations`, and exposes the result as `this.annotationRegistry: AnnotationRegistry`.

### Type-level registry derivation

1. **`AnnotationsOf<Mw>` flattens a middleware tuple to its merged registry shape.** Internal helper used by family factory generics:
   ```typescript
   type AnnotationsOf<Mw extends readonly { annotations?: object }[]> =
     UnionToIntersection<NonNullable<Mw[number]['annotations']>>;
   ```

2. **`RegistryFor<K, Reg>` filters a registry to a single operation kind.**
   ```typescript
   type RegistryFor<K extends OperationKind, Reg> = {
     readonly [N in keyof Reg as Reg[N] extends AnnotationHandle<unknown, infer Kinds>
       ? K extends Kinds ? N : never
       : never
     ]: Reg[N];
   };
   ```
   This is the type the lane callback's parameter is derived from.

3. **`AnnotationBuilder<K, Reg>` is the chainable surface.** Each registered annotation handle becomes a method whose return is another `AnnotationBuilder<K, Reg>` carrying the accumulated values:
   ```typescript
   type AnnotationBuilder<K extends OperationKind, Reg> =
     {
       readonly [N in keyof RegistryFor<K, Reg>]:
         RegistryFor<K, Reg>[N] extends AnnotationHandle<infer P, OperationKind>
           ? (payload: P) => AnnotationBuilder<K, Reg>
           : never;
     }
     & {
       readonly [ANNOTATION_BUILDER]: true;
       readonly values: readonly AnnotationValue<unknown, OperationKind>[];
     };
   ```
   The `values` field is the framework's extraction point. The brand symbol distinguishes builder objects from arrays.

### Lane terminal API

1. **SQL DSL `.annotate(callback)`.** Replace the variadic with a single callback. Read builders (`SelectQueryImpl`, `GroupedQueryImpl`):
   ```typescript
   annotate(
     fn: (meta: AnnotationBuilder<'read', Registry>) =>
       | AnnotationBuilder<'read', Registry>
       | readonly AnnotationValue<unknown, OperationKind>[],
   ): this;
   ```
   Write builders (`InsertQueryImpl`, `UpdateQueryImpl`, `DeleteQueryImpl`) take `'write'`. Multiple `.annotate(...)` calls still compose; duplicate namespaces still last-write-win.

2. **ORM terminal callback.** Each `Collection` terminal that previously took `...annotations: As & ValidAnnotations<K, As>` now takes a single optional trailing `annotateFn?: (meta: AnnotationBuilder<K, Registry>) => …`. Overload signatures collapse from "args + N variadic annotations" to "args + optional callback". There is no chainable `Collection.annotate()` (intentional scope cut, unchanged from current design).

3. **Callback return normalization.** At each terminal, the framework runs the callback against a fresh root `AnnotationBuilder` seeded with `[]`. The return value is normalized:
   - If branded as `AnnotationBuilder` (carries the `ANNOTATION_BUILDER` symbol), use its `values`.
   - If a `ReadonlyArray<AnnotationValue>`, use as-is.
   - Otherwise reject with `RUNTIME.ANNOTATION_CALLBACK_INVALID` (clear error: "expected the meta builder or a readonly array of AnnotationValues").

4. **Runtime applicability gate.** `assertAnnotationsApplicable(values, kind, terminalName)` runs after normalization, before plan construction. The structural type filter prevents the hot path; the runtime gate is the cast-bypass guarantor.

5. **Callback-less form removed.** `.annotate()` (zero args) and the variadic-spread form both go away. The "no annotations" case is "don't call `.annotate`."

### Runtime plumbing

1. **Builder context carries the registry.** `BuilderContext` (sql-builder), `OrmExecutionContext` (sql-orm-client), and equivalents on the Mongo side gain `annotationRegistry: AnnotationRegistry`. The SQL family factory (`createRuntime` in `sql-runtime`) and Mongo family factory (`createMongoRuntime`) build the registry from middleware once and thread it into both the lane builder context and the ORM execution context.

2. **Registry-derived builder factory.** From a registered handle map, the runtime constructs a `createMetaBuilder<K>(): AnnotationBuilder<K, Registry>` by closure. Each method's body does:
   ```typescript
   const next = [...this.values, handle(payload)];
   return Object.freeze({ ...methodMap, [ANNOTATION_BUILDER]: true, values: next });
   ```
   `methodMap` is precomputed once per kind at runtime construction. The lane terminal calls `createMetaBuilder('read')` (or `'write'`) for each `.annotate(callback)` invocation.

3. **`postgres()` / `createMongoRuntime` generic surface.** Capture `Mw` via a `const` generic parameter, project to the registry shape in the resulting client type:
   ```typescript
   function postgres<
     TContract extends Contract<SqlStorage>,
     const Mw extends readonly SqlMiddleware[] = readonly [],
   >(
     options: PostgresOptions<TContract> & { middleware?: Mw },
   ): PostgresClient<TContract, AnnotationsOf<Mw>>;
   ```
   `Mw` is internal scaffolding; the client and its ORM/SQL surfaces carry only `Registry = AnnotationsOf<Mw>` so error messages and TSDoc stay readable.

4. **Extension-contributed middleware.** Extensions like `pgvector` may contribute middleware that own annotations. Extension-supplied middleware register first; user-supplied middleware register after. Collisions follow the same rule (same handle by identity = no-op; different handle, same name = throw).

### `middleware-cache`

1. **`cacheAnnotation` becomes callable.** `name: 'cache'`, default namespace, same payload shape.
2. **`createCacheMiddleware`** declares `annotations: { cache: cacheAnnotation }`.
3. **Reading inside the middleware** still uses `cacheAnnotation.read(plan)` (unchanged).
4. **Direct export of `cacheAnnotation`** is preserved as the escape hatch for tests, ad-hoc usage, and array-form `.annotate(...)` calls.

## Non-Functional Requirements

1. **No `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`.**
2. **No new `as unknown as` casts** beyond the brand check at the framework's normalization point. Each cast is accompanied by a TSDoc explaining why.
3. **Existing test coverage is preserved or replaced with equivalent coverage.** Type tests, runtime tests, integration tests for cache hit/miss continue to pass.
4. **Public exports stay narrow.** `AnnotationRegistry`, `RegistryFor`, `AnnotationsOf`, `AnnotationBuilder`, `ANNOTATION_BUILDER` exported from `@prisma-next/framework-components/runtime`. The internal `createMetaBuilder` factory stays private to family runtimes.

# Open Questions

1. **Should annotations register independently of middleware?** Decided: no. Tying registration to middleware enforces "if you can write it, something reads it." Letting users register an annotation without a consumer is a silent-no-op footgun.

2. **`name` vs. `namespace`.** Default `namespace = name`. Override only when a real conflict shows up (none today). Documenting the override in `defineAnnotation`'s TSDoc is enough.

3. **Two middleware contributing the same annotation.** Resolved by identity: same handle reference = silent no-op; different handle, same name = throw at runtime construction. (See `AnnotationRegistry.register`.)

4. **Builder brand mechanic.** Symbol-keyed brand is the simplest path. Alternative: make the builder iterable via `Symbol.iterator` over its `values`. Both work; symbol brand is closer to the existing `__annotation: true` pattern. Going with symbol brand for consistency.

5. **Single-value return from the callback.** Folded into the chainable builder: `meta => meta.cache({ ttl })` returns a one-element builder, which the framework normalizes the same way as longer chains. No separate "single value" code path.

# Acceptance Criteria

1. **Authoring is callback-driven.** `.annotate(meta => meta.cache({ ttl: 60 }))` works on every SQL DSL builder kind and every ORM terminal that previously accepted annotations. `.apply(...)` and the variadic form do not exist.

2. **Type filtering is structural.** Calling `meta.cache(...)` on a write terminal is a property-not-found error from the type system, with no `ValidAnnotations` chain. Negative type tests assert this for both kinds and for both-kind handles.

3. **Chained calls compose.** `meta => meta.cache({ ttl: 60 }).otel({ traceId })` accumulates both values in registration order; both reach `plan.meta.annotations`.

4. **Array escape hatch works.** `meta => [meta.cache({ ttl: 60 }), externalHandle({ x: 1 })]` accepts external handles that aren't part of the registry. Runtime applicability gate still validates them.

5. **Registry assembly works across middleware.** A runtime configured with `[createCacheMiddleware(), createTelemetryMiddleware()]` exposes `meta.cache` (read terminals) but no `meta.audit` (no audit middleware). Adding a hypothetical `createAuditMiddleware()` makes `meta.audit` appear on write terminals automatically.

6. **Cast-bypass still throws.** A test that bypasses the type filter (via `as` or `any`) and produces a write-only annotation on a read terminal continues to throw `RUNTIME.ANNOTATION_INAPPLICABLE` from the lane runtime gate.

7. **Cache middleware integration tests** (the April stop condition) continue to pass against the new authoring surface — same hit/miss/skip/transaction-scope semantics.

8. **Documentation updated.** `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` "Annotations" section, `examples/prisma-next-demo/README.md` "Cache Middleware Examples" section, and the cached-query examples in `examples/prisma-next-demo/src/` reflect the new surface. No stale references to `.apply` or `ValidAnnotations`.

# Risks

1. **Type-system performance.** Mapped types over the merged middleware registry add work to every `.annotate` call site. Mitigation: keep `RegistryFor` and `AnnotationBuilder` shallow; avoid recursive conditional types beyond the existing `Kinds extends K` filter. Validate by running `pnpm typecheck` against the demo before/after and comparing wall-clock.

2. **`Mw` capture via `const` generic.** Requires TypeScript ≥ 5.0 (already required). Edge case: users who pass `middleware: someVariable` (not a literal) lose the literal-tuple inference, and `Registry` widens to `{}`. Documented; mitigated by encouraging inline literals or `as const satisfies`.

3. **Builder allocation on every `.annotate(...)` call.** Each call constructs a fresh root builder; chained calls construct intermediate frozen objects. For SQL DSL this is per-build, not per-execution; not a hot path. For ORM terminals it's per-terminal-call; still acceptable. Validated by integration tests' wall-clock not regressing measurably.

4. **Extension-contributed annotations conflicting with user-contributed annotations.** Resolution rule (identity-based dedup, name-collision throw) is documented; tests cover both branches.

5. **Stale examples / docs scattered through the repo.** Wide grep pass at the end. The plan calls out a specific file list in [Stage 6](plan.md#stage-6-update-call-sites-examples-docs).
