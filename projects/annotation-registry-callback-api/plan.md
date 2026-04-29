# Plan — Annotation Registry & Callback API

Implements [`spec.md`](./spec.md). Six staged commits, tests-first per `AGENTS.md`. Each stage is independently reviewable; stages 4 and 5 are the only ones that produce user-visible breakage in existing call sites, and they land together with stage 6 (call-site updates) so the demo and integration tests stay green at every commit boundary.

## Sequencing rules

1. Each stage adds tests first, then implementation. Negative type tests live alongside positive type tests.
2. After each stage, `pnpm build`, `pnpm typecheck`, `pnpm test:packages` must pass for affected packages.
3. After stage 6, `pnpm test:integration` and `pnpm test:e2e` against the demo must pass.

## File-write scope by stage

Stages have disjoint write scopes except where noted; this lets stages 1–3 be parallelized if a sub-agent setup makes sense, and isolates stages 4–6 (which all touch lane terminals) so they land sequentially.

| Stage | Primary writes | Notes |
|---|---|---|
| 1 | `framework-components/src/annotations.ts`, new `annotation-registry.ts`, `framework-components/src/exports/runtime.ts`, framework-components tests | Core annotation primitives |
| 2 | `framework-components/src/runtime-middleware.ts`, `framework-components/src/runtime-core.ts`, sql-runtime middleware type, mongo-runtime middleware type, framework-components tests | Middleware SPI + registry assembly |
| 3 | `sql-builder/src/runtime/builder-base.ts`, `sql-orm-client/src/collection.ts` constructor, `sql-runtime/src/runtime.ts` (factory), `mongo-runtime/...`, `postgres/src/runtime/postgres.ts`, plus mongo-target's `mongo()` factory | Plumbing: registry into authoring contexts |
| 4 | `sql-builder/src/runtime/query-impl.ts`, `mutation-impl.ts`, `sql-builder/src/types/{select,grouped,mutation}-query.ts`, sql-builder tests | SQL DSL `.annotate` → callback |
| 5 | `sql-orm-client/src/collection.ts`, sql-orm-client tests, `middleware-cache/src/cache-annotation.ts`, `cache-middleware.ts`, `exports/index.ts`, middleware-cache tests | ORM terminal callback + cache middleware update |
| 6 | `examples/prisma-next-demo/**`, docs in `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`, demo README | Call sites + docs |

---

## Stage 1 — Annotation core: callable handles + registry

**Write scope:** `packages/1-framework/1-core/framework-components/src/annotations.ts`, new `packages/1-framework/1-core/framework-components/src/annotation-registry.ts`, `packages/1-framework/1-core/framework-components/src/exports/runtime.ts`, framework-components tests.

### Tests first

1. `framework-components/test/annotations.test.ts` — rewrite. Cover:
   - `defineAnnotation({ name: 'cache', applicableTo: ['read'] })` returns a function that, when called, produces a branded `AnnotationValue`.
   - `handle.name`, `handle.namespace` (defaults to `name`), `handle.applicableTo` (frozen `ReadonlySet`).
   - `handle.read(plan)` extracts payload by namespace; ignores unbranded values; ignores values stored under the same namespace by a different handle.
   - `namespace` override option works.
   - Repeated calls produce independent frozen `AnnotationValue` instances.
   - No `.apply` member exists on the handle (presence assertion).

2. `framework-components/test/annotations.types.test-d.ts` — rewrite. Cover:
   - `defineAnnotation<P, K>({...})` returns a callable typed `(p: P) => AnnotationValue<P, K>` plus the metadata fields.
   - `RegistryFor<'read', { cache, audit, otel }>` keeps `cache`, drops `audit`, keeps `otel` (read-or-write).
   - `RegistryFor<'write', { cache, audit, otel }>` keeps `audit`, drops `cache`, keeps `otel`.
   - `AnnotationsOf<readonly [{ annotations: { cache } }, { annotations: { audit } }]>` produces `{ cache, audit }`.
   - `AnnotationsOf<readonly []>` produces `{}` (empty registry).
   - `AnnotationBuilder<'read', Reg>` exposes only the kind-applicable methods, each typed `(payload: P) => AnnotationBuilder<'read', Reg>`.

3. New `framework-components/test/annotation-registry.test.ts`:
   - Empty registry; register one handle; re-register the same handle (identity) is a no-op; register a different handle with the same name throws with the documented error message.
   - `entries()` returns a frozen record.

### Implementation

