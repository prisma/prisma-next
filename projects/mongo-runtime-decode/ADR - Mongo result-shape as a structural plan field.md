# ADR — Mongo result-shape as a structural plan field

> **Status:** Draft (lives under `projects/mongo-runtime-decode/`). Migrate to `docs/architecture docs/adrs/` with a final ADR number at project close-out.

## Context

The Mongo runtime currently yields driver rows verbatim — there is no decode boundary, so codec `decode` is never called. ADR 204 (Single-Path Async Codec Runtime) shipped the encode-side wiring for Mongo and explicitly deferred decode as out of scope, identifying a future Mongo `decodeRow`/`decodeField` mirroring the SQL pattern as the natural plug-in point. This ADR is that follow-up.

The SQL runtime resolves codecs from two `PlanMeta` fields populated by the SQL builder:

- `meta.annotations.codecs[alias]` — per-alias override.
- `meta.projectionTypes[alias]` — alias → fully-qualified codec id.

Both are populated by `buildQueryPlan` in `packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts` and consumed by `decodeRow` in `packages/2-sql/5-runtime/src/codecs/decoding.ts`. The runtime treats every projected alias as a flat top-level cell and uses these maps to dispatch codecs.

Two structural facts shape the Mongo problem differently:

1. **Mongo rows are recursive.** A document can carry sub-documents (value objects), arrays of scalars, arrays of subdocuments (`$lookup` results, embedded relations), and arbitrary nesting. A flat alias→codec map can't describe an array of subdocuments where each subdoc has its own codecs.
2. **`PlanMeta` was originally for cross-cutting plan metadata and lane↔middleware annotations** — i.e. observability tags, lane intent, and other data that doesn't structurally describe what the plan *is*. The codec mapping for a row is structural: it describes the shape of the result the lane is asking for. Putting it on `meta` was a pragmatic seam in SQL; carrying it forward to Mongo would compound that seam at exactly the moment the structure has become genuinely tree-shaped.

## Problem

We need to wire codec decode into the Mongo runtime in a way that:

- Handles recursive row shapes (subdocuments, arrays of subdocs, arrays of scalars) by construction — not as a future bolt-on.
- Honours the existing escape hatches: raw commands and aggregation pipelines whose result shape the lane cannot vouch for must remain pass-through.
- Keeps the runtime ignorant of the contract — the runtime should consume a self-contained description of the row shape, not reach into the contract to look up field types.
- Doesn't compound the `PlanMeta` overload in a domain (Mongo) where the structural problem is now obvious.

## Constraints

- **No SQL changes in this work.** Migrating SQL to a structural seam is a separate decision. Mongo can diverge cleanly because the Mongo runtime currently does no decode at all — we're not breaking parity, we're choosing where the new path lives.
- **ADR 204 invariants must hold**: single-path always-await codec runtime, one `Promise.all` per row (single microtask hop), no public `runtime: 'sync' | 'async'` marker, no conditional return types.
- **Raw commands are an escape hatch.** A raw command must continue to yield rows untouched — the lane has not vouched for any shape and the runtime must not invent one.
- **Cross-family `MongoCodec` shape (ADR 204) is unchanged.** This ADR introduces a per-plan structural carrier; it does not change the codec interface.

## Decision

The Mongo runtime resolves codecs from a new structural field on the plan: `resultShape?: MongoResultShape`, **not** from `meta.annotations` or `meta.projectionTypes`. The field is:

- Optional. When absent, the runtime yields rows verbatim (raw escape hatch).
- Recursive. Documents have field maps, arrays carry an element shape, leaves carry a `codecId`, and an explicit `kind: 'unknown'` represents "the lane vouches for the surrounding shape but cannot vouch for this position".
- Structurally identical to the type-level `DocShape` / `NestedDocShape` / `TypedAggExpr<F>._field` vocabulary the query-builder already threads through pipeline stages.
- Deep-frozen at construction time, mirroring `MongoProjectStage.projection`.

