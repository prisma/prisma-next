# Plan — Codec registry unification

> Phases of the [spec](spec.md) and their validation gates. The first three phases are already landed on `tml-2229-…`; phases 3.5, 4, 5 are the remaining work.

## Phase status

- **Phase 1 — pgvector file consolidation.** ✅ Landed at `161f7f1c4`. SATISFIED.
- **Phase 2 — emit-path typeRef bug fix.** ✅ Landed at `ee82929f3` + `e94962675`. SATISFIED.
- **Phase 3 — `ContractCodecRegistry.forColumn` dispatch interface.** ✅ Substantive landed at `245c8610c` + `8a9311c93` + `ba07ad166`. SATISFIED with deferred T3.4 (the deferred deletion is what Phase 3.5 does).
- **Phase 3.5a — read-surface unification.** ✅ Landed at `637c8ccc0` + `fde001888` + `d4a37e4b7` + `8b8099f58`. SATISFIED with **8 tasks deferred to TML-2357** (mechanical-but-voluminous registration-side migration). The read surface is non-branching (`descriptorFor`, `forColumn`); the registration model still ships codec instances through the legacy `codecs:` slot and auto-lifts via the synthesis bridge.
- **Phase 4 — `@prisma-next/extension-arktype-json` extension.** Pending.
- **Phase 5 — ADR 205 update + close-out.** Pending.

## Phase 3.5a — Read-surface unification (LANDED; partial)

The substantive deliverable: **codec-id-keyed metadata reads stop branching on whether the codec is parameterized.** A unified descriptor map is built at context-construction; non-parameterized codecs auto-lift into descriptors via a synthesis bridge. `descriptorFor(codecId)` and `forColumn(table, column)` both resolve through this single map.

### What landed (4 commits)

- **T3.5.1** — `CodecDescriptor<P = void>` defined in `@prisma-next/framework-components/codec`.
- **T3.5.5** — Descriptor map built at context-construction. `synthesizeNonParameterizedDescriptor` bridges legacy codec instances into descriptors.
- **T3.5.6** — `ContractCodecRegistry.forColumn` resolves through the unified descriptor map.
- **T3.5.7** — sql-orm-client metadata reads (`traitsOf`, `values`, `getByScalar`, `getDefaultCodec`) consult `descriptorFor(codecId)` non-branching.
- **T3.5.8** — `validateCodecRegistryCompleteness` consults the descriptor map.
- **T3.5.14** — Tests cover both the parameterized and non-parameterized read paths.

### What deferred to TML-2357

- **T3.5.2** — Narrow the runtime `Codec` instance type (remove `id`, `traits`, `targetTypes`, `meta`).
- **T3.5.3** — Migrate every codec to ship a native descriptor (~50 codecs across postgres / sqlite / sql-family / mongo / pgvector). The `aliasCodec` pattern needs structural rework.
- **T3.5.4** — Delete `parameterizedCodecs:` slot; delete the synthesis bridge; contributors ship descriptors directly.
- **T3.5.9 / T3.5.10 / T3.5.11** — `ParamRef.refs` plumbing through 7 production `ParamRef.of()` sites; encode-side `forColumn` dispatch via column refs.
- **T3.5.12** — Delete `JsonSchemaValidatorRegistry`; move validation into resolved codec's `decode` body.
- **T3.5.13** — Delete `pgVectorRepresentativeCodec` (blocked on T3.5.9-11).

