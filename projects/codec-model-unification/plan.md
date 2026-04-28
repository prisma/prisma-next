# Plan — Codec model unification

This plan delivers the requirements in [spec.md](spec.md). Each milestone has acceptance gates that map back to spec acceptance criteria.

For design rationale and rejected alternatives, see the design docs:

- [design/codec-interface-and-brand.md](design/codec-interface-and-brand.md)
- [design/authoring-ergonomics.md](design/authoring-ergonomics.md)
- [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md)

## Milestones at a glance

- **M0** Project shaping (this milestone produces the artifacts being read now)
- **M1** Brand mechanism + `ParameterizedCodec` (no migration, no consumers yet)
- **M2** No-emit `FieldOutputType` rewrite (against the new brand)
- **M3** `columnFor` and `jsonCodec` authoring helpers
- **M4** Migrate existing parameterized codecs (pgvector, postgres-core, mongo)
- **M5** Cleanup base `Codec` (remove parameterization fields, hard cut)
- **M6** Documentation finalization + close-out

Each milestone is implemented in a focused PR. PRs are reviewable independently except where dependency requires sequencing.

---

## M0 — Project shaping

**Goal:** Spec, plan, and design docs in place; baseline measurements captured.

### M0.1 — Spec & plan

- Initial `spec.md` and `plan.md` (committed earlier in this branch).
- Tightened `spec.md` to point at design docs for rationale (this commit).

### M0.2 — Design docs

Three design docs under `projects/codec-model-unification/design/`:

- `codec-interface-and-brand.md` — interface split, brand mechanism, no-emit rewrite, rejected alternatives.
- `authoring-ergonomics.md` — `columnFor`, `jsonCodec`, `storage.types`/`typeRef`, worked examples, pack-author guidance.
- `runtime-contract-and-compatibility.md` — declared per-instance materialization contract, CipherStash overlap, explicit out-of-scope extension points, rebase strategy.

### M0.3 — Baseline measurements

- Run `pnpm typecheck` for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts`; record durations in `assets/typecheck-baseline.md`.
- Note current emit snapshot count to confirm A8 (snapshots byte-identical) is meaningful.

### M0 acceptance

- [ ] `spec.md` lean (requirements + AC, design pointed at design docs).
- [ ] Three design docs committed and cross-linked from `spec.md` and `plan.md`.
- [ ] Baseline timings recorded.
- [ ] Linear ticket [TML-2229](https://linear.app/prisma-company/issue/TML-2229) updated to point at this project; follow-up tickets ([TML-2329](https://linear.app/prisma-company/issue/TML-2329), [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) created with cross-links.

---

## M1 — Brand mechanism + `ParameterizedCodec`

**Goal:** Add the new types and factory. No migrations, no consumers. PR is small and reviewable in isolation.

**Spec mapping:** FR1, FR2, FR3 (params schema only), FR8 (`init` signature). Acceptance: A1, A2 (`paramsSchema` shape), A7.

### M1.1 — Add `CodecBrand` and `Apply<B, P>`

In `@prisma-next/framework-components`:

```typescript
export interface CodecBrand<Params = unknown> {
  readonly Input: Params;
  readonly Output: unknown;
}

export type Apply<B extends CodecBrand, P> = (B & { readonly Input: P })['Output'];
```

Co-locate with the existing `Codec` interface. Add type tests under the package's test surface verifying `Apply` is a type-level function.

### M1.2 — Add `ParameterizedCodec`

```typescript
export interface ParameterizedCodec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
  TParams = Record<string, unknown>,
  TBrand extends CodecBrand<TParams> = CodecBrand<TParams>,
  THelper = unknown,
