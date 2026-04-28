# Plan — Codec model unification

Delivers the design in [spec.md](spec.md) across six milestones. Each milestone is a focused PR mapped to acceptance criteria from the spec.

For mechanism detail, see the design docs:

- [design/codec-interface-and-output-types.md](design/codec-interface-and-output-types.md)
- [design/authoring-ergonomics.md](design/authoring-ergonomics.md)
- [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md)

## Milestone graph

```text
M0 (shaping) ──► M1 (interface + OutputType fn) ──► M2 (no-emit resolver) ─┐
                       │                                                 │
                       └────────────► M3 (columnFor + jsonCodec) ────────┤
                                                                          │
                                                                          ▼
                                                               M4 (migrate codecs) ──► M5 (cleanup) ──► M6 (close-out)
```

- **M2** depends on M1 only; uses a synthetic test fixture, so it ships before any production codec migrates.
- **M3** depends on M1; independent of M2.
- **M4** depends on M1, M2, M3.
- **M5** depends on M4 (must drop base `Codec` fields only after every codec has migrated).

## Status

- **Done**: M0.1 (spec & plan scaffold), M0.2 (design docs).
- **Remaining**: M0.3 (baseline measurements), M1, M2, M3, M4, M5, M6.

---

## M0 — Project shaping

### Done

- `spec.md`, `plan.md`, three design docs under `design/`, asset under `assets/`. Cross-linked.

### Remaining: M0.3 — Baseline measurements

