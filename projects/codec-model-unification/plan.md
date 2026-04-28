# Plan — Codec model unification

Delivers the design in [spec.md](spec.md) across five milestones. Each milestone is a focused PR mapped to acceptance criteria from the spec.

For mechanism detail, see the design docs:

- [design/higher-order-codecs.md](design/higher-order-codecs.md) — the curried factory + descriptor shape, the `FieldOutputType` rewrite.
- [design/authoring-ergonomics.md](design/authoring-ergonomics.md) — pack-author surface, JSON factory, `storage.types`/`typeRef`.
- [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md) — runtime materialization contract, CipherStash case, rebase strategy.

## Milestone graph

```text
M0 (shaping) ──► M1 (HoC shape + descriptor) ──► M2 (no-emit FieldOutputType) ─┐
                            │                                                    │
                            └─────► M3 (json factory) ───────────────────────────┤
                                                                                  │
                                                                                  ▼
                                                            M4 (migrate codecs) ──► M5 (close-out)
```

- **M2** depends on M1; uses a synthetic test fixture, so it ships before any production codec migrates.
- **M3** depends on M1; independent of M2.
- **M4** depends on M1, M2, M3.
- **M5** is documentation and project-dir close-out; depends on M4.

The previous plan's "M5 — cleanup base `Codec`" milestone collapses into M1, because the new model removes parameterization fields from the SQL `Codec` interface as part of introducing the descriptor (no separate cleanup pass needed).

## Status

- **Done**: M0.1 (spec & plan scaffold), M0.2 (design docs).
- **Remaining**: M0.3 (baseline measurements), M1, M2, M3, M4, M5.

---

## M0 — Project shaping

### Done

- `spec.md`, `plan.md`, three design docs under `design/`, asset under `assets/`. Cross-linked.

### Remaining: M0.3 — Baseline measurements

