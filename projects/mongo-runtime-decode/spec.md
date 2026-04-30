# Summary

Mongo runtime currently yields driver rows verbatim — codec `decode` is never called, so `_id` arrives as a `mongo.ObjectId` instance, encryption codecs would silently leak ciphertext, and any non-identity decoder breaks. This project introduces a structural `resultShape` field on `MongoQueryPlan` (recursive: documents, arrays, leaves, unknowns), a recursive `decodeMongoRow` in the runtime, and the registry plumbing required to make the runtime decode authoritatively. Lane population (ORM, query-builder typed reads) lands for the flat top-level case in this branch; nested subdocuments and `$lookup` arrays are wired structurally as `kind: 'unknown'` so the design is complete and follow-ups are pure lane work.

# Description

## Problem

`MongoRuntimeImpl.execute` (`packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`) reads rows from the Mongo driver and yields them straight out. There is no per-row decode loop and no codec registry on the runtime. Today's behaviour:

- `_id` columns return raw `ObjectId` instances rather than the hex string the contract's `mongo/objectId@1` codec promises (`decode: (wire) => wire.toHexString()`).
- Anything written through `mongoVectorCodec` or other identity-decode codecs only "works" by accident.
- An encryption / redaction codec would leak ciphertext or unredacted secrets on read.
- ADR 204 explicitly defers Mongo decode to a follow-up; this is that follow-up.

## Why now

ADR 204 (Single-Path Async Codec Runtime) shipped the encode-side wiring for Mongo and committed to symmetric decode-side work. The codec encode boundary is in production; the matching decode boundary is not. As soon as a codec exists whose driver wire type isn't already its application type, the absence of decode becomes a correctness bug, not an aesthetic one.

## Approach

The SQL runtime resolves codecs from `meta.annotations.codecs` and `meta.projectionTypes`. We do **not** copy that pattern. `meta` was originally for cross-cutting plan metadata and lane↔middleware annotations — codec association is structural, not annotational. Instead:

1. Introduce a structural `resultShape` field on `MongoQueryPlan` (and propagated through `MongoExecutionPlan`). The shape is recursive: documents have field maps, arrays have element shapes, leaves carry `codecId`, and an explicit `kind: 'unknown'` honours lane positions where the row shape can't be vouched for.
2. The runtime walks `(row, resultShape)` in lockstep, dispatches `await codec.decode(...)` per leaf via `Promise.all` per row (matches ADR 204), and wraps failures in `RUNTIME.DECODE_FAILED` with `{ collection, path, codec, wirePreview }`.
3. The `MongoCodecRegistry` is plumbed onto `MongoRuntimeOptions`; the `mongo()` extension constructs one registry and passes it to both `createMongoAdapter(codecs)` and `createMongoRuntime({ codecs, ... })`.
4. Lanes (ORM `compile.ts`, query-builder typed-read terminals) populate `resultShape` from the contract for the flat top-level case in this branch. Subdocuments and `$lookup` arrays use `kind: 'unknown'` until lane follow-ups land.

The recursive structure (`leaf` / `document` / `array` / `unknown`) and decoder land complete in this branch — there is no "shortcut" to walk back. Subsequent lane work just replaces `unknown` nodes with concrete subtrees.

## Users

- ORM and query-builder users on Mongo, who today silently get raw BSON values for any contract field whose codec isn't an identity decoder.
- Future users of encryption / redaction codecs on Mongo, where the absence of decode is a security bug.
- Internal: future lane work (`$lookup` / `include`, value-object subdocs, aggregation pipelines) plugs into a stable structural seam rather than re-litigating "where does codec info live".

## Technology context

- All work in `packages/2-mongo-family/`, `packages/3-mongo-target/`, `packages/3-extensions/mongo/`. No SQL changes.
- Builds on existing `MongoCodec` / `MongoCodecRegistry` (`packages/2-mongo-family/1-foundation/mongo-codec/`) and the default registry constructed in `createMongoAdapter` (`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`).
- The query-builder's existing type-level `NestedDocShape` / `DocField` (`packages/2-mongo-family/5-query-builders/query-builder/src/{types,resolve-path}.ts`) is the model for the runtime `MongoResultShape` value-level vocabulary.

# Requirements

## Functional Requirements

### FR1 — Structural `MongoResultShape` on `MongoQueryPlan`

