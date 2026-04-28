# Summary

Make the no-emit path resolve parameterized field types to their precise branded TypeScript types (e.g. `Vector<1536>`, schema-inferred JSON shapes) by promoting parameterization to a first-class shape on the codec interface. Adds `ParameterizedCodec` with a co-located type-level brand, a unified `columnFor` authoring helper, and Standard-Schema-driven JSON inference; rewrites the no-emit `FieldOutputType` against the brand. Resolves [TML-2229](https://linear.app/prisma-company/issue/TML-2229) by addressing the underlying design rather than the surface symptom.

# Description

The contract-first data layer has two paths from authoring to the typed surface:

1. **Emit path** — `pnpm emit` walks the contract, calls `Codec.renderOutputType(typeParams)`, writes a fully-resolved `contract.d.ts`. Already correct after [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).
2. **No-emit path** — the user imports the contract definition directly; `FieldOutputTypes<Definition>` is computed at the type level. Currently looks up `CodecTypes[id]['output']` and ignores `typeParams`. So `vector(1536)` resolves to `number[]` instead of `Vector<1536>`, and a JSON column with a narrowed schema resolves to `JsonValue` instead of the schema's inferred shape.

ADR 186 explicitly deferred the no-emit fix to this work. The fix is small once the codec interface carries a type-level brand, and the interface change cleans up several adjacent concerns at once: the optional-fields-on-base-`Codec` smell, the per-extension hand-rolled column factories, and the implicit-and-broken runtime contract for `init`.

For design rationale, worked examples, and forward-looking compatibility, see:

- [design/codec-interface-and-brand.md](design/codec-interface-and-brand.md) — interface split, brand mechanism, no-emit `FieldOutputType` rewrite
- [design/authoring-ergonomics.md](design/authoring-ergonomics.md) — `columnFor`, `jsonCodec`, `storage.types`/`typeRef`, pack-author guidance
- [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md) — per-instance materialization contract; downstream extension compatibility (CipherStash G1, [TML-2330](https://linear.app/prisma-company/issue/TML-2330))

# Linear

[TML-2229](https://linear.app/prisma-company/issue/TML-2229) — original framing was narrow ("restore parameterized output types in StagedFieldOutputTypes"); we re-scoped to address the underlying design.

# Project base

Branched from `origin/worktree/op-registry-ts` ([PR #374](https://github.com/prisma/prisma-next/pull/374)). Once #374 merges to `main`, rebase to `origin/main`.

# Requirements

## Functional Requirements

### FR1 — `ParameterizedCodec` interface

Add a `ParameterizedCodec` interface that extends `Codec`, with `paramsSchema`, `renderOutputType`, and `Brand` required. Optional `init?` (signature in FR8). A factory `parameterizedCodec({…})` enforces the requirements at the type level.

Detail: [design/codec-interface-and-brand.md#the-parameterizedcodec-interface](design/codec-interface-and-brand.md#the-parameterizedcodec-interface)

### FR2 — Type-level brand co-located with the codec

Each parameterized codec defines a `CodecBrand` next to its implementation. The codec carries the brand as a phantom `readonly Brand` field. Brand application at the type level (`Apply<Brand, Params>`) is the type-level twin of `renderOutputType` at runtime.

Detail: [design/codec-interface-and-brand.md#the-brand-mechanism](design/codec-interface-and-brand.md#the-brand-mechanism)

### FR3 — Standard-Schema params, JSON-codec helper

`paramsSchema: StandardSchemaV1<Params>` (replacing the current arktype-only `Type<TParams>`). A `jsonCodec(schema)` helper accepts any Standard Schema and infers the JSON output type from the user-supplied schema.

Detail: [design/authoring-ergonomics.md#json-codec-helper](design/authoring-ergonomics.md#json-codec-helper)

### FR4 — `columnFor` authoring helper

`columnFor(codec)` is type-discriminated: parameterized codecs return `(params) => ColumnTypeDescriptor & { typeParams: Params }`; non-parameterized codecs return the descriptor directly. Replaces hand-rolled per-codec factories.

Detail: [design/authoring-ergonomics.md#the-columnfor-helper](design/authoring-ergonomics.md#the-columnfor-helper)

### FR5 — No-emit `FieldOutputType` rewrite

Rewrite `FieldOutputType` in [packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts) so it consults `Apply<Brand, typeParams>` when the codec is parameterized; falls back to the base output type otherwise. Preserves nullability. Resolves `typeRef` indirection through `storage.types`.

Detail: [design/codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype](design/codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype)

### FR6 — Migrate existing parameterized codecs

Convert codecs that currently implement the optional `renderOutputType?` to `ParameterizedCodec` with co-located brands: pgvector, postgres-core (`numeric`, `timestamp(tz)`, `json`, `jsonb`, `char` if present), mongo codecs. Per-codec factories replaced with `columnFor(codec)` exports.

### FR7 — Remove parameterization fields from base `Codec`

Once FR6 lands, remove `paramsSchema?`, `init?`, `renderOutputType?` from the base `Codec` interface in [packages/1-framework/1-core/framework-components/src/codec-types.ts](../../packages/1-framework/1-core/framework-components/src/codec-types.ts) and the SQL extension. They live exclusively on `ParameterizedCodec`. Hard cut, no deprecation.

### FR8 — `init(params, instanceMeta)` signature

`init?` on `ParameterizedCodec` accepts a second arg carrying instance metadata:

```typescript
readonly init?: (
  params: Params,
  instance: {
    readonly name: string;
    readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
  },
) => Helper;
```

The signature is declared and exposed; runtime rewiring of the context builder to call `init` per `StorageTypeInstance` is **out of scope** (see Non-goals). Locks the shape so future runtime work and downstream extensions (CipherStash G1, [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) consume a stable surface.

Detail: [design/codec-interface-and-brand.md#init-signature](design/codec-interface-and-brand.md#init-signature) (signature); [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md) (runtime contract).

## Non-Functional Requirements

- **Typesafety rules** ([AGENTS.md](../../AGENTS.md)): no `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`, no biome suppressions. Type casts minimized; the one `as unknown as Brand` cast per codec is justified by a comment.
- **No backwards-compatibility shims**. Base `Codec` drops parameterization fields; downstream consumers update.
- **Layering**: `Codec`, `ParameterizedCodec`, `CodecBrand`, `Apply` belong at the framework-components layer. `columnFor` lives in contract authoring. `pnpm lint:deps` passes.
- **Build perf**: typecheck of `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts` within ±20% of the pre-change baseline.
- **No global declaration merging.** Brands are co-located on the codec.
- **No in-house JSON Schema → TS converter.** Inference comes from the user's Standard Schema.

## Non-goals

- **Runtime rewiring of per-instance materialization.** FR8 declares the `init(params, instanceMeta)` shape; the runtime context builder calling `init` once per `StorageTypeInstance` and routing encode/decode through the named helper is a follow-up. Tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330). See [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md).
- **Other codec interface slots**: `bulkEncode` (CipherStash G4), `AbortSignal` (G10), redaction traits (G9, [TML-2329](https://linear.app/prisma-company/issue/TML-2329)), `preferParam` (G6). Each is an orthogonal slot that the `ParameterizedCodec` shape doesn't preclude. Out of scope here. See [design/runtime-contract-and-compatibility.md#explicit-out-of-scope-extension-points](design/runtime-contract-and-compatibility.md#explicit-out-of-scope-extension-points).
- **PSL-side authoring of parameterized types.** This project addresses the TS-authored contract path. PSL parsing already lands `typeParams` on the descriptor.
- **`ComputeColumnJsType` rework.** Already delegates to `ExtractFieldOutputTypes<Contract>`; picks up the fix transparently.
- **Migration-planner input plumbing** (CipherStash G2/G3). Same `(table, column)` pattern through `storage.types`, but on the migration plane. Out of scope.
- **Deeper runtime validation at column construction.** `columnFor(codec)(params)` validates inline params against `paramsSchema`. Sanity-checking `typeRef` at column declaration is out of scope.
- **Publishing the codec model as a stable external API.** Internal until pack-author docs land in a follow-up.

# Acceptance Criteria

### A1. `ParameterizedCodec` and brand mechanism

- [ ] `ParameterizedCodec`, `CodecBrand`, `Apply<B, P>` exist and are exported from framework-components.
- [ ] `parameterizedCodec({…})` factory exists.
- [ ] Type test: `Apply<VectorBrand, { length: 1536 }>` ≡ `Vector<1536>`.
- [ ] Compile error: omitting `paramsSchema`, `renderOutputType`, or `Brand` from `parameterizedCodec({…})` fails.
- [ ] Compile error: `Brand['Input']` not assignable from `Params` fails.

### A2. Standard-Schema params and JSON codec

- [ ] `paramsSchema: StandardSchemaV1<Params>`; existing arktype callers continue to typecheck (Arktype implements Standard Schema).
- [ ] `jsonCodec(schema)` helper exists; output infers via `StandardSchemaV1.InferOutput<S>`.
- [ ] Type test: a JSON column declared with an Arktype schema resolves to the schema's TS type in the no-emit path.

### A3. `columnFor` helper

- [ ] `columnFor(nonParamCodec)` returns a descriptor.
- [ ] `columnFor(paramCodec)(params)` returns a descriptor with literal-preserved `typeParams`.
- [ ] Bad params fail typecheck.
- [ ] Runtime validation against `paramsSchema` throws on failure.

### A4. No-emit `FieldOutputType` resolves brands

- [ ] Inline `vector(1536)` column → `Vector<1536>`.
- [ ] `typeRef: 'Embedding1536'` (where `storage.types['Embedding1536']` is `vector(1536)`) → `Vector<1536>`.
- [ ] JSON column declared via `columnFor(jsonCodec)({ schema })` → schema's inferred type.
- [ ] Non-parameterized columns unchanged.
- [ ] Nullability preserved (`Vector<1536> | null` for nullable columns).
- [ ] `ComputeColumnJsType` returns brand-resolved types for the same fixtures.

### A5. Migration of existing parameterized codecs

- [ ] pgvector migrated.
- [ ] postgres-core codecs that previously implemented `renderOutputType?` migrated.
- [ ] mongo codecs that previously implemented `renderOutputType?` migrated.
- [ ] Per-codec factories replaced with `columnFor(...)`.
- [ ] Existing tests pass; emit-path snapshots byte-identical.

### A6. Base `Codec` cleanup

- [ ] `paramsSchema?`, `init?`, `renderOutputType?` removed from the base `Codec` interface.
- [ ] `pnpm typecheck` passes across the workspace.
- [ ] `pnpm lint:deps` passes.

### A7. `init(params, instanceMeta)` signature (shape only)

- [ ] `init?` on `ParameterizedCodec` accepts `(params, instanceMeta)`.
- [ ] Type test: a parameterized codec defining `init` typechecks against the new signature.
- [ ] No runtime context-builder change in this project (verified by no failing tests outside the codec interface scope).

### A8. Build performance

- [ ] Typecheck of `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts` within ±20% of the pre-change baseline (recorded in `assets/typecheck-baseline.md` during M0).

### A9. Documentation

- [ ] Three project design docs maintained throughout execution.
- [ ] Pack-author README section in the package hosting `parameterizedCodec` and `columnFor`.
- [ ] ADR finalized under `docs/architecture docs/adrs/`, extending [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).
- [ ] Codec subsystem doc in `docs/architecture docs/subsystems/` updated.
- [ ] Project design docs migrated to `docs/` or stripped at close-out.

# References

- [ADR 186 — Codec-dispatched type rendering](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)
- [TML-2229](https://linear.app/prisma-company/issue/TML-2229)
- [PR #374 — feat(operations): author sql operations as TypeScript functions](https://github.com/prisma/prisma-next/pull/374)
- [TML-2329](https://linear.app/prisma-company/issue/TML-2329) — trait-gated redaction (CipherStash G9 follow-up)
- [TML-2330](https://linear.app/prisma-company/issue/TML-2330) — column-context plumbing + codec concurrency (CipherStash G1, G4 follow-up)
- [Standard Schema spec](https://github.com/standard-schema/standard-schema)
- Project assets: [assets/cipherstash-ext-framework-gaps.md](assets/cipherstash-ext-framework-gaps.md)

# Open Questions

Project-level questions affecting what we ship. Detail-level questions are deferred to the design docs.

1. **Anonymous instance materialization.** When a column carries inline `typeParams` (no `typeRef`), does the runtime materialize an anonymous instance, require promotion to `storage.types`, or accept either? Affects the runtime-contract design but not this project's deliverables. Resolved during M1 in [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md).

2. **Where does `parameterizedCodec()` live?** Default: `@prisma-next/framework-components` so Mongo benefits too, with SQL/Mongo factories thinly wrapping it. Override only if layering forbids. Resolved during M1.

3. **Brand storage shape.** Default: declared `readonly Brand` carrying a single justified `as unknown as Brand` cast (discoverable, surfaces in autocomplete). Alternative: phantom `_brand?` slot (cleaner, less discoverable). Resolved during M1.