These deferrals are tracked under [TML-2357](https://linear.app/prisma-company/issue/TML-2357). The work is mechanical-but-voluminous and is the right shape for a separate PR series, not a single phase.

## Phase 3.5 — Unified `CodecDescriptor` migration (HISTORICAL — superseded by 3.5a + TML-2357)

**Goal**: Subsume `ParameterizedCodecDescriptor` and the legacy `Codec`-as-registration-record model under a single `CodecDescriptor<P = void>` type. Migrate every codec in every contributor package. Eliminate the parameterized/non-parameterized branching from every read site. Delete the `JsonSchemaValidatorRegistry` workaround.

**Spec ACs addressed**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9.

### Tasks

1. **T3.5.1 — Define `CodecDescriptor<P = void>` in `@prisma-next/framework-components/codec`.** Field shape per spec § Decision. Replace or alias `ParameterizedCodecDescriptor`. Land alongside the existing types so a brief migration window can compile both shapes.
2. **T3.5.2 — Narrow the `Codec` runtime-instance type.** Remove `id`, `traits`, `targetTypes`, `meta` from the `Codec` interface; they migrate to the descriptor. Family-specific extensions (SQL `Codec` and Mongo `MongoCodec`) lose their codec-id-keyed metadata fields too — those move to the descriptor.
3. **T3.5.3 — Migrate every codec to ship a descriptor.** For each non-parameterized codec, wrap the existing `Codec` definition in a constant factory (`factory: () => (_ctx) => sharedCodec`) and lift `traits` / `targetTypes` / `meta` to the descriptor. For each parameterized codec, the descriptor already exists; lift any codec-id-keyed metadata that still lived on the resolved codec onto the descriptor. Codecs to migrate (initial inventory; verify by grep):
   - postgres-adapter: ~25 codecs (text, varchar, char, int4, int8, float4, float8, numeric, bool, uuid, bytea, date, time, timetz, timestamp, timestamptz, interval, bit, varbit, json, jsonb, enum, …)
   - sqlite-adapter: integer, real, text, blob, …
   - mongo-adapter: vector + base mongo codecs
   - extension-pgvector: vector (already a parameterized descriptor; lift any remaining metadata)
   - extension-arktype-json (lands in Phase 4)
4. **T3.5.4 — Single registration slot.** `SqlStaticContributions.codecs` returns `ReadonlyArray<CodecDescriptor>`. Delete `parameterizedCodecs:` slot. Update every contributor's `codecs()` method to return descriptors. Mongo's analogous slot updates the same way.
5. **T3.5.5 — Build the descriptor map at context construction.** `buildSqlContext` builds a `Map<codecId, CodecDescriptor>` from contributors; replaces `createCodecRegistry()` + the parameterized-descriptor-map. Both `descriptorFor` and `forColumn` resolve through this single map.
6. **T3.5.6 — Migrate `ContractCodecRegistry.forColumn`.** Currently branches on whether the codec id is parameterized. After the unification, every column resolves through `descriptor.factory(typeParams ?? voidParams)(ctx)`; non-parameterized columns share the cached singleton.
7. **T3.5.7 — Migrate sql-orm-client metadata reads.** All sites (`model-accessor.ts:75,105,173`, `filters.ts:76`) consult `descriptorFor(codecId)` instead of `codecs.traitsOf(codecId)` etc. No branching.
8. **T3.5.8 — Migrate `validateCodecRegistryCompleteness`.** Consults the descriptor map. No branching.
9. **T3.5.9 — Extend `ParamRef` with `refs?: { table, column }`.** Update the AST node, its constructors, and `collectParamRefs` to thread refs from column-bound sites. This unlocks encode-side `forColumn` dispatch for DSL params.
10. **T3.5.10 — Populate `refs` in SQL builder + sql-orm-client.** When constructing `ParamRef` from a column-bound site (WHERE clause, INSERT VALUES, etc.), pass `refs`. Update `ParamDescriptor` construction in `sql-builder/src/runtime/builder-base.ts` and `sql-orm-client/src/query-plan-meta.ts`.
11. **T3.5.11 — Encode-side dispatch goes through `forColumn` first.** `encodeParam` consults `paramDescriptor.refs` if present and calls `contractCodecs.forColumn(refs.table, refs.column)`. Falls back to `forCodecId` for refs-less call sites (rare; document the constraint that codecs hitting this path must be encode-stateless w.r.t. params).
12. **T3.5.12 — Delete `JsonSchemaValidatorRegistry` and `buildJsonSchemaValidatorRegistry`.** The decode path calls `forColumn(t, c).decode(wire)` and the resolved codec's `decode` body runs validation internally. Refactor json codec descriptors to bake validation into their factory's returned codec.
13. **T3.5.13 — Delete `pgVectorRepresentativeCodec`.** Pgvector's Phase-1 stand-in for the legacy registry is no longer needed. Trim `core/vector-codec.ts`.
14. **T3.5.14 — Tests cover the unified shape.** Add or update tests so:
    - `descriptorFor('pg/text@1').traits` returns the right metadata for non-parameterized codecs.
    - `descriptorFor('pg/vector@1').traits` returns the right metadata for parameterized codecs.
    - `forColumn` works through the same path for both.
    - Non-parameterized columns sharing a codec id share the resolved codec object (caching invariant).
    - `forColumn` for parameterized columns produces per-instance codecs.

### Validation gates

All must be green:

- `pnpm typecheck`
- `pnpm lint:deps`
- `pnpm test:packages`
- `pnpm test:e2e`
- `pnpm build`
- Demo emit byte-identical against Phase 2 baseline (no emit-path change in Phase 3.5).

### Acceptance gate

- All codecs ship as descriptors; no raw `Codec` registered through any contributor slot.
- `parameterizedCodecs:` slot deleted.
- `JsonSchemaValidatorRegistry` deleted.
- `pgVectorRepresentativeCodec` deleted.
- sql-orm-client metadata reads non-branching.
- `validateCodecRegistryCompleteness` non-branching.
- Encode-side `forColumn` dispatch via `ParamRef.refs` for column-bound DSL params.
- All gates green.

### Risks

- **Codec migration scope**: ~50 codecs across ~10 packages. Mechanical but voluminous. Use `git grep "= codec\\("` and similar to enumerate before starting; surface anything that doesn't fit the descriptor shape (e.g. codec definitions that depend on closure state in non-obvious ways).
- **`Codec` interface narrowing**: removing `id`, `traits`, `targetTypes` from the runtime interface will surface every consumer that was reading those fields off codec instances. Each needs to migrate to read from the descriptor instead. Surface anything that's hard to migrate (e.g. error-formatting code that names a codec by its `id` field).
- **`ParamRef` refs plumbing**: the AST changes touch every site that constructs a `ParamRef`. Verify by exhaustive search; the SQL builder and sql-orm-client are known sites but there may be others.
- **Mongo migration**: Mongo's registration shape is parallel to SQL but the runtime dispatch path is different (it doesn't go through `encodeParams`/`decodeRow`). Migrate Mongo's registration but defer Mongo's runtime `forColumn` plumbing if it's structurally non-trivial.