`MongoQueryPlan<Row, Command>` gains a new optional field `resultShape?: MongoResultShape`, defined in the query-AST package. The vocabulary:

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

`undefined` means "the lane did not produce a shape" (raw commands). `kind: 'unknown'` means "the lane produced a shape but a position within it is opaque" (e.g. `$lookup` array contents, value-object subdocs in this branch's scope).

`MongoExecutionPlan<Row>` carries `resultShape` through lowering unchanged (it is structural about the result, not about lowering).

### FR2 — Recursive `decodeMongoRow`

A new module `packages/2-mongo-family/7-runtime/src/codecs/decoding.ts` exports `decodeMongoRow(row, shape, registry, collection)`:

- Walks `(value, shape)` in lockstep, gathering a flat list of leaf decode tasks with their dot-paths through the document.
- Dispatches all leaf decodes for one row via a single `Promise.all` (single microtask hop, per ADR 204).
- Null/undefined cells short-circuit (no decode call).
- `kind: 'array'` decodes each element in lockstep with `element`. Array indices appear in the path as `field.0.subfield`.
- `kind: 'unknown'` (anywhere in the tree) passes the value through unchanged.
- Unknown `codecId` (no entry in registry) passes the value through unchanged. (Registry-completeness validation is a separate concern, deferred to a follow-up.)
- Failures throw `RUNTIME.DECODE_FAILED` with `{ collection, path, codec, wirePreview }` and `cause` set to the original error. `wirePreview` follows the SQL convention (bounded `String(value).slice(0, 100)`).

### FR3 — Runtime decode integration

`MongoRuntimeImpl.execute` calls `decodeMongoRow` per row, between `driver.execute(...)` and `yield row`, when `plan.resultShape` is present. When `resultShape` is `undefined`, behaviour is unchanged (rows pass through verbatim — the raw escape hatch is preserved).

### FR4 — Codec registry plumbing via the framework execution-stack model

The codec registry is **not** a parameter the user threads through the runtime. It is aggregated by the framework's execution-stack composition machinery, the same way SQL does it.

Concretely:

- **Component descriptors declare their codecs.** Each `RuntimeMongoTargetDescriptor`, `RuntimeMongoAdapterDescriptor`, and `RuntimeMongoExtensionDescriptor` declares its codec contributions via the existing `ComponentMetadata.types.codecTypes.codecInstances` field (already in use control-plane-side; this work mirrors it on the runtime side). The Mongo target descriptor declares the seven scalar wire codecs (`mongo/objectId@1`, `mongo/string@1`, etc.); future extension packs declare their own.
- **`MongoExecutionStack`** is `{ target, adapter, driver?, extensionPacks }`, mirroring `SqlExecutionStack`. Constructed by `createMongoExecutionStack({ target, adapter, driver?, extensionPacks? })`. The stack is the unit the user composes (or that a higher-level extension composes for them).
- **`createMongoExecutionContext({ contract, stack })`** walks the stack contributors (`stack.target`, `stack.adapter`, `...stack.extensionPacks`), folds their `codecInstances` into a single `MongoCodecRegistry`, validates contract↔stack requirements, and returns `{ contract, codecs, stack }`. The `stack` back-reference is retained so the runtime can resolve the adapter via `descriptor.create(stack)` once at construction time without re-threading the stack as a separate parameter. This mirrors SQL's `createExecutionContext` in shape and intent.
- **`MongoRuntimeOptions`** is `{ context, driver, middleware?, mode? }`. There is no `codecs` field, no `adapter` field, no `targetId` field — the context carries the contract, the codec registry, and (transitively, via the stack) the adapter. `MongoRuntimeImpl` reads `context.codecs` for decode and gets the adapter via the stack the context was built from.
- **`mongo()` extension** constructs the stack + the context internally; the user never sees `MongoCodecRegistry`. Direct callers of `createMongoRuntime` (tests, examples) compose a stack and a context once; the resulting one-liner is comparable to the pre-decode shape.
- **No `createDefaultMongoCodecRegistry` export.** That helper was the imperative duplicate of what stack aggregation gives us. It un-exports; users register custom codecs by declaring them on a component descriptor (e.g. their own extension pack), not by mutating a registry imperatively.

This change is **structural** — the Mongo runtime joins the framework's existing target-composition model. The visible payoff at the user surface is removing the codec-registry leak (`createDefaultMongoCodecRegistry` and the threading of one instance through two constructors). The systemic payoff is that future Mongo extension packs get their codecs aggregated automatically, matching SQL's extensibility story.

### FR5 — Lane population

The query-builder already threads `Shape extends DocShape` (and `GroupedDocShape<Spec>`, `ProjectedShape<Shape, Spec>`, `UnwoundShape<S, K>`) through every pipeline stage at the type level. `TypedAggExpr<F>` and `TypedAccumulatorExpr<F>` carry `_field: F` (i.e. `{ codecId, nullable }`) as a runtime property. The value-level `resultShape` is the structural mirror of those types and propagates the same way:

- **Identity stages** (`$match`, `$sort`, `$limit`, `$skip`, `$sample`): pass `resultShape` through unchanged.
- **`$addFields`**: extend `fields` with each new entry's `_field`.
- **`$project`**: rebuild `fields` from the project spec, reading `_field` off each `TypedAggExpr` and copying through `1`-marked passthroughs from the source shape.
- **`$group`**: rebuild `fields` from the group spec; `_id` becomes a leaf or sub-document mirroring the group-id expression's `_field`.
- **`$unwind`**: unwrap the array element of the unwound field (mirrors `UnwoundShape`).
- **`$replaceRoot`**: replace the root with the new root expression's shape.
- **`$lookup`**: add the lookup target field; in this branch the element shape is `kind: 'unknown'` (relation typing is the follow-up).
- **`rawCommand`**: omit `resultShape` (raw is opt-out of decode entirely).

In this branch we ship lane population for the cases that don't require wiring new translation logic — i.e. **typed reads where the result shape is the model's own shape** (find / find-with-`select` / find-with-`include`-relation-as-`unknown` / aggregation pipelines composed of identity stages). Specifically:

- ORM `compile.ts` (`packages/2-mongo-family/5-query-builders/orm/src/compile.ts`) populates `resultShape` for typed reads. Top-level scalar fields from the contract become `{ kind: 'leaf', codecId, nullable }`. Scalar arrays (contract `many: true`, scalar element) become `{ kind: 'array', nullable, element: { kind: 'leaf', codecId, nullable: false } }`. Value-object fields and `include` (relation) fields become `{ kind: 'unknown' }` (the runtime *will* decode these once lane work lands; the structural seam is in place).
- Query-builder typed-read terminals (`packages/2-mongo-family/5-query-builders/query-builder/src/state-classes.ts`) populate `resultShape` for typed reads with the same flat-model shape derivation. Aggregation pipelines composed of identity stages keep the source shape; pipelines containing shape-rebuilding stages (`$project`, `$group`, `$addFields`, `$unwind`, `$replaceRoot`) emit `kind: 'unknown'` for now and gain proper value-level shape rebuilding in follow-up tickets.
- `rawCommand` (`packages/2-mongo-family/5-query-builders/query-builder/src/query.ts`) does not populate `resultShape`.

### FR6 — Error envelope

`RUNTIME.DECODE_FAILED` is thrown with a structured `details` object containing:

- `collection: string` — Mongo collection name
- `path: string` — dot-path to the failing cell (e.g. `'_id'`, `'address.city'`, `'tags.0'`)
- `codec: string` — codec id that threw
- `wirePreview: string` — bounded preview of the wire value (≤ 100 chars)

The original error is attached via `cause`.

## Non-Functional Requirements

- **Per-row dispatch is a single microtask hop** for sync-lifted codecs (ADR 204 guarantee). Verified by construction: one `Promise.all` per row over the collected leaf tasks.
- **No new dependencies** beyond what's already in the Mongo runtime/codec packages.
- **No changes to SQL packages.** This is a Mongo-side correctness fix.
- **Backward compatibility for raw plans**: raw commands continue to pass rows through unchanged. Decoding only kicks in when a lane attaches `resultShape`.
- **Type safety**: `MongoRuntimeOptions.codecs` is required (not optional). Existing call sites are updated, not left to silently default.

## Non-goals

- **Value-level rebuild of `resultShape` through shape-rewriting aggregation stages** (`$project`, `$group`, `$addFields`, `$unwind`, `$replaceRoot`). The runtime supports the structural shapes natively; threading the rebuild from `_field` through each stage at the value level is mechanical work that lands as follow-ups (one per stage, mirroring the existing type-level threading). Until then those terminals emit `kind: 'unknown'` and the runtime passes the row through unchanged.
- **Reifying value-object subdocuments into structural `kind: 'document'` shapes.** The runtime supports it; lane population is deferred.
- **`$lookup` / `include` relation arrays/subdocuments as structural shapes.** Runtime supports it; lane population deferred.
- **Strict-mode codec-registry completeness validation.** SQL's `validateCodecRegistryCompleteness` has no Mongo analog yet. Unknown codec ids cause pass-through, not a hard error. Tracked as a follow-up.
- **Mongo `$jsonSchema` validator integration on the decode side.** Out of scope; that's a separate decode-time validation seam tracked separately.
- **Polymorphic / discriminated-union value resolution.** Treated as `kind: 'unknown'` for this branch.
- **SQL changes.** This branch does not touch the SQL pattern (which uses `meta.annotations.codecs`/`meta.projectionTypes`); SQL parity is not the goal. Migrating SQL to a structural seam is a separate decision and a separate ticket.

# Acceptance Criteria

> ACs originally landed in m1 (decode behaviour, error handling, dispatch, plan structure, integration). The codec-registry-plumbing ACs (AC10, AC11) are amended in m2 and supplemented with new ACs (AC16–AC20) for the execution-stack composition model.

## Decode behaviour

- [ ] **AC1**: A typed find of a collection whose model declares `_id: 'mongo/objectId@1'` returns rows where `row._id` is a hex `string`, not an `ObjectId` instance.
- [ ] **AC2**: A typed find against a model with multiple scalar codecs (string, int, bool, date, objectId) returns each cell decoded by the corresponding codec.
- [ ] **AC3**: A nullable field whose driver value is `null` or `undefined` is yielded as `null`/`undefined` without invoking the codec.
- [ ] **AC4**: A field declared as `many: true` (scalar array) returns the array with each element decoded.
- [ ] **AC5**: Raw commands (`rawCommand`) yield rows unchanged — decoding does not run.
- [ ] **AC6**: A field whose `resultShape` position is `kind: 'unknown'` is yielded unchanged (e.g. value-object subdoc, lookup array in this branch).

## Error handling

- [ ] **AC7**: A codec whose `decode` throws causes the `for await` consumer to receive a thrown `RUNTIME.DECODE_FAILED` envelope with `{ collection, path, codec, wirePreview }` populated and `cause` set to the original error.
- [ ] **AC8**: An unknown `codecId` (registry has no entry) yields the cell verbatim — no throw.

## Runtime / dispatch

- [ ] **AC9**: Per-row decode dispatches all leaf decodes via a single `Promise.all` (asserted by structure / unit test).
- [ ] **AC10** (m2): `MongoRuntimeOptions` does **not** carry a `codecs` field. The runtime reads codecs from the execution context. Construction of a runtime with an explicit `codecs` field is a type-level error.
- [ ] **AC11** (m2): The `mongo()` extension constructs a `MongoExecutionStack` and a `MongoExecutionContext` internally; user-facing options do not mention `MongoCodecRegistry`. `createDefaultMongoCodecRegistry` is no longer exported.

## Plan structure

- [ ] **AC12**: `MongoQueryPlan` and `MongoExecutionPlan` carry `resultShape?: MongoResultShape`.
- [ ] **AC13**: `meta.annotations` and `meta.projectionTypes` are **not** read or written by the Mongo runtime / lanes for codec resolution. Decode is structural only.
- [ ] **AC14**: ORM and query-builder typed-read terminals attach a `resultShape` whose top-level scalar fields carry `codecId` from the contract.

## Integration

- [ ] **AC15**: An end-to-end integration test using `mongodb-memory-server` writes a document, reads it via the runtime with a real contract + registry, and asserts decoded JS values (notably hex `_id`).

## Execution-stack composition (m2)

- [ ] **AC16**: A `MongoExecutionStack` is `{ target, adapter, driver?, extensionPacks }` and is constructed via `createMongoExecutionStack({ ... })`. Each component contributes its codecs via `ComponentMetadata.types.codecTypes.codecInstances` on the descriptor.
- [ ] **AC17**: `createMongoExecutionContext({ contract, stack })` aggregates `codecInstances` across `[stack.target, stack.adapter, ...stack.extensionPacks]` into a single `MongoCodecRegistry` and returns `{ contract, codecs }`. Duplicate codec ids across contributors throw at composition time.
- [ ] **AC18**: `createMongoRuntime({ context, driver, ... })` accepts only the context, the driver, and orthogonal options (middleware, mode). The runtime reads `context.codecs` for decode dispatch and the adapter from `context.stack.adapter` (or equivalent).
- [ ] **AC19**: The Mongo target descriptor (declared via the framework's `RuntimeAdapterDescriptor` machinery) declares the seven Mongo wire-type codecs (`mongo/objectId@1`, `mongo/string@1`, `mongo/double@1`, `mongo/int32@1`, `mongo/bool@1`, `mongo/date@1`, `mongo/vector@1`) on its `codecInstances` field. The runtime registry is constructed from these declarations, not from a hand-rolled `defaultCodecRegistry()` factory.
- [ ] **AC20**: `mongo()` extension users do not see `MongoCodecRegistry` in any public type or parameter. Examples in `examples/mongo-demo` and `examples/retail-store` show no codec-registry construction at the user call site.

# Other Considerations

## Security

The motivating non-correctness case is encryption/redaction codecs. A field whose declared codec is, say, `pg/secret@1`-style with non-identity `decode` would today leak ciphertext to the consumer. With this change in place, registered encryption codecs will run on read by construction. Note: trait-gated redaction of `wirePreview` for codecs carrying a `secret` trait is **not** in scope — tracked under TML-2329 per ADR 204.

## Cost

No runtime cost change for raw plans (no decode dispatch). For typed reads: one `Promise.all` per row over the collected leaf tasks plus one Promise allocation per leaf. ADR 204 documents the trade-off and the future `codecSync()` walk-back path.

## Observability

No new telemetry events; failure envelopes flow through the existing error-handling path. (Future: codec selection per leaf could be added to telemetry tags as ADR 030 envisions for SQL.)

## Data Protection

`wirePreview` in error envelopes is bounded but not redacted. If the failing codec carries plaintext that was about to be decrypted, the preview can include a chunk of that plaintext (or its ciphertext). Same risk profile as the SQL side; redaction follow-up tracked under TML-2329.

# References

- Linear: [TML-2324 — Mongo runtime doesn't apply codec decoders to returned rows](https://linear.app/prisma-company/issue/TML-2324/mongo-runtime-doesnt-apply-codec-decoders-to-returned-rows)
- ADR 204 — Single-Path Async Codec Runtime (`docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md`) — encode-side parity, deferred Mongo decode, single-microtask-hop guarantee.
- ADR 030 — Result decoding & codecs registry (`docs/architecture docs/adrs/ADR 030 - Result decoding & codecs registry.md`) — registry model and error-mapping codes (still in force; runtime-shape sections superseded by ADR 204).
- ADR 027 — Error Envelope Stable Codes — `RUNTIME.DECODE_FAILED` shape.
- SQL reference implementation: `packages/2-sql/5-runtime/src/codecs/decoding.ts` (used as a parity reference, not as a structural model — Mongo deliberately diverges).
- Existing type-level shape vocabulary: `packages/2-mongo-family/5-query-builders/query-builder/src/{types,resolve-path}.ts` (`DocField`, `NestedDocShape`, `ObjectField`).

# Open Questions

_Resolved during shaping. Kept here as a record of decisions:_

- **Aggregation terminals**: shape-rewriting aggregation stages (`$project`, `$group`, `$addFields`, `$unwind`, `$replaceRoot`) emit `{ kind: 'unknown' }` in this branch — the lane does have the typed information (`TypedAggExpr<F>._field`) to thread it, but value-level rebuild logic per stage is deferred to follow-ups so this branch stays scoped. Identity-stage pipelines preserve the source shape.
- **Path notation in error envelopes**: dot-notation for arrays too (`tags.0`, `address.city`).
- **`resultShape` is deep-frozen** at construction time, matching `MongoProjectStage.projection`.
- **`MongoResultShape` lives at** `packages/2-mongo-family/4-query/query-ast/src/result-shape.ts`, exported via `query-ast/src/exports/execution.ts`.
