# Mongo Runtime Decode

## Summary

Wire Mongo runtime to apply codec decoders to driver rows by introducing a structural `resultShape` field on `MongoQueryPlan` (recursive: documents, arrays, leaves, unknowns), a recursive `decodeMongoRow` in the runtime, and the codec-registry plumbing required to make the runtime decode authoritatively. Lane population for the flat top-level case ships in this branch; shape rebuild through aggregation stages and value-object/relation subtrees are tracked as follow-ups.

**Spec:** `projects/mongo-runtime-decode/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives execution |
| Reviewer | Senior reviewer | Architectural review of the structural seam (`resultShape` on `MongoQueryPlan`) |
| Collaborator | Mongo lane maintainers | Owners of follow-up work threading `resultShape` through `$project`/`$group`/`$lookup`/value-objects |

## Milestones

The work fits one milestone — it's a single coherent structural change. Tasks are sequenced; later tasks depend on earlier ones.

### Milestone 1: Mongo runtime decodes via structural `resultShape`

Delivers the headline behaviour: typed reads through the ORM and query-builder return decoded JS values (notably hex `_id` strings), with structured `RUNTIME.DECODE_FAILED` envelopes on codec failure. Validated end-to-end via `mongodb-memory-server`-backed integration tests.

**Tasks:**

#### Structural types (foundation)

- [ ] Add `MongoResultShape` and `MongoFieldShape` types in a new file `packages/2-mongo-family/4-query/query-ast/src/result-shape.ts`. Variants: `document`, `leaf`, `array`, `unknown`. All shapes are deep-frozen at construction time.
- [ ] Export `MongoResultShape`/`MongoFieldShape` via `packages/2-mongo-family/4-query/query-ast/src/exports/execution.ts`.
- [ ] Extend `MongoQueryPlan<Row, Command>` in `packages/2-mongo-family/4-query/query-ast/src/query-plan.ts` with `readonly resultShape?: MongoResultShape`.
- [ ] Extend `MongoExecutionPlan<Row>` in `packages/2-mongo-family/7-runtime/src/mongo-execution-plan.ts` with `readonly resultShape?: MongoResultShape`. Update `MongoRuntimeImpl.lower` to copy `resultShape` from the input plan.
- [ ] Run `pnpm build` for the query-ast and mongo-runtime packages so downstream consumers see the new exports/types.

#### Recursive decoder (the runtime engine)

- [ ] Write unit tests in `packages/2-mongo-family/7-runtime/test/codecs/decoding.test.ts`:
  - Top-level scalar fields are decoded by their `codecId`.
  - Null and undefined cells short-circuit (no decode call).
  - `kind: 'array'` decodes each element in lockstep with `element`.
  - Nested `kind: 'document'` recurses; path is dot-joined (`address.city`).
  - Array index appears in path as `tags.0`.
  - `kind: 'unknown'` (anywhere in the tree) passes the value through unchanged.
  - Unknown `codecId` (no entry in registry) passes through.
  - Codec failure throws `RUNTIME.DECODE_FAILED` with `{ collection, path, codec, wirePreview }` and `cause` set.
  - All leaf decodes for one row dispatch through a single `Promise.all` (assert via instrumentation: count microtask hops or use a settle-order trick from the SQL test).
- [ ] Implement `decodeMongoRow(row, shape, registry, collection)` in `packages/2-mongo-family/7-runtime/src/codecs/decoding.ts` to make those tests pass. Single-armed leaf path: `await codec.decode(value)` then return.

#### Runtime integration

- [ ] Add a required `codecs: MongoCodecRegistry` field to `MongoRuntimeOptions` in `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`. Update the constructor to store it on the instance.
- [ ] Update `MongoRuntimeImpl.execute` to call `decodeMongoRow(row, exec.resultShape, this.codecs, exec.command.collection)` per row when `exec.resultShape` is present; otherwise yield rows verbatim. The decode call lives between `runDriver` and `yield row`. (Note: `RuntimeCore.execute` is the framework-level executor — we may need a small override or hook here; if so, write the test first that demonstrates the desired flow.)
- [ ] Update `packages/2-mongo-family/7-runtime/test/setup.ts` (`withMongod`) to construct a `MongoCodecRegistry` (default registry from the adapter, or shared via a helper) and pass it into both `createMongoAdapter(codecs)` and `createMongoRuntime({ codecs, ... })`.
- [ ] Update the `mongo()` extension in `packages/3-extensions/mongo/src/runtime/mongo.ts`'s `buildRuntime` to construct one `MongoCodecRegistry` and pass it to both `createMongoAdapter(codecs)` and `createMongoRuntime({ codecs, ... })`. Update the extension's `mongo.test.ts` if it touches construction.
- [ ] Confirm `defaultCodecRegistry` is exported (or expose a helper) from `@prisma-next/adapter-mongo` so callers don't have to re-register the built-ins.

#### Lane population (flat top-level case)

- [ ] Write a contract→`MongoResultShape` helper (likely in `packages/2-mongo-family/5-query-builders/query-builder/src/` since both ORM and query-builder need it; alternatively in a small shared package if dependency hygiene blocks shared use). Inputs: `MongoContract`, model name, optional selection set. Output: `MongoResultShape` with leaves for scalar fields, `kind: 'array'` for `many: true` scalar fields, and `kind: 'unknown'` for value-object fields, polymorphic fields, and relations. Deep-freeze the result.
- [ ] Write unit tests for the helper:
  - Full model → leaves for every scalar field.
  - `many: true` scalar field → `kind: 'array'` with leaf element.
  - Value-object field → `kind: 'unknown'`.
  - Selection set → restricted field map.
  - Polymorphic / relation field → `kind: 'unknown'`.
- [ ] Update ORM `compile.ts` (`packages/2-mongo-family/5-query-builders/orm/src/compile.ts`) to call the helper and attach `resultShape` to the returned plan. `select` propagates as the helper's selection input. `include` (relation) fields appear in the shape as `kind: 'unknown'` for now.
- [ ] Update query-builder typed-read terminals in `packages/2-mongo-family/5-query-builders/query-builder/src/state-classes.ts` to attach `resultShape` for terminals where the chain consists only of identity stages (`$match`, `$sort`, `$limit`, `$skip`, `$sample`, leading-only). For chains containing shape-rewriting stages, attach `resultShape: { kind: 'unknown' }`.
- [ ] `rawCommand` in `packages/2-mongo-family/5-query-builders/query-builder/src/query.ts`: confirm it still emits no `resultShape` (no change expected).

#### Integration tests (acceptance)

- [ ] Add `packages/2-mongo-family/7-runtime/test/decode.integration.test.ts` covering the headline cases:
  - Insert a doc with `{ name, email, createdAt: Date }`; read via the runtime; assert `_id` is a hex string, `createdAt` is a `Date`, scalars are plain JS values.
  - Insert a doc with a `mongo/vector@1` field; assert the array is returned (decoded) — guards against regressions when `mongoVectorCodec.decode` becomes non-identity in future.
  - Wire a synthetic codec whose `decode` throws; assert the consumer sees a `RUNTIME.DECODE_FAILED` envelope with `{ collection, path, codec, wirePreview }` and the original error on `cause`.
  - Raw command (`rawCommand`) yields rows unchanged (use a synthetic `RawAggregateCommand`).
  - A field whose `resultShape` slot is `kind: 'unknown'` is yielded verbatim (use a contrived `resultShape` value attached via a stub plan, since lane population for value-objects is out of scope).
- [ ] Add a unit/types test verifying `MongoRuntimeOptions.codecs` is required at the type level (`@ts-expect-error` on the missing-field case) — lives in `packages/2-mongo-family/7-runtime/test/runtime-types.test-d.ts`.
- [ ] Run `pnpm test` for `mongo-runtime`, `mongo-orm`, `mongo-query-builder`, and `extension-mongo`.

#### Docs / housekeeping

- [ ] Update `packages/2-mongo-family/7-runtime/README.md` if it currently documents the runtime construction surface (mention required `codecs`, the `resultShape` decode behaviour). Keep it focused on usage; defer architecture to ADRs.
- [ ] Add a short note to `docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md` (or write a follow-up ADR if substantial — see Open Items) recording that Mongo decode now lands and pointing at `result-shape.ts` as the structural seam.
- [ ] Run `pnpm lint:deps` to confirm no layering violations from the new exports.
- [ ] Run `pnpm typecheck` and `pnpm test:packages` repo-wide before opening the PR.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/mongo-runtime-decode/spec.md` are met (link tests below).
- [ ] Decide whether the `MongoResultShape` design warrants its own ADR (likely yes — a parity-departure from SQL's annotational model). If yes, draft it and migrate it into `docs/architecture docs/adrs/`.
- [ ] Strip repo-wide references to `projects/mongo-runtime-decode/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/mongo-runtime-decode/`.

## Test Coverage

| Acceptance Criterion | Test Type | Task / Location | Notes |
|---|---|---|---|
| AC1 — `_id` decoded to hex string | Integration | `decode.integration.test.ts` | Uses `mongodb-memory-server` |
| AC2 — Multiple scalar codecs decoded | Integration | `decode.integration.test.ts` | One row, multiple codec types |
| AC3 — Null/undefined short-circuit | Unit | `codecs/decoding.test.ts` | No decode call asserted via spy |
| AC4 — Scalar arrays decoded | Unit + Integration | `codecs/decoding.test.ts`, `decode.integration.test.ts` | `kind: 'array'` element walk |
| AC5 — Raw commands yield verbatim | Integration | `decode.integration.test.ts` | `RawAggregateCommand` path |
| AC6 — `kind: 'unknown'` passes through | Unit | `codecs/decoding.test.ts` | Stub shape with `unknown` slot |
| AC7 — Decode failure envelope | Unit + Integration | `codecs/decoding.test.ts`, `decode.integration.test.ts` | Synthetic throwing codec |
| AC8 — Unknown `codecId` passes through | Unit | `codecs/decoding.test.ts` | Registry returns `undefined` |
| AC9 — Single `Promise.all` per row | Unit | `codecs/decoding.test.ts` | Settle-order or microtask-hop assertion |
| AC10 — `codecs` required at type level | Type test | `runtime-types.test-d.ts` | `@ts-expect-error` on missing field |
| AC11 — Same registry to adapter + runtime | Unit | New `mongo.test.ts` assertion or extension test | Identity-equality check |
| AC12 — `resultShape` on plan + execution-plan | Type test | New `result-shape.types.test-d.ts` (or augment existing) | Shape variants assignable |
| AC13 — Mongo decode does not touch `meta.annotations`/`meta.projectionTypes` | Code review + grep | (no test) | Verified by absence; consider a lint or doc note |
| AC14 — Lanes attach `resultShape` for top-level scalars | Unit | New tests in `orm/test/` and `query-builder/test/` covering `compile.ts` and typed-read terminals | |
| AC15 — End-to-end ObjectId roundtrip | Integration | `decode.integration.test.ts` | Headline acceptance |

## Open Items

- **ADR or no ADR for the structural-seam choice?** This branch deliberately diverges from SQL's `meta.annotations` pattern for a Mongo-only seam. Worth a short ADR captured at close-out. Carrying forward as a close-out decision.
- **Sharing the contract→`resultShape` helper.** Initial home is the query-builder package; if the ORM imports it cross-package and that crosses a layering line, may need to live in a shared spot or be duplicated. Decide during implementation.
- **`MongoRuntime.execute` hook**: `RuntimeCore.execute` (framework-base) drives the per-row loop today. The Mongo runtime overrides nothing iteration-related; we'll need to either add a runtime-base hook for "post-row decode" or override `execute` on `MongoRuntimeImpl`. Prefer a tiny hook so SQL and Mongo share the seam later if SQL ever migrates.
- **Carrying forward from the spec**: shape-rewriting aggregation stages are not threaded value-level in this branch; follow-up tickets per stage (or one umbrella ticket).
- **Trait-gated `wirePreview` redaction** (TML-2329 per ADR 204) applies once landed. No change here.