Capture pre-change build perf so [AC-7](spec.md#ac-7-build-performance-acceptable) is verifiable.

- Run `pnpm typecheck` for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts`. Three runs each, record median in `assets/typecheck-baseline.md`.
- Snapshot the current emit output for every contract under `examples/` and `apps/demo` (so M4/M5 can assert byte-identical re-emit).
- Update Linear: re-scope [TML-2229](https://linear.app/prisma-company/issue/TML-2229) to point at this project; create [TML-2329](https://linear.app/prisma-company/issue/TML-2329) (G9) and [TML-2330](https://linear.app/prisma-company/issue/TML-2330) (G1, G4) follow-ups with cross-links.

### Acceptance gate

- [ ] `assets/typecheck-baseline.md` written.
- [ ] Emit snapshots captured under `assets/emit-baseline/` (or equivalent).
- [ ] Linear updated.

---

## M1 — Codec interface split + output-type function mechanism

**Goal:** Add `Codec`, `ParameterizedCodec`, `CodecOutputTypeFn`, `Apply`, and the `parameterizedCodec({…})` factory. Production codecs unchanged. Types exist alongside the existing optional fields on base `Codec`; cleanup happens at M5.

**Spec AC:** [AC-1](spec.md#ac-1-output-type-function-mechanism-works-at-the-type-level), [AC-6](spec.md#ac-6-initparams-instancemeta-signature-is-locked).

### Tasks

1. **Add `CodecOutputTypeFn` and `Apply` to `@prisma-next/framework-components`.** Co-located with the existing `Codec` interface. Type tests for `Apply` as a type-level function. — [design](design/codec-interface-and-output-types.md#output-type-function-mechanism)
2. **Add `ParameterizedCodec` interface.** Required `paramsSchema` (typed `StandardSchemaV1<Params>`), `renderOutputType`, `OutputType`. Optional `init?(params, instance)`. — [design](design/codec-interface-and-output-types.md#the-parameterizedcodec-interface)
3. **Add `parameterizedCodec({…})` factory.** Compile-time enforcement of required fields. Houses the single justified `as unknown as <PerCodecOutputType>` cast (or codec body — open question 3 in spec). — [design](design/codec-interface-and-output-types.md#the-factory-parameterizedcodec)
4. **Widen `paramsSchema` validation entry points.** Anything currently typed against arktype `Type<…>` accepts `StandardSchemaV1<…>`. No behavior change (Arktype implements Standard Schema).
5. **Type tests** for `Apply<VectorOutputType, { length: 1536 }>` ≡ `Vector<1536>` against a synthetic fixture (no production codec yet).

### Acceptance gate

- [ ] AC-1 type tests green.
- [ ] AC-6: a fixture codec defining `init` typechecks against the new signature.
- [ ] `pnpm typecheck` and `pnpm lint:deps` pass.
- [ ] Zero production callers — types co-exist with the existing optional fields on base `Codec`.

---

## M2 — No-emit `FieldOutputType` rewrite

**Goal:** Rewrite the type-level resolver against `codec.OutputType`. A synthetic fixture proves the wiring; no production codec is migrated yet.

**Spec AC:** [AC-2](spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly).

### Tasks

1. **Synthetic test fixture** under `packages/2-sql/2-authoring/contract-ts/src/__tests__/fixtures/`: a `ParameterizedCodec` with a known `OutputType`, used to assert resolution without depending on pgvector or any other extension.
2. **Rewrite `FieldOutputType`** in [packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts):
   - Resolve `typeRef` indirection through `storage.types` first.
   - When the codec entry has an `OutputType` field, apply `Apply<OutputType, typeParams>`; otherwise fall through to the codec's base output.
   - Preserve nullability uniformly.
   - Detail and pseudo-code: [design/codec-interface-and-output-types.md#rewriting-the-no-emit-fieldoutputtype](design/codec-interface-and-output-types.md#rewriting-the-no-emit-fieldoutputtype).
3. **Type tests**:
   - Inline `typeParams` resolves through `OutputType`.
   - `typeRef` resolves through `OutputType`.
   - Non-parameterized columns unchanged.
   - Nullability preserved.
   - `ComputeColumnJsType` resolves through `OutputType` transparently.

### Acceptance gate

- [ ] AC-2 type-test cases pass against the synthetic fixture.
- [ ] `pnpm test:packages` green for `@prisma-next/contract-ts`.
- [ ] No production codec touched.

---

## M3 — `columnFor` and `jsonCodec` authoring helpers

**Goal:** The pack-author surface that makes M4 a one-line migration per codec.

**Spec AC:** [AC-3](spec.md#ac-3-columnfor-and-jsoncodec-ship-the-documented-surface).

### Tasks

1. **`columnFor(codec)`** in `@prisma-next/contract-ts` (or `@prisma-next/framework-components`; see open question 2). Type-discriminated; runtime validation against `paramsSchema`. — [design](design/authoring-ergonomics.md#the-columnfor-helper)
2. **`jsonCodec(schema)`** built on `parameterizedCodec`; its `OutputType` projects `StandardSchemaV1.InferOutput<S>`. — [design](design/authoring-ergonomics.md#jsoncodec-helper)
3. **Tests**:
   - Type tests for both modes of `columnFor`.
   - Type tests for `jsonCodec` inference flowing from a user-provided schema.
   - Runtime tests for `paramsSchema` validation throwing on bad input.

### Acceptance gate

- [ ] AC-3 cases pass.
- [ ] `pnpm test:packages` and `pnpm typecheck` green.
- [ ] No production codec migrated yet — production still uses old factories.

---

## M4 — Migrate parameterized codecs

**Goal:** Move every codec that currently implements optional `renderOutputType?` to `parameterizedCodec({…})` with a co-located `OutputType` and a `columnFor(codec)` factory export.

**Spec AC:** [AC-2](spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly) (now with production codecs), [AC-4](spec.md#ac-4-existing-parameterized-codecs-migrated).

### Tasks (independently mergeable)

1. **pgvector** — define `VectorOutputType`; migrate `pgVectorCodec` to `parameterizedCodec`; replace `vector(length)` with `columnFor(pgVectorCodec)` (or alias).
2. **postgres-core** — for each parameterized codec (numeric, timestamp, timestamptz, char if present, json/jsonb): define `<…>OutputType`, migrate, replace factory.
3. **mongo codecs** — same pattern.
4. **Examples and integration tests** — update demo schemas to use `columnFor(codec)`; verify integration tests stay green.
5. **Emit-snapshot diff** — re-emit every contract; assert byte-identical against M0.3 snapshots.

### Acceptance gate

- [ ] AC-2 with production codecs (pgvector `Vector<1536>`, char(N), JSON-with-schema).
- [ ] AC-4 (all migrated; factories replaced or aliased).
- [ ] Emit snapshots byte-identical against the M0.3 baseline.
- [ ] `pnpm test:packages` green.

If the diff in any sub-task balloons, split into separate PRs by codec family.

---

## M5 — Cleanup base `Codec` (hard cut)

**Goal:** Remove parameterization fields from base `Codec`. Safe now because every codec that needed them has migrated.

**Spec AC:** [AC-5](spec.md#ac-5-base-codec-is-clean), [AC-7](spec.md#ac-7-build-performance-acceptable) (final).

### Tasks

1. **Remove `paramsSchema?`, `renderOutputType?`, `init?`** from the base `Codec` interface in `@prisma-next/framework-components` and the SQL extension. Hard cut, no deprecation.
2. **Confirm zero callers** of the removed fields on base-`Codec` instances (`rg`-driven sweep).
3. **Re-emit and diff** every contract; assert byte-identical against the M0.3 snapshots.
4. **Re-measure typecheck** for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts`; assert within ±20% of M0.3 baseline.

### Acceptance gate

- [ ] AC-5: base `Codec` is clean; `pnpm typecheck` and `pnpm lint:deps` workspace-wide pass.
- [ ] AC-7: typecheck within ±20% of baseline.
- [ ] Emit snapshots still byte-identical.

---

## M6 — Documentation and close-out

**Goal:** Long-lived docs in `docs/`; `projects/codec-model-unification/` deleted.

**Spec AC:** [AC-8](spec.md#ac-8-documentation-lands).

### Tasks

1. **ADR** under `docs/architecture docs/adrs/` extending [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). Decision, rationale (pulled from this project's design docs), consequences for pack-author surface and future runtime work.
2. **Subsystem doc** under `docs/architecture docs/subsystems/` (codec subsystem) updated to reflect the split.
3. **Pack-author README sections** in the package(s) hosting `parameterizedCodec`, `columnFor`, `jsonCodec`. Cover `storage.types`/`typeRef` guidance.
4. **Migrate or strip** any project content with long-lived value into `docs/`.
5. **Strip repo-wide references** to `projects/codec-model-unification/**`.
6. **Delete** `projects/codec-model-unification/`.

### Acceptance gate

- [ ] ADR merged.
- [ ] Subsystem doc and package READMEs updated.
- [ ] No surviving repo references to the project path.
- [ ] `projects/codec-model-unification/` deleted.

---

## Risks and mitigations

- **`OutputType` cast scope creep.** A single `as unknown as <PerCodecOutputType>` per parameterized codec is the only allowed cast. The design docs enumerate this rule; reviewers veto wider casts.
- **TS depth limits with deep `Apply` chains.** `Apply<F, P>` is an intersection-then-index conditional; cheap. Deep `StandardSchemaV1.InferOutput` chains for large schemas may hit TS recursion limits — this is a TS limitation users hit independently of this project. Fall-back: `renderOutputType` can return `'unknown'` for the emit path while the no-emit path keeps the precise inference.
- **Emit-path regression.** AC-4 and AC-5 enforce byte-identical snapshots verified against the M0.3 baseline.
- **`init` signature locks something we'd want to change.** Mitigated by keeping `instanceMeta` to the minimum necessary for known consumers (CipherStash G1) and by leaving the runtime contract documented in [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md), not enforced.
- **Standard Schema validator wiring.** Existing arktype validators implement Standard Schema; M1 task 4 is a type widening only.
- **#374 merge churn.** Rebase strategy in [design/runtime-contract-and-compatibility.md#rebase-strategy](design/runtime-contract-and-compatibility.md#rebase-strategy).