The carrier lives on `MongoQueryPlan` in `packages/2-mongo-family/4-query/query-ast/src/result-shape.ts` and is propagated through lowering on `MongoExecutionPlan` (the runtime's `lower` hook copies it through unchanged — it is structural about the result, not about lowering).

The vocabulary:

```ts
export type MongoResultShape =
  | { readonly kind: 'document'; readonly fields: Readonly<Record<string, MongoFieldShape>> }
  | { readonly kind: 'unknown' };

export type MongoFieldShape =
  | { readonly kind: 'leaf'; readonly codecId: string; readonly nullable: boolean }
  | { readonly kind: 'document'; readonly nullable: boolean;
      readonly fields: Readonly<Record<string, MongoFieldShape>> }
  | { readonly kind: 'array'; readonly nullable: boolean; readonly element: MongoFieldShape }
  | { readonly kind: 'unknown' };
```

`undefined` (no `resultShape` at all) and `kind: 'unknown'` are deliberately distinct:

- **`undefined`**: the lane has not produced a shape. Raw commands.
- **`kind: 'unknown'`**: the lane has produced a shape but vouches for nothing at this specific position. Used by the lane for value-object subtrees, `$lookup` arrays, and shape-rewriting aggregation stages until per-stage value-level shape rebuild lands.

## Responsibilities

| Layer | Responsibility |
|---|---|
| **Lanes** (ORM, query-builder typed-read terminals) | Produce `resultShape` from the contract. Identity-stage pipelines preserve the source shape. Shape-rewriting aggregation stages reify `TypedAggExpr<F>._field` into matching `MongoFieldShape` (deferred; emit `kind: 'unknown'` until then). Raw commands omit `resultShape`. |
| **Adapter** (`MongoAdapter.lower`) | Untouched. Lowering is about the wire command, not the result shape. |
| **Codec registry** (`MongoCodecRegistry`) | Resolves `codecId` → `MongoCodec` at decode time. Same registry instance flows to both adapter (encode) and runtime (decode); the `mongo()` extension constructs one and passes it to both. |
| **Runtime** (`MongoRuntimeImpl.execute`) | Walks `(row, resultShape)` in lockstep, gathers leaf decode tasks with dot-paths, dispatches via one `Promise.all` per row, wraps failures in `RUNTIME.DECODE_FAILED` with `{ collection, path, codec, wirePreview }`. |
| **Driver** | Untouched. Continues to surface BSON-shaped wire values. |

## Why a structural field, not `meta.annotations`

- **Honesty about what's structural.** A field's codec is part of the row's shape, not metadata about the plan. Treating it structurally lets the type system mirror the runtime story (the existing type-level `DocShape` already does this).
- **Recursion is native.** A flat alias→codec map cannot describe an array of subdocuments. Carrying that into `meta` would force a parallel encoding (`'tags.0.title': 'mongo/string@1'`) or a sidecar tree on `meta`. Either is structure-on-meta — better to put structure on its own field.
- **`meta` keeps its job.** `PlanMeta` reverts to cross-cutting metadata and lane↔middleware annotations. Middleware that inspects `meta.annotations` is unaffected; middleware that wants to inspect the result shape inspects `plan.resultShape`.
- **`unknown` is a first-class signal.** `kind: 'unknown'` makes "I don't know" load-bearing. With `meta.projectionTypes`, the absence of an entry means the same thing as the absence of a key, the absence of the whole field, or "haven't gotten to it yet" — three different states collapsed into one. Structural `unknown` is explicit.
- **Lane work is mechanical.** The query-builder already tracks `Shape extends DocShape` at the type level through every pipeline stage. The structural `MongoResultShape` is the value-level mirror of those types; per-stage population is a translation, not a design.

## Why not migrate SQL to the same seam now

SQL has working production decode through `meta.annotations`/`meta.projectionTypes`. That seam survives because SQL rows are structurally flat from the runtime's perspective (one alias per cell; nested JSON aggregates are decoded by a single JSON codec at the leaf). The recursion problem that motivates a structural shape on Mongo doesn't bite SQL today. Migrating SQL would be a behaviour-preserving refactor with no immediate correctness payoff — defer until SQL grows a recursion problem of its own (or until cross-family parity becomes load-bearing for some other reason).

## Consequences

### Positive

- Recursive decode lands by construction; later lane work threading shape through aggregation stages or value-objects is purely additive (replace `unknown` slots with concrete subtrees).
- The runtime never reads the contract — all contract knowledge stays in lanes.
- `meta` is no longer the dumping ground for structural information; future "is this *really* meta?" debates have a cleaner answer.
- Cross-family seam clarification: the runtime's job is the same on both sides (resolve codecs, await, wrap failures). What differs is *where the shape comes from*, and that's now an explicit per-family decision rather than an implicit reuse.

### Negative

- SQL and Mongo now diverge on where codec resolution comes from. A reader looking at one runtime cannot infer the other's pattern by symmetry. Mitigated by this ADR documenting the intentional split and by the runtime invocation pattern (await + `Promise.all`) staying identical.
- Lanes carry a small amount of additional work (build a `MongoResultShape` value alongside the existing type-level `DocShape`). Mostly mechanical translation.
- `kind: 'unknown'` opens a class of "lane forgot to populate" bugs that the SQL pattern hides under "no entry, no decode". Mitigated by always-on integration tests around the headline cases (ObjectId, vector, etc.) and by a future strict-mode check (deferred follow-up).

### Walk-back path

If the structural seam proves heavier than the annotational seam in lane code, the additive path is to:

1. Keep `resultShape` as the canonical structural carrier.
2. Add a small lane helper that constructs `resultShape` from a SQL-style `Record<string, codecId>` map for callers that don't need recursion.

This is non-breaking — the helper produces a `kind: 'document'` shape with leaf entries.

## Examples

### Find with default shape

```ts
// Lane (ORM / query-builder typed read)
const plan: MongoQueryPlan<UserRow> = {
  collection: 'users',
  command: aggregateUsersCommand,
  meta: { target: 'mongo', storageHash, lane: 'mongo-orm', paramDescriptors: [] },
  resultShape: Object.freeze({
    kind: 'document',
    fields: Object.freeze({
      _id:       { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
      name:      { kind: 'leaf', codecId: 'mongo/string@1',   nullable: false },
      email:     { kind: 'leaf', codecId: 'mongo/string@1',   nullable: false },
      bio:       { kind: 'leaf', codecId: 'mongo/string@1',   nullable: true  },
      createdAt: { kind: 'leaf', codecId: 'mongo/date@1',     nullable: false },
      // posts (relation) populated as 'unknown' until include/lookup work lands
      posts:     { kind: 'unknown' },
    }),
  }),
};
```

The runtime walks the row in lockstep with `resultShape`, decodes `_id` to a hex string via `mongoObjectIdCodec`, leaves `posts` untouched.

### Scalar array

A field declared `tags: { codecId: 'mongo/string@1', many: true, nullable: false }` produces:

```ts
tags: {
  kind: 'array',
  nullable: false,
  element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
},
```

The runtime walks each element through the leaf, with paths `tags.0`, `tags.1`, etc. (Mongo dot-notation.)

### Aggregation that rewrites shape (current branch behaviour)

```ts
collection
  .match({ status: 'published' })
  .group({ _id: '$status', total: { $sum: '$views' } })  // shape rewritten
  .build();

// resultShape: { kind: 'unknown' }
```

The lane does have the typed information (`TypedAccumulatorExpr<F>._field`) to thread, but per-stage value-level shape rebuild ships in a follow-up. Until then, `$group` results are pass-through.

### Raw command (escape hatch)

```ts
mongoQuery(contract).rawCommand(new RawAggregateCommand('users', [...]))
// resultShape omitted; rows pass through verbatim.
```

### Decode failure envelope

```ts
// Synthetic codec whose decode throws.
RuntimeError {
  code: 'RUNTIME.DECODE_FAILED',
  message: "Failed to decode field users.address.city with codec 'mongo/string@1': boom",
  details: {
    collection: 'users',
    path: 'address.city',
    codec: 'mongo/string@1',
    wirePreview: 'San Francisco',
  },
  cause: <original Error>,
}
```

## References

- [ADR 204 — Single-Path Async Codec Runtime](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). Defers Mongo decode and constrains the runtime invocation pattern (always-await, one `Promise.all` per row).
- [ADR 030 — Result decoding & codecs registry](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md). Registry model and error-mapping codes (still in force).
- [ADR 027 — Error Envelope Stable Codes](../../docs/architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md). `RUNTIME.DECODE_FAILED` shape.
- SQL reference: `packages/2-sql/5-runtime/src/codecs/decoding.ts` and `packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts`. Used as parity reference for the runtime invocation pattern; structural model deliberately diverges.
- Existing type-level vocabulary: `packages/2-mongo-family/5-query-builders/query-builder/src/{types,resolve-path}.ts` (`DocField`, `DocShape`, `NestedDocShape`, `ObjectField`).
