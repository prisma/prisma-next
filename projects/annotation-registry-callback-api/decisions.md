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

