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

**Validation gate:**

- `pnpm build` — affected Mongo packages export new types; tsdown must regenerate `dist/*.d.mts` so downstream consumers (orm, query-builder, mongo extension, integration tests) can typecheck against them.
- `pnpm typecheck` — repo-wide; catches consumer call sites that break on the new required `MongoRuntimeOptions.codecs` field (mongo extension, query-builder/orm internal callers, runtime test setup, etc.).
- `pnpm test:packages` — workspace-scoped tests, excludes examples/. Covers the new `decodeMongoRow` unit tests, the headline `mongodb-memory-server` integration test, and ensures no regressions in adjacent Mongo packages.
- `pnpm lint:deps` — guards layering as new exports flow from `query-ast` into lanes and runtime.
- `pnpm lint` — repo-wide biome.

If any gate fails, surface to the orchestrator before declaring the milestone done. Cross-package gates are essential here because the new required `codecs` field on `MongoRuntimeOptions` is a public-export change that consumers (extension, tests, examples) must adopt.

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

### Milestone 2: Mongo runtime joins the framework execution-stack composition model

Replaces the `codecs` field on `MongoRuntimeOptions` (landed in m1) with the framework's stack-aggregation pattern that SQL has used since ADR 152: component descriptors declare codecs on `ComponentMetadata.types.codecTypes.codecInstances`; `createMongoExecutionContext({ contract, stack })` walks the stack and aggregates them into one registry; the runtime takes `{ context, driver, ... }` and reads `context.codecs` for decode dispatch.

Removes `createDefaultMongoCodecRegistry` from the public surface — the standard codec set comes from the Mongo target/adapter descriptor's declared `codecInstances`, single source of truth. User-facing examples and test setups simplify; the `mongo()` extension constructs the stack and context internally.

The decode behaviour landed in m1 is unchanged. m2 is purely a runtime-construction-API refactor — the structural decode path (`MongoResultShape`, `decodeMongoRow`, `MongoRuntimeImpl.execute` override, lane population) remains as-is.

**Validation gate:** same as m1 — `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm lint`. Cross-package gates remain essential because the `MongoRuntimeOptions` change is a public-export break that propagates through the extension, all examples, and all integration test setups.

**Reference implementations to mirror:**

- `packages/2-sql/5-runtime/src/sql-context.ts` — `SqlExecutionStack`, `createSqlExecutionStack`, `createExecutionContext`, the contributor-walk in `createExecutionContext` (lines 446–502).
- `packages/1-framework/1-core/framework-components/src/control-stack.ts` — `extractCodecLookup` and `assertUniqueCodecOwner` (the duplicate-detection pattern).
- `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts` — runtime-side adapter descriptor that declares `codecInstances`.
- `packages/3-extensions/postgres/src/runtime/postgres.ts` — user-facing extension that composes a stack + context internally.

**Tasks:**

#### Framework-side runtime descriptors and stack

- [ ] Define `MongoRuntimeTargetDescriptor`, `MongoRuntimeAdapterDescriptor`, `MongoRuntimeExtensionDescriptor` types in the appropriate Mongo runtime/foundation home (likely `packages/2-mongo-family/7-runtime/src/` next to `mongo-runtime.ts`, or a new small `mongo-execution-stack.ts` if it grows). Each extends the framework's `Runtime{Target,Adapter,Extension}Descriptor<'mongo', 'mongo'>` and adds Mongo-specific `static contributions` analogous to SQL's `MongoStaticContributions` (codecs at minimum; nothing else needed in this milestone).
- [ ] Define `MongoExecutionStack = { target, adapter, driver?, extensionPacks }` and `createMongoExecutionStack({ target, adapter, driver?, extensionPacks? })`, mirroring `createSqlExecutionStack`. Lives alongside the descriptors.
- [ ] Define `MongoExecutionContext = { contract, codecs, stack }` and `createMongoExecutionContext({ contract, stack })`. The function walks `[stack.target, stack.adapter, ...stack.extensionPacks]`, calls each contributor's `codecs()` getter, registers each codec into a fresh `MongoCodecRegistry`, throws on duplicate ids (mirror `assertUniqueCodecOwner`'s wording). Returns `{ contract, codecs, stack }` frozen.
- [ ] Write unit tests for `createMongoExecutionContext` covering: (a) all standard codecs aggregated from a target+adapter-only stack; (b) extension-pack codec contributions are folded in; (c) duplicate codec ids across contributors throw with both descriptor ids in the error message; (d) the returned registry is the same one whether you query target codecs or extension-pack codecs (single registry, single source).