1. Rewrite `annotations.ts`:
   - Replace `AnnotationHandle.apply` with making the handle itself a callable. Use a closure that returns a frozen `AnnotationValue`, then `Object.assign` the metadata fields and `read` method. The resulting function is the handle.
   - Update `DefineAnnotationOptions` to require `name`, optional `namespace` (defaults to `name`), keep `applicableTo`.
   - Remove `ValidAnnotations` and its TSDoc.
   - Keep `AnnotationValue`, `OperationKind`, `assertAnnotationsApplicable` unchanged.
   - Export new symbol `ANNOTATION_BUILDER` (unique symbol, branded).
   - Add `AnnotationBuilder<K, Reg>` and `RegistryFor<K, Reg>` types.
   - Add `AnnotationsOf<Mw>` helper (uses `UnionToIntersection` from utils).

2. New `annotation-registry.ts`:
   - `interface AnnotationRegistry` and `createAnnotationRegistry()` matching the operations-registry shape.
   - Identity-based dedup; collision-on-different-handle throws.

3. Update `exports/runtime.ts`:
   - Export `AnnotationRegistry`, `createAnnotationRegistry`, `AnnotationBuilder`, `RegistryFor`, `AnnotationsOf`, `ANNOTATION_BUILDER`.
   - Keep exporting `AnnotationHandle`, `AnnotationValue`, `OperationKind`, `defineAnnotation`, `assertAnnotationsApplicable`.
   - Remove exports of `ValidAnnotations`.

### Acceptance

- `pnpm --filter @prisma-next/framework-components test` passes.
- `pnpm --filter @prisma-next/framework-components typecheck` passes.
- Negative type tests verifying property-not-found errors live in `annotations.types.test-d.ts`.

---

## Stage 2 — Middleware SPI + `RuntimeCore` registry aggregation

**Write scope:** `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`, `runtime-core.ts`, framework-components tests, sql-runtime + mongo-runtime middleware-interface files (just the `extends` plumbing).

### Tests first

1. `framework-components/test/runtime-core.test.ts` (extend):
   - A `RuntimeCore` subclass constructed with middleware that contribute `annotations` exposes `this.annotationRegistry.entries()` containing the merged set.
   - Two middleware contributing the same handle (identity): registry has one entry.
   - Two middleware contributing different handles with the same `name`: construction throws.
   - Middleware without `annotations`: registry is empty.

2. `framework-components/test/runtime-middleware.types.test-d.ts` (new or extend existing):
   - `RuntimeMiddleware<TPlan>['annotations']` is `Readonly<Record<string, AnnotationHandle<unknown, OperationKind>>> | undefined`.
   - A middleware satisfying `{ name, intercept, annotations: { cache: typeof cacheAnnotation } }` is assignable to `RuntimeMiddleware<MockExec>`.

### Implementation

1. `runtime-middleware.ts`: add optional `annotations` field; update `checkMiddlewareCompatibility` only if needed (likely no change — registry assembly happens elsewhere).

2. `runtime-core.ts`:
   - `RuntimeCore` constructor takes the registry path: walk `options.middleware`, build registry, store on `this.annotationRegistry: AnnotationRegistry`.
   - Subclasses (SQL, Mongo) get the field by inheritance.

3. `sql-runtime/src/sql-middleware.ts` (or wherever `SqlMiddleware` is declared): no change needed — the field flows through the `extends RuntimeMiddleware<…>`.

4. Same for `MongoMiddleware`.

### Acceptance

- Framework-components tests pass.
- `pnpm --filter @prisma-next/sql-runtime typecheck` and `@prisma-next/mongo-runtime typecheck` pass (the `annotations` field is additive and optional, so existing middleware still typechecks).

---

## Stage 3 — Plumb registry into authoring contexts

**Write scope:** `sql-builder/src/runtime/builder-base.ts` (`BuilderContext`), `sql-orm-client/src/collection.ts` constructor + execution context type, `sql-runtime/src/runtime.ts` (or wherever `createRuntime` is wired), `mongo-runtime/...` equivalents, `postgres/src/runtime/postgres.ts`, mongo-target's facade. Plus a small piece in `framework-components` to expose `createMetaBuilder<K>(registry, kind): AnnotationBuilder<K, …>` as a private-ish factory shared by both families.

### Tests first

1. `framework-components/test/meta-builder.test.ts` (new):
   - `createMetaBuilder(registry, 'read')` returns an object with the expected method names and the brand symbol.
   - Calling a method returns a new builder with the brand and `values` array containing the produced `AnnotationValue`.
   - Chained calls accumulate values in order.
   - Methods produce only annotations whose `applicableTo` includes the kind (precondition: registry is unfiltered, the factory does the filter).
   - Builder objects are frozen.

