# Spec — Codec model unification

## Decision

Promote parameterization from a sprinkle of optional fields on the base `Codec` interface to a first-class shape called `ParameterizedCodec`, with a co-located type-level brand. Use that brand to fix the no-emit path's field-type resolution. Ship a unified `columnFor` authoring helper and a `jsonCodec(schema)` helper at the same time, since they fall out cleanly from the new shape and remove parallel boilerplate. Declare (but don't implement) a `init(params, instanceMeta)` contract that a runtime follow-up will consume.

In one diagram:

```text
                         BEFORE                                      AFTER
─────────────────────────────────────────────────       ─────────────────────────────────────────────────
Codec<Id, Traits, Wire, Js>                             Codec<Id, Traits, Wire, Js>      ParameterizedCodec<…, Params, Brand>
  paramsSchema?: Type<…>          ──── all optional       (no parameterization fields)     paramsSchema:    StandardSchemaV1<Params>
  renderOutputType?(params): str  ──── always present                                      renderOutputType(params): string
  init?(params): Helper           ──── for some codecs                                     Brand:           CodecBrand<Params>
                                                                                            init?(params, instanceMeta): Helper

Per-codec column factories                              One factory:
  vector(N), char(N), numeric(p,s)  …                     columnFor(codec)[(params)]

JSON columns                                            JSON columns
  output type = JsonValue                                 output type = StandardSchemaV1.InferOutput<schema>

No-emit FieldOutputType<Definition>                     No-emit FieldOutputType<Definition>
  reads CodecTypes[id]['output']                          reads codec.Brand, applies typeParams (or schema)
  ignores typeParams  ← TML-2229 bug                      follows typeRef through storage.types
```

## Why

Two motivations, one fix.