#### Runtime descriptor: declare codec instances

- [ ] Build a `RuntimeMongoAdapterDescriptor` in `packages/3-mongo-target/2-mongo-adapter/src/exports/runtime.ts` (new file, mirroring `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`). Declares `codecInstances` (the seven Mongo wire-type codecs already in `core/codecs.ts`) and a `create(stack)` factory that returns the existing `MongoAdapterImpl`. The `create(stack)` may inspect the stack later if extension packs need to contribute codecs to the adapter; in this milestone the adapter is independent of stack codecs.
- [ ] Update `createMongoAdapter()` to either be replaced by the descriptor's `create()` or keep the function as a thin wrapper around `descriptor.create({...})` — implementer's call. Either way, the public `createMongoAdapter()` no longer takes a `codecs?` parameter.
- [ ] Build a `RuntimeMongoTargetDescriptor` (new; minimal — declares `kind: 'target'`, `familyId: 'mongo'`, `targetId: 'mongo'`, and a `create()` factory returning `{ familyId, targetId }`). Lives in `packages/3-mongo-target/1-mongo-target/src/exports/runtime.ts` (new file).
- [ ] Verify the mongo target descriptor's existing `codecInstances` declaration in `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts:35–58` is the canonical source — no duplicate listing. Either move the `codecInstances` array up to `packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts` and have both control + runtime descriptors import the array, or have the runtime descriptor import from the existing control export. Pick the import direction that doesn't violate layering.

#### Mongo runtime: drop `codecs` from options

- [ ] Update `MongoRuntimeOptions` in `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`: remove `codecs`, replace `{ adapter, contract, targetId, codecs }` with `{ context: MongoExecutionContext }`. Keep `driver`, `middleware?`, `mode?`. The runtime reads `this.#context.codecs` for decode dispatch and `this.#context.stack.adapter` for the adapter.
- [ ] Update `MongoRuntimeImpl` constructor accordingly — drop `#codecs` field (use `#context.codecs`), drop `#adapter` field (use `#context.stack.adapter`).
- [ ] Update `MongoRuntimeImpl.execute`'s call to `decodeMongoRow` to use `this.#context.codecs`.
- [ ] Remove the `createDefaultMongoCodecRegistry` export from `packages/3-mongo-target/2-mongo-adapter/src/exports/index.ts` (or wherever it lives). The function may stay internal to the adapter package for backward composition or be deleted entirely if unused after the descriptor migration; implementer's call.

#### Tests + examples + extension migrate

- [ ] Update the m1 `runtime-codecs-required.test-d.ts` type test: instead of asserting `MongoRuntimeOptions.codecs` is required (which it no longer is — the field is gone), assert that omitting the `codecs` field at construction is **not** a TypeScript error and that passing one **is** an error (excess property check). Rename the file to `runtime-options-shape.test-d.ts` to reflect the new intent.
- [ ] Update `packages/2-mongo-family/7-runtime/test/setup.ts`'s `withMongod` to construct a stack + context and pass `{ context, driver }` to `createMongoRuntime`. The setup function's signature stays the same; the codec registry construction disappears from the call site.
- [ ] Update `packages/2-mongo-family/5-query-builders/orm/test/integration/orm-ergonomics.test.ts`, `polymorphism.test.ts`, `test/integration/test/mongo/setup.ts`, `test/integration/test/cross-package/cross-family-middleware.test.ts` to mirror the new construction shape. Cross-family middleware test is the trickiest because it uses an empty registry today; under the new shape it constructs an empty stack and an empty context.
- [ ] Update the `mongo()` extension in `packages/3-extensions/mongo/src/runtime/mongo.ts:120–135` (`buildRuntime`): construct the stack inline (target descriptor + adapter descriptor + driver), call `createMongoExecutionContext({ contract, stack })`, pass `{ context, driver, ... }` to `createMongoRuntime`. The extension's user-facing options bag is unchanged — users continue to pass `{ url, dbName, ... }` or `{ contract, ... }` as today; the stack-construction is internal.
- [ ] Update the extension's test (`packages/3-extensions/mongo/test/mongo.test.ts`): replace the m1 "same registry to adapter + runtime" identity-equality test with a "context built from the user's options" assertion (the extension constructs exactly one stack and one context per `buildRuntime` invocation).
- [ ] Update `examples/mongo-demo/src/db.ts` and `examples/retail-store/src/db.ts`: drop the `createDefaultMongoCodecRegistry` import and the manual codec/adapter wiring. The new shape is a one-liner equivalent to the pre-decode version.