2. `sql-runtime/test/runtime.test.ts` (extend) or new `sql-runtime/test/registry.test.ts`:
   - `createRuntime({ middleware: [m1, m2] })` exposes `runtime.annotationRegistry` (or whatever the public surface is) reflecting the merged registry.

3. `postgres/test/postgres.test.ts` (extend) or new test:
   - `postgres({ middleware: [createCacheMiddleware()] })` produces a client whose lane builder context carries the registry.
   - `postgres({ middleware: [] })` produces a client with an empty registry.

### Implementation

1. New module in `framework-components/src/meta-builder.ts`:
   - `createMetaBuilder(registry: AnnotationRegistry, kind: OperationKind): AnnotationBuilder<typeof kind, ...>`.
   - Precomputes a `methodMap` from `registry.entries()` filtered by kind.
   - Each method body: `(payload) => createNextBuilder([...current.values, handle(payload)])`.
   - Exports from `exports/runtime.ts`.

2. `sql-builder/src/runtime/builder-base.ts`:
   - Add `annotationRegistry: AnnotationRegistry` to `BuilderContext`.

3. `sql-orm-client/src/collection.ts`:
   - Whatever object the constructor receives that wires the runtime into the collection (current name varies — `OrmExecutionContext` or similar) gains `annotationRegistry: AnnotationRegistry`.

4. `sql-runtime/src/runtime.ts`:
   - `createRuntime` builds the registry from `options.middleware ?? []` once, threads it into the SQL builder context and into anything ORM-facing.

5. `mongo-runtime` equivalents: same.

6. `postgres/src/runtime/postgres.ts`:
   - Add `const Mw extends readonly SqlMiddleware[] = readonly []` generic.
   - Project return type to `PostgresClient<TContract, AnnotationsOf<Mw>>`.
   - Pass `Mw` through `Db<TContract, …>` and `OrmClient<TContract, …>` if those types currently take a registry slot (otherwise add it).

7. Same generic surface change to mongo's facade.

### Acceptance

- All packages typecheck.
- New tests pass.
- The demo's `db.ts` still compiles **without** any source change yet — the `.annotate` call sites still use the old surface (stage 4/5 will break those, then stage 6 fixes them).

> **Important sequencing note.** Because stage 3 changes the generic surface of `postgres()`, downstream packages that import `Db<TContract>` / `OrmClient<TContract>` may need an additional registry generic with a sane default. Audit list:
> - `sql-runtime/src/db.ts` (the `Db<TContract>` type)
> - `sql-orm-client/src/orm-client.ts` (the `OrmClient<TContract>` type)
> - `sql-orm-client/src/collection.ts` (the `Collection<…>` type — already heavy with generics; add `Registry` only at the level needed for `.annotate` callbacks)
>
> Add the generic with `= {}` default everywhere it's introduced so existing code that doesn't explicitly pass it continues to compile.

---

## Stage 4 — SQL DSL `.annotate(callback)`

**Write scope:** `packages/2-sql/4-lanes/sql-builder/src/runtime/query-impl.ts`, `mutation-impl.ts`, `packages/2-sql/4-lanes/sql-builder/src/types/{select,grouped,mutation}-query.ts`, sql-builder tests.

This stage **breaks the old call sites**; stage 6 fixes them. Land 4 + 5 + 6 together (or as a single PR with three commits).

### Tests first

1. `sql-builder/test/playground/annotate.test-d.ts` — rewrite:
   - Positive: `.annotate(meta => meta.cache({ ttl: 60 }))` on each builder kind that should accept it.
   - Positive: chaining: `.annotate(meta => meta.cache({ ttl: 60 }).otel({ traceId }))`.
   - Positive: array escape hatch: `.annotate(meta => [meta.cache({ ttl: 60 })])` and with closure-captured handles.
   - Negative: `.annotate(meta => meta.cache(...))` on a write builder fails with property-not-found (`@ts-expect-error - 'cache' does not exist on AnnotationBuilder<'write', …>`).
   - Negative: `.annotate(meta => meta.audit(...))` on a read builder fails likewise.
   - Row type preservation across `.annotate` calls (existing test cases adapted).

2. `sql-builder/test/runtime/annotate.test.ts` (extend or new):
   - Builder closure called with the right kind.
   - Multiple `.annotate(...)` calls compose (last-write-wins per namespace).
   - Array form: applicability gate fires at runtime if a closure-captured write-only handle is smuggled to a read terminal via the array.
   - Cast-bypass: a `as` cast that produces a wrong-kind builder still throws at the lane runtime gate.