**The bug** — [TML-2229](https://linear.app/prisma-company/issue/TML-2229). The no-emit path (`FieldOutputTypes<Definition>` computed at the type level, no `pnpm emit` step) ignores `typeParams`, so a `vector(1536)` column resolves to `number[]` instead of `Vector<1536>`, and a JSON column with a narrowed schema resolves to `JsonValue` instead of the schema's inferred shape. [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) explicitly deferred this fix. The fix needs a way for the type system to find a function-from-`params`-to-output-type per codec — i.e. a *brand*.

**The cleanup that comes with it** — once we add a brand to a codec, the parameterization-related fields stop being optional for codecs that have them and stop existing for codecs that don't. Splitting the interface formalizes that. The split also makes the per-codec column factories (`vector(N)`, `char(N)`, …) collapse into a single `columnFor(codec)` and lets us give JSON columns the schema-driven inference they've never had. Doing this once is cheaper than threading a brand through the optional-fields shape and then revisiting the same code to clean it up.

The same shape change also lets us declare a stable `init(params, instanceMeta)` signature that downstream extensions (CipherStash) and a future runtime rewiring ([TML-2330](https://linear.app/prisma-company/issue/TML-2330)) can author against. Locking the signature now is free; locking it wrong and migrating later is not.

## Glossary

| Term | Meaning |
|---|---|
| **Emit path** | `pnpm emit` walks the contract and writes a fully-resolved `contract.d.ts`. Already correct after [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). |
| **No-emit path** | Authoring code imports the contract definition directly; output types are computed at the type level by `FieldOutputTypes<Definition>`. The site of the bug. |
| **`renderOutputType`** | Runtime method on a parameterized codec returning a TS-source string for the emit path (e.g. `({length}) => `Vector<${length}>``). Used by the emitter. |
| **Brand** (`CodecBrand`) | Type-level twin of `renderOutputType`. A type-level function from `Params` to the codec's output type, defined next to the codec. Consumed by `FieldOutputType` in the no-emit path. |
| **`Apply<B, P>`** | Applies a brand `B` to params `P`, yielding the resolved output type. Type-level. |
| **`columnFor`** | Single authoring helper that turns any codec into a column-descriptor factory. Replaces per-codec factories. |
| **`storage.types`** | Existing contract IR registry of *named* parameterized type instances (e.g. `Embedding1536: vector(1536)`). |
| **`typeRef`** | Existing column property pointing at a `storage.types` entry by name (alternative to inline `typeParams`). |
| **`init`** | Optional codec hook that runs once per `storage.types` instance to derive per-instance state from params and `(table, column)` context. Signature locked here; runtime dispatch is [TML-2330](https://linear.app/prisma-company/issue/TML-2330). |

## Cases that pin the design

These are the concrete codecs the design must support end-to-end. They are the test the design has to pass; together they constrain the moving parts. Each design decision in [How it works](#how-it-works) is justified against at least one of these cases, and each design doc traces back to them.

### Case V — Vector (literal-typed numeric param)

Worked code: [authoring-ergonomics.md#case-v--vector-literal-typed-numeric-param](design/authoring-ergonomics.md#case-v--vector-literal-typed-numeric-param).

A user writes `vector({ length: 1536 })`. The column's TS type resolves to `Vector<1536>` (not `number[]`) in both the emit path and the no-emit path. The codec author writes `pgVectorCodec` once: one `paramsSchema`, one `renderOutputType`, one `Brand`. No per-codec column factory. Same shape pins `char(N)`, `numeric(p, s)`, `timestamp(N)`.

What this case pins:

- The brand is a type-level function from `Params` to output type. Literal numeric inference must flow through.
- `columnFor(codec)({…})` preserves literals.
- Emit and no-emit paths agree on the resolved type.

### Case J — JSON-with-schema

Output type derived from a schema *value* (not a literal). Worked code: [authoring-ergonomics.md#case-j--json-with-schema](design/authoring-ergonomics.md#case-j--json-with-schema).

A user writes `columnFor(jsonCodec)({ schema: ProductSettings })` where `ProductSettings` is an Arktype / Zod / Valibot schema. The column's TS type resolves to the schema's `InferOutput`. The same schema validates wire payloads at runtime. We do not ship a JSON-Schema → TS converter.

What this case pins:

- `paramsSchema: StandardSchemaV1<…>` — any Standard-Schema-compliant library acts as a param.
- The brand HKT must be able to project a type *out of* one of its inputs (`infer S extends StandardSchemaV1` then `InferOutput<S>`), not just transform a literal.
- `jsonCodec` must be a `ParameterizedCodec` like any other; nothing JSON-specific in the framework.

### Case C — CipherStash column-scoped encryption

`init` must carry column context. Worked code: [runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption](design/runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption).

A CipherStash codec encrypts column values with a key derived from `(table, column)` plus contract-level config. Authoring it requires `init(params, instance)` where `instance` exposes the columns served by the codec. **Runtime dispatch through the per-instance helper is deferred to [TML-2330](https://linear.app/prisma-company/issue/TML-2330)**; this project locks the signature so CipherStash can author against a stable surface today. A subcase, `encryptedJson<T>(schema)`, composes Case J with this one (encrypted column whose plaintext type is the schema's `InferOutput`).

What this case pins:

- `init`'s second argument shape: `{ name, usedAt: ReadonlyArray<{ table, column }> }`.
- `storage.types` instance keying — columns sharing a `typeRef` share the helper that `init` returns.
- Anonymous instances for inline `typeParams` — single-column ergonomics still work.
- The brand mechanism applies even when the codec output type is the *plaintext* type (encryption invisible at the type level). The compound `encryptedJson<T>` case proves the brand and `init` compose.

## How it works

The design has six moving parts. Each is summarized here; details live in the design docs. Driving cases are marked.

### 1. The codec interface splits in two — driving cases: V, J, C

`Codec` keeps the pure encode/decode/traits surface. A new `ParameterizedCodec` extends it with the parameterization-related fields, all required: `paramsSchema`, `renderOutputType`, `Brand`, and an optional `init`. A `parameterizedCodec({…})` factory enforces the requirements at the type level.

→ Detail and rejected alternatives in [design/codec-interface-and-brand.md](design/codec-interface-and-brand.md).

### 2. Each parameterized codec carries a co-located type-level brand — driving cases: V, J

A `CodecBrand` is a TypeScript "type-level function" using the `this['Input']` HKT idiom. Each parameterized codec defines one next to its implementation:

```typescript
interface VectorBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number } ? Vector<N> : never;
}
```

`Apply<VectorBrand, { length: 1536 }>` evaluates to `Vector<1536>`. The codec carries the brand as a phantom `readonly Brand` field. No global declaration merging.

→ Detail in [design/codec-interface-and-brand.md#brand-mechanism](design/codec-interface-and-brand.md#brand-mechanism).

### 3. The no-emit `FieldOutputType` rewrites against the brand — driving cases: V, J, C

`FieldOutputType` in [packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts) follows `typeRef` through `storage.types`, then consults `Apply<codec.Brand, column.typeParams>` when the codec is parameterized. Falls back to the codec's base output otherwise. Nullability is preserved.

→ Detail in [design/codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype](design/codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype).

### 4. `columnFor(codec)` replaces per-codec column factories — driving cases: V, J

A single, type-discriminated helper:

```typescript
columnFor(textCodec)                              // → ColumnTypeDescriptor
columnFor(pgVectorCodec)({ length: 1536 })        // → ColumnTypeDescriptor & { typeParams: { length: 1536 } }
```

Validates inline params against the codec's `paramsSchema` at runtime. Pack authors stop hand-rolling factories; users get one mental model. Existing per-codec factories collapse into thin re-exports of `columnFor(codec)` (or vanish entirely).

→ Detail in [design/authoring-ergonomics.md#the-columnfor-helper](design/authoring-ergonomics.md#the-columnfor-helper).

### 5. `jsonCodec(schema)` types JSON columns from the user's schema — driving case: J (and the J-subcase of C)

A `ParameterizedCodec` whose `Brand` projects `StandardSchemaV1.InferOutput<S>` as the output type. Pack authors get correct inference for JSON columns without us writing a JSON-Schema-to-TS converter — the user's schema library (Arktype, Zod, Valibot, …) does it via Standard Schema.

→ Detail in [design/authoring-ergonomics.md#jsoncodec-helper](design/authoring-ergonomics.md#jsoncodec-helper).

### 6. The `init(params, instanceMeta)` signature is declared, not implemented — driving case: C

```typescript
readonly init?: (
  params: Params,
  instance: { name: string; usedAt: ReadonlyArray<{ table: string; column: string }> },
) => Helper;
```

We ship the signature, the documentation, and the `storage.types`-instance keying convention. We do not wire the runtime context builder to call `init` per instance — that's [TML-2330](https://linear.app/prisma-company/issue/TML-2330). The signature is forward-compatible with CipherStash G1 (column-scoped encryption keys) and simpler use cases (precompiled regex, cached params-derived constants).

→ Detail in [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md).

## Project base

Branched from `origin/worktree/op-registry-ts` ([PR #374](https://github.com/prisma/prisma-next/pull/374)). #374 introduces codec-typed expressions whose type-level reads of `CodecTypes` are the same seam this project's brand plugs into. Once #374 merges to `main`, rebase to `origin/main`. Rebase strategy in [design/runtime-contract-and-compatibility.md#rebase-strategy](design/runtime-contract-and-compatibility.md#rebase-strategy).

## Outcomes

The cases above are the concrete shape of what we're shipping. In framing terms:

- **TML-2229** is closed by Cases V and J working in the no-emit path.
- **[ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) follow-up** is the same Cases-V-and-J no-emit fix; emit-path output is unchanged.
- **CipherStash G1 forward-compat** is Case C: their codec authors against `init(params, instanceMeta)` today, even though the runtime side ships in [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- **CipherStash G16 forward-compat** is Case J: `encryptedJson<T>` reuses the `jsonCodec(schema)` pattern.
- **Pack-author DX** is the consequence of how Cases V and J are authored — one factory (`parameterizedCodec`), one column helper (`columnFor`), no per-codec boilerplate.

Out-of-scope items (CipherStash G4, G6, G9, G10, G2/G3) are listed under [Non-goals](#non-goals) and discussed in [design/runtime-contract-and-compatibility.md#explicit-out-of-scope-extension-points](design/runtime-contract-and-compatibility.md#explicit-out-of-scope-extension-points).

## Acceptance criteria

Observable properties grouped by area; each is a green-light gate for a milestone in [plan.md](plan.md).

### AC-1. Brand mechanism works at the type level

- `Apply<VectorBrand, { length: 1536 }>` ≡ `Vector<1536>` (and analogous for any other registered brand).
- `parameterizedCodec({…})` rejects at compile time when `paramsSchema`, `renderOutputType`, or `Brand` is missing.
- `parameterizedCodec({…})` rejects at compile time when `Brand['Input']` is not assignable from `Params`.

### AC-2. No-emit `FieldOutputType` resolves correctly

- Inline `typeParams` column: `vector({ length: 1536 })` → `Vector<1536>`.
- `typeRef` column resolves through `storage.types` to the same branded type.
- JSON column declared via `columnFor(jsonCodec)({ schema })` resolves to the schema's `InferOutput`.
- Non-parameterized columns unchanged.
- `Vector<1536> | null` for nullable columns.
- `ComputeColumnJsType` returns the brand-resolved type for the same fixtures.

### AC-3. `columnFor` and `jsonCodec` ship the documented surface

- `columnFor(nonParamCodec)` returns a descriptor; `columnFor(paramCodec)(params)` returns a descriptor with literal-preserved `typeParams`.
- Bad params fail typecheck.
- Runtime validation against `paramsSchema` throws on bad input.
- `jsonCodec` accepts any Standard Schema; existing arktype-typed callers keep typechecking.

### AC-4. Existing parameterized codecs migrated

- pgvector, postgres-core (numeric, timestamp/timestamptz, char if present, json/jsonb), and mongo codecs use `parameterizedCodec({…})` with co-located brands.
- Per-codec factories replaced (or aliased) with `columnFor(codec)`.
- Emit-path snapshots byte-identical pre/post.

### AC-5. Base `Codec` is clean

- `paramsSchema?`, `renderOutputType?`, `init?` removed from base `Codec` (framework-components and SQL extension).
- `pnpm typecheck` and `pnpm lint:deps` pass workspace-wide.

### AC-6. `init(params, instanceMeta)` signature is locked

- `init?` on `ParameterizedCodec` accepts `(params, instance)` with `instance: { name, usedAt }`.
- A codec defining `init` typechecks against the new signature.
- No runtime context-builder change in this project.

### AC-7. Build performance acceptable

- Typecheck of `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts` within ±20% of the M0 baseline (recorded in `assets/typecheck-baseline.md`).

### AC-8. Documentation lands

- ADR under `docs/architecture docs/adrs/` extending [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).
- Pack-author README section on `parameterizedCodec`, `columnFor`, `jsonCodec`, `storage.types`/`typeRef`.
- Codec subsystem doc in `docs/architecture docs/subsystems/` updated.
- Project artifacts under `projects/codec-model-unification/` removed at close-out (long-lived content migrated to `docs/`).

## Non-goals

- **Runtime rewiring of per-instance materialization.** Signature only; runtime context builder calling `init` per `storage.types` instance and routing dispatch through the helper is [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- **Other codec interface slots**: `bulkEncode` (CipherStash G4), `AbortSignal` plumbing (G10), redaction traits (G9, [TML-2329](https://linear.app/prisma-company/issue/TML-2329)), `preferParam` (G6). The interface split makes each cleaner to add later.
- **PSL-side authoring of parameterized types.** PSL parsing already lands `typeParams` on the descriptor; this project addresses the TS-authored path.
- **`ComputeColumnJsType` rework.** Already delegates to `ExtractFieldOutputTypes<Contract>`; picks up the fix transparently.
- **Migration-planner input plumbing** (CipherStash G2/G3). Same architectural pattern, different plane.
- **Sanity-checking `typeRef` at column-declaration time.** Out of scope.
- **Publishing the codec model as a stable external API.** Internal until pack-author docs land.

## Non-functional constraints

- **Typesafety rules** ([AGENTS.md](../../AGENTS.md)): no `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`, no biome suppressions. The single `as unknown as Brand` cast per parameterized codec is justified by a comment.
- **No backwards-compatibility shims**: hard cut on the base `Codec` parameterization fields.
- **Layering**: `Codec`, `ParameterizedCodec`, `CodecBrand`, `Apply` belong at the framework-components layer; `columnFor` lives in contract-authoring. `pnpm lint:deps` passes.
- **No global declaration merging.** Brands are co-located on the codec.
- **No in-house JSON-Schema → TS converter.** JSON inference comes from the user's Standard Schema.

## Open questions

Project-level questions affecting what we ship. Each has a default resolution in the design docs; they're locked at the relevant milestone.

1. **Anonymous instance materialization.** When a column carries inline `typeParams` (no `typeRef`), does the runtime materialize an anonymous `storage.types` instance, require promotion, or accept either? Default in [design/runtime-contract-and-compatibility.md#anonymous-vs-named-instances](design/runtime-contract-and-compatibility.md#anonymous-vs-named-instances): materialize anonymously with a deterministic name. Locked at M1.
2. **Where does `parameterizedCodec()` live?** Default: `@prisma-next/framework-components` (so Mongo benefits without a parallel SQL/Mongo split). Locked at M1.
3. **Brand storage shape.** Default: declared `readonly Brand` carrying a single justified `as unknown as Brand` cast (discoverable in autocomplete). Alternative: phantom `_brand?` slot (cleaner, less discoverable). Locked at M1.

## Alternatives considered

Each alternative was considered and rejected for the reasons summarized; full rationale lives in the design docs.

### Keep parameterization fields optional on the base `Codec`

Add `Brand?: CodecBrand` next to the existing optional `paramsSchema?` / `renderOutputType?` / `init?`. Smaller diff. Rejected because every consumer (emitter, validator, runtime, type resolver) keeps handling missing fields, and we forfeit the documentation value of "your codec needs parameters? extend `ParameterizedCodec`." Detail: [design/codec-interface-and-brand.md#rejected-alternatives](design/codec-interface-and-brand.md#rejected-alternatives).

### Global `CodecOutputBrands` interface with declaration merging

Each codec augments a global brand registry. Rejected for ambient global pollution, order-dependent merging, and version/identity brittleness. Detail: same link.

### Compute brand from the codec's `output` type alone, no explicit brand field

A "smart" `FieldOutputType` narrows the codec's existing `output` (e.g. `number[]`) using `typeParams`. Rejected: there's no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is exactly what `Brand` is for. Doesn't generalize to JSON-with-schema.

### Per-extension factories carry parameter awareness without a brand

Existing per-codec factories (`vector(N)`) preserve literal-typed `typeParams`. Have `FieldOutputType` consult both the column's `typeParams` and the codec's factory's return type. Rejected: TypeScript doesn't expose a factory's return type from a codec ID; doesn't unify `typeRef` and inline-`typeParams` paths; doesn't generalize.

### Implement the runtime `init` rewiring in this project

Rejected as scope creep. The runtime side has its own design surface (error handling, resource lifecycle, async helper construction) and would balloon the PR. Locking the signature is free and high-leverage; implementing the runtime is [TML-2330](https://linear.app/prisma-company/issue/TML-2330). Detail: [design/runtime-contract-and-compatibility.md#why-declare-without-implementing](design/runtime-contract-and-compatibility.md#why-declare-without-implementing).

## References

- [ADR 186 — Codec-dispatched type rendering](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)
- [TML-2229](https://linear.app/prisma-company/issue/TML-2229) — original ticket (re-scoped)
- [TML-2329](https://linear.app/prisma-company/issue/TML-2329) — trait-gated redaction (CipherStash G9 follow-up)
- [TML-2330](https://linear.app/prisma-company/issue/TML-2330) — runtime per-instance materialization + concurrency (CipherStash G1, G4 follow-up)
- [PR #374 — feat(operations): author SQL operations as TypeScript functions](https://github.com/prisma/prisma-next/pull/374)
- [Standard Schema spec](https://github.com/standard-schema/standard-schema)
- [assets/cipherstash-ext-framework-gaps.md](assets/cipherstash-ext-framework-gaps.md) — framework-gaps analysis driving forward-compatibility work
- Design docs:
  - [design/codec-interface-and-brand.md](design/codec-interface-and-brand.md)
  - [design/authoring-ergonomics.md](design/authoring-ergonomics.md)
  - [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md)
- Plan: [plan.md](plan.md)
