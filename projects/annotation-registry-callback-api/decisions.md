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

