# Spec — Codec registry unification

> Follow-up project to [codec-model-unification](../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md). Closes structural defects in the codec registration model that the close-out review missed.

## Decision

Every codec in the framework is described by a single descriptor type:

```ts
interface CodecDescriptor<P = void> {
  readonly codecId: string;
  readonly traits: readonly CodecTrait[];
  readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;
  readonly paramsSchema: StandardSchemaV1<P>;
  readonly renderOutputType?: (params: P) => string;
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}
```

The `Codec` type narrows to a pure runtime instance: `encode`, `decode`, `encodeJson`, `decodeJson`. It stops carrying codec-id-keyed metadata (`id`, `traits`, `targetTypes`) — the descriptor is the single source of truth for those.

Every codec is registered through one slot returning `ReadonlyArray<CodecDescriptor>`. Parameterized codecs use non-empty `P`; non-parameterized codecs use `P = void` and a constant factory that returns the same shared codec instance for every column. Whether a codec id "is parameterized" stops being a registration-time distinction; it's a property of `P` on the descriptor.

The runtime exposes two APIs over the descriptor map. **`descriptorFor(codecId)`** for codec-id-keyed metadata reads (consumed by sql-orm-client trait gating, startup validation, the emit path's `renderOutputType` lookup). **`forColumn(table, column)`** for column-aware dispatch (consumed by encode and decode). Both are non-branching — every codec id resolves through the same lookup, parameterized or not.

The legacy `codecs: () => CodecRegistry` slot, the `parameterizedCodecs:` slot, and the `JsonSchemaValidatorRegistry` workaround all delete. The `Codec` interface's metadata fields move to the descriptor or fall away.

## Why

The codec-model-unification project shipped a higher-order codec model for parameterized codecs (vector, json) but left non-parameterized codecs registered through the legacy `codecs:` slot. Three concrete defects followed:

1. **A parameterized codec without parameters is structurally meaningless** but the legacy registry registers exactly that — `pgVectorRepresentativeCodec` is `vectorCodecForLength(1)(syntheticCtx)`, a placeholder length-1 vector codec that exists solely so codec-id-keyed metadata reads (`codecRegistry.get('pg/vector@1').traits`) keep working. It functions for pgvector by coincidence (vector wire format is length-independent) and would be broken for any future codec whose encode/decode actually depends on parameters.

2. **The descriptor and the legacy codec object both carry codec-id-keyed metadata** (`traits`, `targetTypes`), in different places, with no single source of truth. The same fields are duplicated; reads branch on whether the codec id is parameterized to decide which copy to consult.

3. **The `JsonSchemaValidatorRegistry` is a workaround** for the pre-codec-model-unification model where the codec object couldn't carry per-instance state. With the higher-order codec model, per-instance state lives on the resolved codec; the parallel registry is vestigial.

Codec-model-unification's intent was to eliminate the codec-as-stable-object model and make the codec a function of `(params, ctx)`. The follow-up missed that the registration model needed the same treatment: **the descriptor/instance pattern subsumes the parameterized/non-parameterized distinction, and applying it uniformly eliminates the branch at every read site**.

## Glossary

| Term | Meaning |
|---|---|
| **Codec** | The runtime instance — a thing with `encode`, `decode`, `encodeJson`, `decodeJson`. Returned by a descriptor's factory. Stops carrying codec-id-keyed metadata. |
| **CodecDescriptor** | The registration record — codec id + static metadata (traits, target types, meta) + factory. One per codec id. Replaces `ParameterizedCodecDescriptor`; subsumes today's "raw codec object" registration. |
| **`P`** | The descriptor's parameter type. `void` for non-parameterized codecs; non-empty for parameterized codecs (`{ length: number }` for vector, `{ schema: StandardSchemaV1 }` etc. for parameterized JSON). |
| **`Ctx`** | The framework-supplied context passed to a factory's curried application. `{ name; usedAt: ReadonlyArray<{ table; column }> }`. Locked from codec-model-unification. |
| **Resolved codec** | The `Codec` returned by `descriptor.factory(params)(ctx)`. One per `(codec id, instance)` — shared across columns referencing the same `storage.types` entry; per-column for inline-typeParams columns; one shared per codec id for non-parameterized codecs. |
| **Descriptor map** | Codec-id-keyed map of all registered descriptors. Replaces today's two-registry structure (`codecs:` + `parameterizedCodecs:`). |
| **`descriptorFor(codecId)`** | Codec-id-keyed metadata read. Returns the registered descriptor. Non-branching for parameterized vs. non-parameterized. |
| **`forColumn(table, column)`** | Column-aware dispatch read. Returns the resolved codec for the named column. Built once at context-construction by walking the contract's tables. |

## Cases that pin the design

These three cases drive the structural decisions; if any can't be expressed cleanly under the unified descriptor, the design is wrong.

### Case T — Text (non-parameterized)

`pg/text@1` ships as a `CodecDescriptor<void>` with `paramsSchema: type('void')`, `traits: ['equality', 'order', 'textual']`, `targetTypes: ['text']`, and `factory: () => (ctx) => sharedTextCodec`. Every text column in any contract resolves through `forColumn(t, c)` to the same `sharedTextCodec` instance — the constant factory caches the codec; subsequent calls return the same reference.

What this case pins:

- The unified descriptor admits non-parameterized codecs as the degenerate case (`P = void`). No special non-parameterized registration path.
- `descriptorFor('pg/text@1').traits` works without branching; same call shape as parameterized codecs.

### Case V — Vector (parameterized; encode-side parameter-independent)

`pg/vector@1` ships as a `CodecDescriptor<{ length: number }>`. Two columns referencing the same `storage.types` entry (`Embedding1536`) share one resolved codec instance (factory called once per `storage.types` entry; result cached). Two columns with different `storage.types` entries (e.g. `Embedding1536` and `Embedding768`) get distinct resolved codecs. Two inline-typeParams columns get distinct resolved codecs (one per anonymous instance `<anon:t.c>`).

What this case pins:

- The descriptor's `factory` is called once per instance, not once per column.
- Per-instance caching is keyed by `storage.types` entry name (or `<anon:t.c>` for inline) — same logic as today's `initializeTypeHelpers`.

### Case J — JSON-with-schema (parameterized; encode/decode parameter-dependent)

`json(schema)` ships from a per-library extension package (`@prisma-next/extension-arktype-json` lands in Phase 4; future zod / valibot extensions follow). The extension's column-author surface eagerly serializes the schema to `typeParams` at the call site. The descriptor's factory rehydrates the schema from `typeParams` and returns a `Codec` whose `decode` validates internally — no separate validator registry consultation. Validation is library-specific, lossless across the serialize/rehydrate cycle (because the same library handles both ends).

What this case pins:

- Per-instance state (the validator) lives on the resolved codec; the JSON-validator registry deletes.
- Per-library extension packages own JSON-with-schema; the postgres adapter no longer ships `json(schema)` — only the storage-level non-parameterized `json` and `jsonb` (raw bytes).
- Codec ids are library-bound (`arktype/json@1`), not target-bound.

## Acceptance criteria

### AC-1. Every codec ships as a `CodecDescriptor`

- The unified `CodecDescriptor<P = void>` type exists in `@prisma-next/framework-components/codec`.
- `ParameterizedCodecDescriptor` is renamed or aliased to `CodecDescriptor`; its previous shape is preserved as a special case (parameterized).
- **Deferred to TML-2357**: every codec in every adapter and extension package ships a native descriptor (no synthesis bridge). This project ships the synthesis bridge (`synthesizeNonParameterizedDescriptor`) as the read-surface unification; the registration-side migration is mechanical-but-voluminous and lands separately.

### AC-2. Single registration slot

- **Deferred to TML-2357**: `SqlStaticContributions.codecs` returns `ReadonlyArray<CodecDescriptor>`; `parameterizedCodecs:` slot deletes; legacy `codecs: () => CodecRegistry` shape gone from contributor protocols. Depends on AC-1's native descriptor migration.

### AC-3. Descriptor map is the codec-id-keyed source of truth

- A `descriptorFor(codecId)` accessor on the runtime context returns the registered descriptor.
- sql-orm-client's metadata reads (`traitsOf(codecId)`, `getByScalar(scalar)`, `getDefaultCodec(scalar)`, `values()`, iteration) consult the descriptor map without branching on whether the codec id is parameterized.
- `validateCodecRegistryCompleteness` consults the descriptor map.

### AC-4. Column-aware dispatch via `forColumn`

- `ContractCodecRegistry.forColumn(table, column)` resolves every column — parameterized or not — to its resolved codec. Non-parameterized columns share one cached codec per codec id; parameterized columns get per-instance codecs.
- Encode and decode call sites consult `forColumn` for column-bound dispatch. The codec-id fallback (`forCodecId`) survives only for the narrow set of sites without column refs (currently DSL-param encode without `ParamRef.refs`).

### AC-5. `ParamRef` carries column refs

- **Deferred to TML-2357**: `ParamRef` gains `refs?: { table, column }`; populated from column-bound construction sites; encode-side `forColumn` dispatch becomes the primary path. Today encode-side dispatch falls back to `forCodecId` for parameterized codec ids whose DSL-param values lack refs; the fallback is fragile (works for pgvector by coincidence, since vector wire format is length-independent).

### AC-6. JSON-validator registry deletes

- **Deferred to TML-2357**: `JsonSchemaValidatorRegistry` and `buildJsonSchemaValidatorRegistry` delete; validation moves into the resolved codec's `decode` body; the `'json-validator'` `CodecTrait` retires or persists only as a structural marker.

### AC-7. JSON column factory ships from a per-library extension package

- `@prisma-next/extension-arktype-json` ships `arktypeJson(arktypeSchema)` returning a `ColumnTypeDescriptor` whose `type` slot threads the curried factory.
- The extension registers a `CodecDescriptor` for codec id `arktype/json@1` (library-bound; not target-bound).
- The eager serialization at the column-author call site uses arktype's `.expression` and `.toJsonSchema()` (or whichever serialization arktype exposes). Rehydration in the descriptor's factory uses arktype's own parser.
- The postgres adapter's `json-factory.ts` (the M3 / M4-era schema-typed factory) deletes. The postgres adapter retains only non-parameterized `json` and `jsonb` codecs (raw bytes; no schema).
- The demo migrates from `json(productSchema)` to `arktypeJson(productSchema)`.

### AC-8. ADR 205 captures the unified design

- ADR 205 updates to reflect the unified descriptor model. The "ParameterizedCodecDescriptor" framing supersedes; the new framing is "every codec is a descriptor, parameterized is a degenerate case."
- The TML-2330 misattribution stripped (TML-2330 is about KMS dispatch concurrency, unrelated).
- The dual-JSON-descriptor "surface segregation" framing in the ADR replaces with the per-library-extension framing.
- Subsystem docs and README sections updated.

### AC-9. Validation gates green

- `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:packages`, `pnpm test:e2e`, `pnpm build` all green.
- Demo emit byte-identical against the Phase 2 baseline (this project is runtime + registration; emit was corrected in Phase 2).
- Real-Postgres e2e tests pass for vector encode/decode, json-with-schema encode/decode, and non-parameterized columns.

## Non-goals

- **`ContractCodecRegistry` for non-SQL families.** Mongo's runtime has its own dispatch shape; the unified descriptor lands in framework-components but its consumption in the Mongo runtime is mostly an analogous rewiring. Mongo's adapter currently has minimal parameterized codecs (just vector) and the wire dispatch path differs from SQL. Treat Mongo migration as opportunistic — migrate the registration shape but defer the `forColumn` plumbing if it's structurally non-trivial.
- **TML-2330** (KMS dispatch concurrency, AbortSignal, rate limiting) — unrelated work.
- **Other codec interface fields** — `bulkEncode`, `preferParam`, redaction traits — out of scope.
- **The PSL `pgvector.Vector(N)` constructor and other authoring-types**: these stay; only the codec registration changes.
- **Renaming `Codec`** — keep the type name `Codec` for the runtime instance; it just stops carrying metadata.

## Non-functional constraints

- **Zero new type casts** in production code. The descriptor type unifies what the legacy registration was special-casing; if the consolidation requires a cast, it's a sign the type design is still wrong.
- **No backward-compat shims**: the legacy `codecs: () => CodecRegistry` slot deletes; contributors that ship through it must migrate. No "if descriptor not found, fall back to legacy registry" branches anywhere.
- **No `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`, no biome suppressions.**
- **Demo emit byte-identical against Phase 2 baseline.** Phase 2 fixed the typeRef emit-path bug; subsequent phases must not regress emit.
- **Layering**: `CodecDescriptor` lives in `framework-components`. Family-specific descriptors live in their adapter packages. `pnpm lint:deps` passes throughout.

## Project base

Branched from `tml-2229-no-emit-path-restore-parameterized-output-types-in` directly. Single branch, single PR (PR #390). No stacking. Phases 1, 2, 3 are already landed on this branch (commits `161f7f1c4`, `ee82929f3`+`e94962675`, `245c8610c`+`8a9311c93`+`ba07ad166`); Phases 3.5, 4, 5 land here too.

## Outcomes

- The dual-registration smell deletes. One descriptor per codec id; no codec object registered as a flat codec when it has parameters.
- Codec-id-keyed metadata reads stop branching on whether the codec is parameterized.
- The `JsonSchemaValidatorRegistry` workaround retires; per-instance state lives on resolved codecs as the design always intended.
- Per-library JSON extension model lands; the postgres adapter retains only storage-level codecs.
- ADR 205 captures the final model accurately; misattributions strip.

## Forward-looking work captured but out of scope

- **TML-2357** — Complete the unified `CodecDescriptor` migration. Tracks the deferred Phase 3.5b work: narrow the runtime `Codec` instance type (T3.5.2), migrate every codec to a native descriptor (T3.5.3), delete the synthesis bridge and the `parameterizedCodecs:` slot (T3.5.4), thread `ParamRef.refs` through column-bound construction sites (T3.5.9-11), delete `pgVectorRepresentativeCodec` (T3.5.13), delete the `JsonSchemaValidatorRegistry` workaround (T3.5.12). ACs 1, 2, 5, 6 from this spec land under TML-2357 rather than under this project.
- Future schema libraries (zod, valibot) ship as parallel extensions when each has a clean serialize/rehydrate story.
- Mongo runtime's `forColumn` plumbing if Mongo gains more parameterized codecs.
- TML-2330 (KMS dispatch concurrency) addressed under its own ticket.