Capture pre-change build perf so [AC-7](spec.md#ac-7-build-performance-acceptable) is verifiable.

- Run `pnpm typecheck` for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts`. Three runs each, record median in `assets/typecheck-baseline.md`.
- Snapshot the current emit output for every contract under `examples/` and `apps/demo` (so M4 can assert byte-identical re-emit).
- Update Linear: re-scope [TML-2229](https://linear.app/prisma-company/issue/TML-2229) to point at this project; create [TML-2329](https://linear.app/prisma-company/issue/TML-2329) (G9) and [TML-2330](https://linear.app/prisma-company/issue/TML-2330) (G1, G4) follow-ups with cross-links.

### Acceptance gate

- [ ] `assets/typecheck-baseline.md` written.
- [ ] Emit snapshots captured under `assets/emit-baseline/` (or equivalent).
- [ ] Linear updated.

---

## M1 — Higher-order codec shape

**Goal:** Add `Ctx`, `ParameterizedCodecDescriptor`, and the curried-factory shape. Remove `paramsSchema?` and `init?` from the SQL `Codec` interface. Production codecs unchanged behaviorally — they keep working through the existing `parameterizedCodecs` slot whose contents we widen.

**Spec AC:** [AC-1](spec.md#ac-1-higher-order-codec-factories-type-resolve-correctly), [AC-6](spec.md#ac-6-cipherstash-forward-compat-surface-is-locked).

### Tasks

1. **Add `Ctx` to `@prisma-next/framework-components`.** Co-located with the existing `Codec` interface. — [design](design/higher-order-codecs.md#anatomy-of-a-higher-order-codec)
2. **Add `ParameterizedCodecDescriptor`** in `@prisma-next/framework-components` ([open question 1 default](spec.md#open-questions)). Shape: `{ codecId, paramsSchema: StandardSchemaV1<P>, renderOutputType?, factory: (P) => (Ctx) => Codec }`. — [design](design/higher-order-codecs.md#the-descriptor)
3. **Widen `paramsSchema` typing** to accept `StandardSchemaV1<…>` instead of arktype `Type<…>`. No behavior change (Arktype implements Standard Schema).
4. **Remove `paramsSchema?` and `init?` from SQL `Codec`** interface. Codecs that previously declared them migrate to the descriptor in M4.
5. **Migrate the `parameterizedCodecs` runtime-descriptor slot** to carry `ParameterizedCodecDescriptor[]` instead of today's `RuntimeParameterizedCodecDescriptor[]` (which is just `{ codecId, paramsSchema, init? }`). New shape adds `factory`; existing extensions need a one-line update (deferred to M4).
6. **Open question 2** ([renderOutputType placement](spec.md#open-questions)): decide whether to migrate `renderOutputType?` from base `Codec` to the descriptor. Recommended: yes (keeps base `Codec` parameterization-free). Lock at M1.
7. **Type tests** for the curried factory shape against a synthetic fixture (no production codec yet): `vector(1536)` typechecks as `(ctx: Ctx) => Codec<…, Vector<1536>>`; `cipherStash(params)` typechecks with `Ctx`-aware return.

### Acceptance gate

- [ ] AC-1 type tests green against a synthetic fixture.
- [ ] AC-6: a fixture factory using `ctx.usedAt` typechecks.
- [ ] `pnpm typecheck` and `pnpm lint:deps` pass.
- [ ] `paramsSchema?` and `init?` gone from SQL `Codec`; production codecs still build (they will move to descriptors in M4).

---

## M2 — No-emit `FieldOutputType` rewrite

**Goal:** Rewrite the type-level resolver to read the factory's TS return type. A synthetic fixture proves the wiring; no production codec is migrated yet.

**Spec AC:** [AC-2](spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly).

### Tasks

1. **Synthetic test fixture** under `packages/2-sql/2-authoring/contract-ts/src/__tests__/fixtures/`: a curried HoC factory with a known return type, used to assert resolution without depending on pgvector or any other extension.
2. **Rewrite `FieldOutputType`** in [packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts):
   - Resolve `typeRef` indirection through `storage.types` first.
   - When the column carries a `type` field whose TS type is `(ctx: Ctx) => Codec<…>`, synthetically apply `Ctx` and read `Js`.
   - Otherwise fall through to the codec's base output (non-parameterized columns).
   - Preserve nullability uniformly.
   - Detail and pseudo-code: [design/higher-order-codecs.md#rewriting-the-no-emit-fieldoutputtype](design/higher-order-codecs.md#rewriting-the-no-emit-fieldoutputtype).
3. **Type tests**:
   - Inline factory call resolves through the factory's return type.
   - `typeRef` resolves through `storage.types` to the same type.
   - Non-parameterized columns unchanged.
   - Nullability preserved.
   - `ComputeColumnJsType` resolves transparently.

### Acceptance gate

- [ ] AC-2 type-test cases pass against the synthetic fixture.
- [ ] `pnpm test:packages` green for `@prisma-next/contract-ts`.
- [ ] No production codec touched.

---

## M3 — Ship the JSON factory

**Goal:** A first-class `json(schema)` factory in `@prisma-next/postgres-core` that gives JSON columns Standard-Schema-driven type inference.

**Spec AC:** [AC-5](spec.md#ac-5-json-factory-ships).

### Tasks

1. **Implement `json<S extends StandardSchemaV1>(schema: S)`** as a curried factory returning `(ctx) => Codec<'pg/json@1', ['equality'], string, InferOutput<S>>`. Body uses `schema['~standard'].validate` for runtime validation in `decode`. — [design](design/authoring-ergonomics.md#json-factory)
2. **Implement the descriptor `pgJsonCodec: ParameterizedCodecDescriptor<{ schema: StandardSchemaV1 }>`.** `paramsSchema` validates that `schema` is a Standard Schema. `renderOutputType` calls into the schema's TS-source serialization if available, falling back to `'unknown'`.
3. **Tests**:
   - Type test: `json(arktypeSchema)` infers as `(ctx) => Codec<…, InferOutput<typeof arktypeSchema>>`.
   - Runtime test: `decode` rejects payloads that don't match the schema.
   - Snapshot test: `renderOutputType(...)` produces the expected TS source for a representative arktype schema.

### Acceptance gate

- [ ] AC-5 cases pass.
- [ ] `pnpm test:packages` and `pnpm typecheck` green.
- [ ] No production codec migrated yet — production still uses the existing JSON codec until M4.

---

## M4 — Migrate parameterized codecs

**Goal:** Move every codec that currently exposes parameterization (today's `paramsSchema` / `init` fields, and per-codec column factories) to the curried HoC shape with a `ParameterizedCodecDescriptor` export.

**Spec AC:** [AC-2](spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly) (now with production codecs), [AC-3](spec.md#ac-3-authoring-side-ctx-is-supplied-to-factories), [AC-4](spec.md#ac-4-existing-parameterized-codecs-migrated).

### Tasks (independently mergeable)

1. **pgvector** — replace today's `vector(N)` (returning `ColumnTypeDescriptor`) with a curried HoC factory whose return is `(ctx) => Codec<…, Vector<N>>`; export `pgVectorCodec: ParameterizedCodecDescriptor`. Existing `pgVectorCodec` (the `Codec` object) is reshaped or removed accordingly.
2. **postgres-core** — for each parameterized codec (numeric, timestamp, timestamptz, char if present, json/jsonb): write the curried factory and the descriptor; replace the existing `vectorColumn`/factory exports.
3. **Mongo codecs** — same pattern.
4. **Contract-authoring builder** — update `.column(...)` to detect the partially applied factory shape (`(ctx) => Codec<…>`) and apply `ctx`. The same path handles `storage.types` aggregation. — [design](design/authoring-ergonomics.md#how-ctx-is-supplied)
   - **4a. Extend `ColumnTypeDescriptor`** in `@prisma-next/contract-authoring` to admit `type?: (ctx: Ctx) => Codec` as a first-class field. Update fixtures (in particular `packages/2-sql/2-authoring/contract-ts/test/fixtures/codec-resolver-fixture.ts`) to drop the structural intersection that M2 R1 relied on. (Surfaced by M2 R1 reviewer; deferred from M2 because the M2 type-level resolver works through TS structural typing, but the production builder needs the explicit slot when factories flow through `.column(...)`.)
5. **Examples and integration tests** — update demo schemas to use the new factory call shape (`vector(1536)` instead of `vector(1536)` returning the old descriptor — same call site, semantically updated).
6. **Emit-snapshot diff** — re-emit every contract; assert byte-identical against M0.3 snapshots.

### Acceptance gate

- [ ] AC-2 with production codecs (pgvector `Vector<1536>`, char(N), JSON-with-schema).
- [ ] AC-3 cases pass (anonymous + named instances; `ctx.usedAt` aggregated correctly).
- [ ] AC-4 (all migrated; per-codec column factories removed).
- [ ] Emit snapshots byte-identical against the M0.3 baseline.
- [ ] `pnpm test:packages` and `pnpm test:e2e` green.

If the diff in any sub-task balloons, split into separate PRs by codec family.

### M4 Cleanups (carve-outs from M1, [TML-2330](https://linear.app/prisma-company/issue/TML-2330))

These transitional fields and call sites were carried into M1 to keep the emit
path and runtime validator wiring green without migrating production codecs. M4
must remove them as part of the codec migration, in step with the curried-factory
rollout:

- Remove `renderOutputType?` from the SQL `Codec` extension at [packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts](../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) and from the `codec()` factory's config.
- Remove `renderOutputType?` from the `MongoCodec` extension at [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts](../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) and from the `mongoCodec()` factory's config.
- Replace the emitter's duck-typed `renderOutputType` cast at [packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts](../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts) with a typed `ParameterizedCodecDescriptor`-keyed lookup driven from the control stack.
- Drop the per-codec inline `renderOutputType` configurations now living on production codec objects (`sql-codecs.ts`, `postgres/core/codecs.ts`, `pgvector/core/codecs.ts`, `mongo-adapter/core/codecs.ts`); the renderer moves onto the codec's `ParameterizedCodecDescriptor`.

---

## M5 — Documentation and close-out

**Goal:** Long-lived docs in `docs/`; `projects/codec-model-unification/` deleted.

**Spec AC:** [AC-7](spec.md#ac-7-build-performance-acceptable), [AC-8](spec.md#ac-8-documentation-lands).

### Tasks

1. **ADR** under `docs/architecture docs/adrs/` extending [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md), referencing [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) as the "function is the signature" precedent. Decision, rationale (pulled from this project's design docs), consequences for pack-author surface and the future runtime work.
2. **Subsystem doc** under `docs/architecture docs/subsystems/` (codec subsystem) updated to reflect the higher-order-codec model.
3. **Pack-author README sections** in the package(s) hosting the descriptor and factories. Cover writing curried factories, `Ctx`, `paramsSchema`/`renderOutputType` placement, `storage.types`/`typeRef` guidance.
4. **Re-measure typecheck** for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts`; assert within ±20% of M0.3 baseline.
5. **Migrate or strip** any project content with long-lived value into `docs/`.
6. **Strip repo-wide references** to `projects/codec-model-unification/**`.
7. **Delete** `projects/codec-model-unification/`.

### Acceptance gate

- [ ] ADR merged.
- [ ] Subsystem doc and package READMEs updated.
- [ ] AC-7: typecheck within ±20% of baseline.
- [ ] No surviving repo references to the project path.
- [ ] `projects/codec-model-unification/` deleted.

---

## Risks and mitigations

- **Type-cast scope creep.** The new model requires zero casts in the per-codec migration (the factory's TS return type is filled in directly, no `as unknown as …`). If any cast appears during M4, it's a signal that the factory's signature is wrong; reviewers veto.
- **TS depth limits with deep `InferOutput` chains.** Deep `StandardSchemaV1.InferOutput` chains for large schemas may hit TS recursion limits — this is a TS limitation users hit independently of this project. Fall-back: the descriptor's `renderOutputType` can return `'unknown'` for the emit path while the no-emit path keeps the precise inference.
- **Emit-path regression.** AC-4's byte-identical-snapshot check guards against this. Verified per-codec.
- **Contract-authoring builder rewrite.** M4 task 4 changes how `.column(...)` handles its second argument; could break existing call sites if not done carefully. Mitigated by:
  - Type-discriminated dispatch — non-parameterized codecs (plain `Codec` objects) keep their old code path; only the new factory shape goes through the new path.
  - Synthetic fixtures + the demo's existing tests catch behavioral drift.
- **`ctx` shape locks something we'd want to change.** Mitigated by keeping `ctx` minimal (`{ name, usedAt }`) and capturing what the known consumer (CipherStash G1) needs. Adding fields later is non-breaking.
- **Standard Schema validator wiring.** Existing arktype validators implement Standard Schema; M1 task 3 is a type widening only.
- **#374 merge churn.** Rebase strategy in [design/runtime-contract-and-compatibility.md#rebase-strategy](design/runtime-contract-and-compatibility.md#rebase-strategy).