### Implementation

1. `query-impl.ts` — `QueryBase.annotate`:
   ```typescript
   annotate(
     fn: (meta: AnnotationBuilder<'read', Registry>) =>
       | AnnotationBuilder<'read', Registry>
       | readonly AnnotationValue<unknown, OperationKind>[],
   ): this {
     const meta = createMetaBuilder(this.ctx.annotationRegistry, 'read');
     const result = fn(meta);
     const values = isAnnotationBuilder(result) ? result.values : result;
     assertAnnotationsApplicable(values, 'read', 'sql-dsl.annotate');
     // existing merge-into-userAnnotations logic
   }
   ```

2. `mutation-impl.ts` — same shape with `'write'` for Insert/Update/Delete.

3. Public interface files: replace `annotate<As extends …>(...annotations: As & ValidAnnotations<…>): …` with the new signature.

4. Delete `mergeWriteAnnotations`'s variadic-array path; replace with a single normalized array.

### Acceptance

- All sql-builder tests pass.
- Type tests cover positive and negative cases.
- Demo's `get-users-cached.ts` compiles after stage 6 fixes the call site.

---

## Stage 5 — ORM Collection terminals + `middleware-cache`

**Write scope:** `packages/3-extensions/sql-orm-client/src/collection.ts`, sql-orm-client tests, `packages/3-extensions/middleware-cache/src/cache-annotation.ts`, `cache-middleware.ts`, `exports/index.ts`, middleware-cache tests.

### Tests first

1. `sql-orm-client/test/collection-annotate.test-d.ts` (new or extend existing):
   - Positive: `db.User.first({ id }, meta => meta.cache({ ttl: 60 }))`.
   - Positive: read terminals — `all`, `first`, `find`, `count` (if present), aggregates — accept the read callback.
   - Positive: write terminals — `create`, `createAll`, `update`, `updateAll`, `delete`, `deleteAll`, `upsert`, `createCount` — accept the write callback.
   - Negative: write callback on a read terminal (property-not-found via `@ts-expect-error`).
   - Negative: read callback on a write terminal.
   - Callback is the trailing argument; positional args before it preserved.

2. `sql-orm-client/test/collection-annotate.test.ts` (new or extend):
   - Runtime: callback executed with the registry-derived builder; `values` carry the produced `AnnotationValue`s.
   - Cast-bypass throws.
   - The aggregate post-wrap path still works.
   - The `createAll` / `deleteAll` path that compiles to multiple statements still rejects mismatched-kind annotations at the runtime gate.

3. `middleware-cache/test/cache-annotation.test.ts` — rewrite:
   - `cacheAnnotation({ ttl: 60 })` returns a branded `AnnotationValue` (the new callable form).
   - `cacheAnnotation.read(plan)` semantics unchanged.

4. `middleware-cache/test/cache-annotation.types.test-d.ts` — rewrite:
   - `cacheAnnotation` is callable, has `name`, `namespace`, `applicableTo`, `read`.
   - `createCacheMiddleware().annotations.cache` is `typeof cacheAnnotation`.

### Implementation

1. `sql-orm-client/src/collection.ts`:
   - Each terminal that previously took `...annotations: As & ValidAnnotations<K, As>` now takes a single optional trailing parameter:
     ```typescript
     async first(
       filter?: WhereInput,
       annotateFn?: (meta: AnnotationBuilder<'read', Registry>) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
     ): Promise<Row | null>;
     ```
   - Overload signatures collapse: drop the variadic; the callback is a single optional trailing argument.
   - Internal helper `#buildAnnotations(annotateFn, kind, terminalName)`: invoke callback, normalize, assert applicability, return `Map<namespace, AnnotationValue>`.
   - Read state-driven path (`all`, `first`, `find`): merges into `state.userAnnotations`.
   - Post-wrap path (aggregates, write terminals): merges into the compiled plan via `mergeUserAnnotations`.

2. `middleware-cache/src/cache-annotation.ts`:
   - Update to `defineAnnotation<CachePayload, 'read'>({ name: 'cache', applicableTo: ['read'] })`.

3. `middleware-cache/src/cache-middleware.ts`:
   - `createCacheMiddleware` returns an object with `annotations: { cache: cacheAnnotation }`. Use a `satisfies` clause that exposes the `annotations` field in the inferred return type so factory generics on `postgres()` see it.
   - Reading inside `intercept` / `afterExecute` continues to use `cacheAnnotation.read(plan)`.

4. `middleware-cache/src/exports/index.ts`:
   - Continues exporting `cacheAnnotation` (escape hatch) and `createCacheMiddleware`.