> extends Codec<Id, TTraits, TWire, TJs> {
  readonly paramsSchema: StandardSchemaV1<TParams>;
  readonly renderOutputType: (params: TParams) => string;
  readonly Brand: TBrand;
  readonly init?: (
    params: TParams,
    instance: {
      readonly name: string;
      readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
    },
  ) => THelper;
}
```

`paramsSchema` typed as `StandardSchemaV1<TParams>` (FR3 type-side; arktype-only validation behavior remains until M1.3).

### M1.3 — `parameterizedCodec({…})` factory

The factory enforces the required fields at the type level. The single justified `as unknown as TBrand` cast lives here (or in the codec body; see open question 3 in spec).

### M1.4 — Wire `paramsSchema` validation

Validation entry points (`columnFor` in M3, contract canonicalization where it already runs against `paramsSchema`) accept `StandardSchemaV1`. No behavior change beyond the type widening.

### M1 acceptance

- [ ] A1 (interface and `Apply` type tests pass).
- [ ] A7 (`init` signature shape).
- [ ] `pnpm typecheck` passes; `pnpm lint:deps` passes.
- [ ] No production callers yet — types exist alongside the existing optional fields on base `Codec`.

---

## M2 — No-emit `FieldOutputType` rewrite

**Goal:** Rewrite the type-level resolver against the new brand. Unblocked by M1 even though no codec implements `Brand` yet (a synthetic test fixture proves the wiring).

**Spec mapping:** FR5. Acceptance: A4.

### M2.1 — Test fixture: `paramVectorCodec`

A test-only `ParameterizedCodec` with a known brand under `packages/2-sql/2-authoring/contract-ts/src/__tests__/fixtures/`. Used to assert `FieldOutputType` resolves to the correct branded type without depending on pgvector or any other extension.

### M2.2 — Rewrite `FieldOutputType`

In [packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts):

- Resolve `typeRef` indirection through `storage.types` first.
- Detect `Brand extends CodecBrand` on the codec entry.
- Apply: `Apply<Brand, typeParams>`; fall back to `CodecTypes[id]['output']` if no brand.
- Preserve nullability.

Detail: [design/codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype](design/codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype).

### M2.3 — Type tests

- Inline `typeParams` resolves to brand.
- `typeRef` resolves to brand.
- Non-parameterized columns unchanged.
- Nullability preserved.
- `ComputeColumnJsType` resolves to brand (transparent via delegation).

### M2 acceptance

- [ ] A4 (all type-test cases pass).
- [ ] Existing `pnpm test:packages` green for `@prisma-next/contract-ts`.
- [ ] No production codec migrated yet.

---

## M3 — `columnFor` and `jsonCodec` authoring helpers

**Goal:** Pack-author surface that replaces hand-rolled per-codec factories and gives JSON columns first-class schema-driven inference.

**Spec mapping:** FR3 (json helper), FR4. Acceptance: A2, A3.

### M3.1 — `columnFor(codec)`

Type-discriminated:

- `codec extends ParameterizedCodec<…>` → `(params: Params) => ColumnTypeDescriptor<typeParams: Params>`.
- otherwise → `ColumnTypeDescriptor`.

Validates inline `params` against `paramsSchema` at runtime; throws with a clear error message on failure.

Detail: [design/authoring-ergonomics.md#the-columnfor-helper](design/authoring-ergonomics.md#the-columnfor-helper).

### M3.2 — `jsonCodec(schema)`

Wraps the existing JSON codec; threads through `StandardSchemaV1.InferOutput<S>` as the codec's brand-applied type.

Detail: [design/authoring-ergonomics.md#json-codec-helper](design/authoring-ergonomics.md#json-codec-helper).

### M3.3 — Tests

- Type tests for both modes of `columnFor`.
- Type tests confirming JSON inference flows from a user-provided schema.
- Runtime tests for `paramsSchema` validation behavior.

### M3 acceptance

- [ ] A2, A3.
- [ ] `pnpm test:packages` and `pnpm typecheck` green.
- [ ] No migration yet — production codecs still use their old factories.

---

## M4 — Migrate existing parameterized codecs

**Goal:** Move every codec that currently implements optional `renderOutputType?` to `ParameterizedCodec` with co-located brands and a `columnFor` factory export.

**Spec mapping:** FR6. Acceptance: A4 (now with real codecs), A5.

### M4.1 — pgvector

- `Vector<N>` brand co-located with `pgVectorCodec`.
- `pgVectorCodec` migrated to `parameterizedCodec({…})`.
- Replace `vector(length)` factory with `columnFor(pgVectorCodec)`.
- Update extension's exports to expose both the codec and the column factory.

### M4.2 — postgres-core

For each parameterized codec (numeric, timestamp, timestamptz, char if present, json/jsonb):

- Define brand.
- Migrate to `parameterizedCodec`.
- Replace per-codec factory with `columnFor(...)`.

### M4.3 — mongo codecs

Same pattern.

### M4.4 — Examples & integration tests

Update demo schemas / examples to use the unified `columnFor` form. Verify integration tests stay green.

### M4 acceptance

- [ ] A4 with production codecs (pgvector `Vector<1536>`, char(N), JSON-with-schema).
- [ ] A5 (all migrated, factories replaced).
- [ ] Emit-path snapshots byte-identical (A8 partially verified here; final verification in M5).
- [ ] `pnpm test:packages` green.

---

## M5 — Cleanup base `Codec` (hard cut)

**Goal:** Remove parameterization fields from base `Codec`. Now safe because every codec that needed them has migrated.

**Spec mapping:** FR7. Acceptance: A6, A8 (final).

### M5.1 — Remove `paramsSchema?`, `init?`, `renderOutputType?` from base `Codec`

In `@prisma-next/framework-components` and the SQL extension's `Codec` interface.

### M5.2 — Confirm zero callers

`rg` confirms no surviving references on base-`Codec` instances. Any caller that needs them now uses `ParameterizedCodec` or the codec's narrowed type.

### M5.3 — Final emit-snapshot diff

Run emit across the demo and example contracts; assert byte-identical output.

### M5 acceptance

- [ ] A6 (base `Codec` clean).
- [ ] A8 (typecheck within ±20%).
- [ ] Emit snapshots byte-identical.
- [ ] `pnpm typecheck` and `pnpm lint:deps` pass.

---

## M6 — Documentation finalization + close-out

**Goal:** Long-lived docs in `docs/`, project artifacts gone, ADR finalized.

**Spec mapping:** A9.

### M6.1 — ADR

Author ADR under `docs/architecture docs/adrs/` extending [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md):

- Decision: split `Codec` and `ParameterizedCodec`; co-located brands; `columnFor` and `jsonCodec`; `init(params, instanceMeta)` shape declared with runtime rewiring deferred.
- Rationale: pulls from the project's design docs.
- Consequences: pack-author API surface, future runtime rewiring path, downstream extension fit.

### M6.2 — Subsystem docs

Update `docs/architecture docs/subsystems/` (codec subsystem) and the relevant package READMEs:

- Pack-author README sections on `parameterizedCodec`, `columnFor`, `jsonCodec`, `storage.types`/`typeRef`.
- Code-level pointers to the new types.

### M6.3 — Strip and close out

- Migrate any long-lived design content into `docs/`.
- Strip repo-wide references to `projects/codec-model-unification/**`.
- Delete `projects/codec-model-unification/`.

### M6 acceptance

- [ ] ADR merged.
- [ ] Subsystem docs and package READMEs updated.
- [ ] `projects/codec-model-unification/` deleted.
- [ ] No surviving references in the repo to the project path.

---

## Sequencing & PRs

Default mapping (one PR per milestone) keeps each PR small. M2 can ship before M3 because the synthetic fixture proves `FieldOutputType` independently. M4 is the largest PR; it can be split per codec family if the diff grows.

## Risks & mitigations

- **Brand cast scope creep.** Single `as unknown as Brand` per codec; design doc enumerates the rule. Reviewers veto wider casts.
- **Standard Schema validator wiring.** Existing arktype validators implement Standard Schema; no behavior change expected. M1.4 limited to the type widening.
- **Emit-path regression.** A8 enforces byte-identical snapshots; verified at M4 and again at M5.
- **`init(params, instanceMeta)` shape locks in something we'd want to change later.** Mitigated by limiting the shape to the minimum necessary for known consumers (CipherStash G1) and by leaving the runtime contract documented in the design doc rather than enforced.