## Phase 4 — `@prisma-next/extension-arktype-json`

**Goal**: Ship a per-library JSON-with-schema extension. Replaces the postgres adapter's `json-factory.ts`. Demonstrates the descriptor model on a parameterized codec with library-specific serialize/rehydrate.

**Spec ACs addressed**: AC-7.

### Tasks

1. **T4.1 — Scaffold the extension package** at `packages/3-extensions/arktype-json/` following the pgvector layout. Includes `package.json`, `tsdown.config.ts`, `core/`, `exports/`, `types/`, `test/`.
2. **T4.2 — Implement `arktypeJson<S extends ArktypeSchema>(schema)`**: returns `ColumnTypeDescriptor` with `codecId: 'arktype/json@1'`, `nativeType: 'jsonb'` (or whatever target storage), eagerly-serialized `typeParams: { expression, jsonSchema }`, and the `type` slot threading the curried factory.
3. **T4.3 — Implement `arktypeJsonCodec: CodecDescriptor<{ expression: string; jsonSchema: object }>`**. Factory rehydrates the schema from `expression` via arktype's parser, returns a `Codec` whose `decode` validates internally (no separate registry).
4. **T4.4 — Pack metadata + control + runtime descriptors** following the pgvector pattern. Register the descriptor through the unified `codecs:` slot.
5. **T4.5 — Delete `packages/3-targets/6-adapters/postgres/src/codecs/json-factory.ts`** and the postgres adapter's parameterized JSON descriptor (`pgJsonCodec`). The adapter retains only non-parameterized `json` and `jsonb` codecs (raw bytes).
6. **T4.6 — Migrate the demo**. Replace `json(productSchema)` with `arktypeJson(productSchema)` in `examples/prisma-next-demo/`. Re-emit; the demo's `contract.d.ts` should now show the schema's TS source via arktype's `.expression`.
7. **T4.7 — Tests**: type-level (factory return is `(ctx) => Codec<…, InferOutput<S>>`); runtime decode (rejects malformed payloads); serialize/rehydrate roundtrip (lossless across an arktype `Type`'s expressible features).

### Validation gates

Same as Phase 3.5.

### Acceptance gate

- `arktypeJson(schema)` ships from the new extension; `json(schema)` deleted from postgres adapter.
- Demo migrates; e2e tests pass.
- All gates green.

## Phase 5 — Documentation + close-out

**Goal**: Update ADR 205, subsystem docs, package READMEs to reflect the final unified design. Strip TML-2330 misattributions. Run the close-out checkpoint per `drive-orchestrate-plan` before the project-dir delete.

**Spec ACs addressed**: AC-8, AC-9.

### Tasks

1. **T5.1 — Rewrite ADR 205** to capture the unified `CodecDescriptor` model. The "function is the signature" framing carries forward; the "ParameterizedCodecDescriptor as sister" framing supersedes. Document the descriptor/instance pattern as the structural answer to static-vs-instance data. Strip TML-2330 misattributions; the dual-JSON-descriptor "surface segregation" section deletes (replaced by the per-library-extension framing).
2. **T5.2 — Update subsystem docs** at `docs/architecture docs/subsystems/2. Contract Emitter & Types.md` and `9. No-Emit Workflow.md` to reflect the unified descriptor.
3. **T5.3 — Update package READMEs**: `framework-components/README.md`, `extension-pgvector/README.md`, `adapter-postgres/README.md`, `adapter-mongo/README.md`, plus the new `extension-arktype-json/README.md`.
4. **T5.4 — TML-2330 misattribution sweep**: search the entire codebase for `TML-2330` references; verify each accurately attributes the work to TML-2330's actual scope (KMS dispatch concurrency); rewrite or delete misattributions.
5. **T5.5 — Close-out checkpoint** per `drive-orchestrate-plan/SKILL.md § Project close-out checkpoint`:
   - Step 1: migration audit of rolling artifacts at `wip/codec-registry-unification-review/`. Verify every load-bearing decision has a durable home.
   - Step 2: branch-scoped close-out review via `drive-pr-local-review` (fresh-spawn reviewer; output to `wip/codec-registry-unification-close-out-review/`).
   - Step 3: authorize close-out tasks.
6. **T5.6 — Strip repo-wide references to `projects/codec-registry-unification/**`** (rewrite to ADR 205 links).
7. **T5.7 — Delete `projects/codec-registry-unification/`** as the close-out commit.

### Validation gates

- All Phase 3.5 + Phase 4 gates still green.
- ADR 205 + subsystem docs + READMEs reflect HEAD's behavior.
- No surviving repo references to the project path (outside `wip/`).
- Project directory deleted.

### Acceptance gate

- ADR 205 accurately describes the final model. TML-2330 misattributions stripped.
- Branch-scoped close-out review SATISFIED.
- Project directory deleted.

## Open items (deferred from this project)

- **Mongo runtime `forColumn` plumbing** if Mongo gains more parameterized codecs (today only vector). Mongo's registration shape migrates with Phase 3.5 (it's a uniform descriptor type); the wire-dispatch path can defer.
- **Future per-library JSON extensions** (zod, valibot) when each has a clean serialize/rehydrate story.
- **`'json-validator'` `CodecTrait`** disposition — likely retires when validation moves into the resolved codec's decode body. Phase 3.5 deletes it if no consumer remains; otherwise the trait persists as a structural marker.