### Acceptance

- ORM collection tests pass (including the property-not-found negative tests).
- Middleware-cache unit tests pass.
- Demo integration tests in `examples/prisma-next-demo/test/repositories.integration.test.ts` compile after stage 6 fixes their call sites.

---

## Stage 6 — Update call sites, examples, docs

**Write scope:** `examples/prisma-next-demo/**`, `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`, `examples/prisma-next-demo/README.md`, miscellaneous TSDoc references in `framework-components/src/annotations.ts` and elsewhere.

### Files to update

1. `examples/prisma-next-demo/src/queries/get-users-cached.ts`:
   ```typescript
   const plan = db.sql.user
     .select('id', 'email', 'createdAt', 'kind')
     .annotate(meta => meta.cache({ ttl: ttlMs }))
     .build();
   ```
   Drop the `import { cacheAnnotation }` import; the registry-derived callback discovers it.

2. `examples/prisma-next-demo/src/orm-client/find-user-by-id-cached.ts`:
   ```typescript
   return db.User.first(
     { id: toUserId(id) },
     meta => meta.cache({ ttl, skip: options.forceRefresh ?? false }),
   );
   ```

3. `examples/prisma-next-demo/src/orm-client/get-users-cached.ts`:
   ```typescript
   return db.User.take(limit).all(
     meta => meta.cache(
       options.key !== undefined ? { ttl, key: options.key } : { ttl },
     ),
   );
   ```

4. `examples/prisma-next-demo/test/repositories.integration.test.ts` — refresh the comments and any inline `cacheAnnotation.apply(...)` references in test bodies.

5. `examples/prisma-next-demo/README.md` "Cache Middleware Examples" section:
   - Update the SQL DSL snippet.
   - Update the prose around `.annotate(...)` and how the registry is assembled.

6. `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`:
   - "Annotations" section: rewrite the `defineAnnotation` paragraph to show callable form, the registry, and the callback-driven `.annotate`.
   - Replace every `As & ValidAnnotations<K, As>` reference with the new structural-filter narrative.
   - Remove the "Why `As & ValidAnnotations<K, As>` and not `ValidAnnotations<K, As>` alone" paragraph entirely; it no longer applies.
   - Update the testing-strategy bullet to point at the new test file names.

7. `framework-components/src/annotations.ts` TSDoc:
   - The `defineAnnotation` example block.
   - Remove all `apply` references.
   - Add a note that the handle is callable.

8. Rules and onboarding docs:
   - `grep -rn "cacheAnnotation.apply\|\.apply({\|ValidAnnotations" docs/ examples/ packages/`
   - Refresh anything that surfaces.

### Acceptance

- `pnpm test:packages` green.
- `pnpm test:integration` green against the demo (cache-hit, cache-miss, force-refresh, key override, transaction-scope guard).
- `pnpm test:e2e` green if applicable.
- `pnpm build` green across the workspace.
- Final `grep` pass: zero references to `.apply(` on annotation handles, zero references to `ValidAnnotations` outside this project's docs.

---

## Out of scope (deferred)

These were considered but deliberately not folded in:

1. **Annotations without middleware.** Spec rejected. Could be added later if a real use case emerges (plan introspection, contract metadata, etc.).

2. **Dynamic registry mutation at runtime.** Today the registry is fixed at runtime construction. Hot-reload / per-request registry overrides are not in scope.

3. **Annotation discovery via reflection at runtime.** Tooling that wants to enumerate the registry can do so via `runtime.annotationRegistry.entries()`, but that surface isn't mentioned in any user-facing doc until a tooling consumer needs it.

4. **Middleware-pack annotations.** Extension packs (`extension-pgvector`, etc.) could theoretically contribute annotations through their middleware. The plumbing supports it (extensions register middleware first), but no current extension owns annotations. If pgvector ever wants `meta.vectorIndex({ index: 'ivfflat' })`, it can add `annotations` to whichever middleware it ships.

5. **Finer-grained operation kinds.** Still binary (`'read' | 'write'`). Unchanged from the current design.

## Linear ticket

Link this project to the existing TML-2143 epic or open a successor. Recommend the latter — TML-2143 was scoped to "ship intercept + cache." This is a polish pass on the authoring API, distinct work, distinct stop condition.

## Stop condition

The April demo runs identically to today, but every cached query is authored as `.annotate(meta => meta.cache({ ttl }))` (or the equivalent callback on an ORM terminal). No source file in `examples/`, `packages/`, or `docs/` references `.apply(` on an annotation handle or imports `ValidAnnotations`.