#### Integration tests + housekeeping

- [ ] Add a new integration test slice in `packages/2-mongo-family/7-runtime/test/decode.integration.test.ts` (or alongside) verifying AC17 — duplicate codec ids across stack contributors throw at composition time with both descriptor ids in the error message. Use a minimal stub stack with a deliberately-conflicting extension pack.
- [ ] Update `packages/2-mongo-family/7-runtime/README.md` to document the stack/context construction model and to remove references to passing a `codecs` option directly.
- [ ] Update `docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md`'s "Cross-family scope notes" section: the "Mongo decode now lands" pointer it gained in m1 should also note the stack composition model is now consistent with SQL.
- [ ] Run `pnpm lint:deps` to confirm no layering violations from the new runtime descriptor exports (especially the `3-mongo-target/2-mongo-adapter` → framework-components edge for `RuntimeAdapterDescriptor`).
- [ ] Run the full validation gate (`pnpm build && pnpm typecheck && pnpm test:packages && pnpm lint:deps && pnpm lint`) before declaring done.

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
| AC10 (m2) — `codecs` field absent from `MongoRuntimeOptions` | Type test | `runtime-options-shape.test-d.ts` | Renamed from `runtime-codecs-required.test-d.ts`; asserts omission is OK and excess-property is an error |
| AC11 (m2) — `mongo()` extension hides `MongoCodecRegistry` from user surface | Unit | `mongo.test.ts` | Replaces m1 identity-equality test; asserts one stack + one context per `buildRuntime` |
| AC12 — `resultShape` on plan + execution-plan | Type test | `result-shape.types.test-d.ts` | Shape variants assignable |
| AC13 — Mongo decode does not touch `meta.annotations`/`meta.projectionTypes` | Code review + grep | (no test) | Verified by absence |
| AC14 — Lanes attach `resultShape` for top-level scalars | Unit | `orm/test/compile.test.ts`, `query-builder/test/result-shape.test.ts` | |
| AC15 — End-to-end ObjectId roundtrip | Integration | `decode.integration.test.ts` | Headline acceptance |
| AC16 (m2) — `MongoExecutionStack` constructed via `createMongoExecutionStack` | Unit | New `mongo-execution-stack.test.ts` (mirroring SQL's `execution-stack.test.ts`) | Stack shape + descriptor accessors |
| AC17 (m2) — `createMongoExecutionContext` aggregates codecs from contributors; duplicate ids throw | Unit | New `mongo-execution-context.test.ts` | Mirror SQL's `execution-context` tests; one test for the duplicate-ids failure mode with stub extension pack |
| AC18 (m2) — `MongoRuntimeOptions` is `{ context, driver, ... }`; runtime reads `context.codecs` | Type test + unit | `runtime-options-shape.test-d.ts`, runtime construction test | Field-presence assertions |
| AC19 (m2) — Target/adapter descriptor declares the seven Mongo wire codecs via `codecInstances` | Unit | New `runtime-adapter-descriptor.test.ts` | Verifies `codecInstances.length === 7` and ids match the canonical set |
| AC20 (m2) — Examples and extension users see no `MongoCodecRegistry` symbol | Code review + grep | `examples/mongo-demo/src/db.ts`, `examples/retail-store/src/db.ts`, `packages/3-extensions/mongo/src/runtime/mongo.ts` | grep for `MongoCodecRegistry` and `createDefaultMongoCodecRegistry` should match nothing user-facing |

## Open Items

- **ADR or no ADR for the structural-seam choice?** This branch deliberately diverges from SQL's `meta.annotations` pattern for a Mongo-only seam. Worth a short ADR captured at close-out. Carrying forward as a close-out decision.
- **Sharing the contract→`resultShape` helper.** Initial home is the query-builder package; if the ORM imports it cross-package and that crosses a layering line, may need to live in a shared spot or be duplicated. Decide during implementation.
- **`MongoRuntime.execute` hook**: `RuntimeCore.execute` (framework-base) drives the per-row loop today. The Mongo runtime overrides nothing iteration-related; we'll need to either add a runtime-base hook for "post-row decode" or override `execute` on `MongoRuntimeImpl`. Prefer a tiny hook so SQL and Mongo share the seam later if SQL ever migrates.
- **Carrying forward from the spec**: shape-rewriting aggregation stages are not threaded value-level in this branch; follow-up tickets per stage (or one umbrella ticket).
- **Trait-gated `wirePreview` redaction** (TML-2329 per ADR 204) applies once landed. No change here.
