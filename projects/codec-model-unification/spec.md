# Spec — Codec model unification

## Decision

A *parameterized codec* is a **higher-order codec**: a curried TypeScript function `(params) → (ctx) → Codec`. Pack authors write one such function per parameterized type (`vector`, `char`, `numeric`, `json`, `cipherStashText`, …). Its **TS signature is the surface** — both the type-level resolution for the no-emit path and the runtime implementation that closes over `params` and column context. Following [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md), the function is the only behavior-bearing artifact; there is no separate type-level brand, no HKT, no `OutputType` field, no `init` hook. Adjacent metadata (`paramsSchema`, `renderOutputType`) lives on a small sister `ParameterizedCodecDescriptor` that registers the function with the framework, mirroring `SqlOperationDescriptor` from ADR 204.

Before — three optional, drift-prone fields on the base `Codec`, plus per-codec column factories that strip type information:

```typescript
interface Codec<Id, Traits, Wire, Js> {
  // …encode / decode / traits / meta…
  readonly paramsSchema?: Type<Record<string, unknown>>;
  readonly renderOutputType?: (params: Record<string, unknown>) => string;
  readonly init?: (params: Record<string, unknown>) => unknown;
}

// Per-codec factory, hand-rolled, output type collapses to the base
function vector<N extends number>(length: N): ColumnTypeDescriptor & { typeParams: { length: N } } { … }
```

After — one factory function per parameterized codec, **curried** so the user passes params and the contract-authoring API supplies `ctx`:

```typescript
type Ctx = {
  readonly name: string;                                              // storage.types instance name
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
};

// pgvector
function vector<N extends number>(length: N): (ctx: Ctx) =>
  Codec<'pg/vector@1', ['equality'], string, Vector<N>> { … }

// json with user-supplied schema
function json<S extends StandardSchemaV1>(schema: S): (ctx: Ctx) =>
  Codec<'pg/json@1', ['equality'], string, StandardSchemaV1.InferOutput<S>> { … }

// CipherStash column-scoped encryption — ctx is load-bearing
function cipherStashText(params: { keyId: string; mode: 'deterministic' | 'randomized' }): (ctx: Ctx) =>
  Codec<'cipherstash/text@1', ['equality'], string, string> { … }
```

The user calls only `vector(1536)`, `json(productSchema)`, etc. The contract-authoring builder applies `ctx`.

Each parameterized codec also ships a sister **descriptor** that registers it with the framework (matches ADR 204's `{method, self, impl}` pattern for operations):

```typescript
interface ParameterizedCodecDescriptor<P> {
  readonly codecId: string;
  readonly paramsSchema: StandardSchemaV1<P>;                  // validates JSON-sourced params
  readonly renderOutputType?: (params: P) => string;           // emit path → contract.d.ts string
  readonly factory: (params: P) => (ctx: Ctx) => Codec;        // the higher-order codec
}

// pgvector exports both:
export const vector;            // user-facing factory
export const pgVectorCodec: ParameterizedCodecDescriptor;  // framework registration
```

Around that change:

- **`FieldOutputType<Definition>`** (no-emit path) follows `typeRef` through `storage.types`, reads the user's column expression (which is the curried factory result), and extracts the `Codec`'s `Js` slot. No HKT.
- **The factory is called twice** in the contract's life: once at contract-authoring (returns codec object whose data part — `id`, `typeParams` — is serialized to `contract.json`, with closures discarded); once at runtime load (factory called again with params recovered from `contract.json` plus the same `ctx`, returns a fresh `Codec` whose `encode`/`decode` close over per-instance state). Same function, same inputs both times.
- **`paramsSchema` validates params at the JSON boundary** (PSL → contract, contract.json → runtime). `renderOutputType` is the emit path's string-rendering hook. Both live on the descriptor; both optional.
- **`columnFor` and per-codec `column…` helpers go away.** Each pack exports the typed factory function directly; that *is* the column-author surface.
- **JSON columns regain schema-driven inference** — the `json(schema)` factory's return type is `(ctx) => Codec<…, InferOutput<schema>>`. (Restoration: JSON columns inferred through their schema before the no-emit path was introduced; [TML-2229](https://linear.app/prisma-company/issue/TML-2229) restores this.)
- **The base `Codec` interface is unchanged** structurally — `paramsSchema?` and `init?` are removed from the SQL `Codec` extension (they migrate to the descriptor and the factory closure respectively). `renderOutputType?` migrates from base `Codec` to the descriptor (default per [open question 2](#open-questions); locked at M1) so the base `Codec` carries no parameterization slots at all.

## Why

**The bug.** [TML-2229](https://linear.app/prisma-company/issue/TML-2229). The no-emit path (`FieldOutputTypes<Definition>` computed at the type level, no `pnpm emit` step) ignores `typeParams`, so `vector(1536)` resolves to `number[]` instead of `Vector<1536>`, and a JSON column with a narrowed schema resolves to `JsonValue` instead of the schema's inferred shape. [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) deferred this fix.

**Why higher-order codecs.** The parameterized codecs we ship today already *are* functions `(params) → descriptor` — the user's `vector(1536)` is the call. Today those functions throw away type information at the boundary (their return type is a generic `ColumnTypeDescriptor`, not `Codec<…, Vector<N>>`). Putting the resolved type on the function's return is one type annotation per pack and fixes the no-emit path. Following ADR 204's "function is the signature" principle, runtime and type-level become a single artifact — they cannot drift.

**Why the function takes `ctx`.** The CipherStash extension wants column-scoped encryption keys derived from `(table, column)`. The contract-authoring API has that information at the point where the factory is invoked (we're inside `.column('embedding', ...)`). Passing it down as `ctx` lets stateful codecs close over it, with no separate `init` hook. Stateless codecs (Vector, char, numeric, plain JSON) ignore `ctx`.

**Why a sister descriptor for `paramsSchema` / `renderOutputType`.** These run on JSON-shaped params (the framework reads them at the contract boundary, before/independently of the factory). They aren't about closing over column context; they're metadata. Following ADR 204's `{method, self, impl}` pattern, we keep "the function" and "the framework metadata that surrounds the function" as sibling fields on a small descriptor object. The user-facing surface stays just the function.

## Glossary

| Term | Meaning |
|---|---|
| **Codec** | The existing interface: `encode`, `decode`, `traits`, `meta`. Unchanged by this project. |
| **Higher-order codec** (HoC) | A curried function `(params) → (ctx) → Codec` that produces a parameterized codec specialized to specific params and column context. Each parameterized type ships one. |
| **Codec factory** | Pragmatic synonym for "higher-order codec." Used interchangeably; "factory" is the user-facing word. |
| **Ctx** | The column context passed when the HoC is applied to its params: `{ name: string; usedAt: ReadonlyArray<{ table: string; column: string }> }`. The contract-authoring API supplies it; the user never writes it. |
| **`ParameterizedCodecDescriptor`** | The sister descriptor that registers a parameterized codec with the framework. Holds `codecId`, `paramsSchema`, optional `renderOutputType`, and the `factory` itself. Analogous to `SqlOperationDescriptor` ([ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md)). |
| **Emit path** | `pnpm emit` walks the contract and writes a fully-resolved `contract.d.ts`. Already correct after [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). |
| **No-emit path** | Authoring code imports the contract definition directly; output types are computed at the type level by `FieldOutputTypes<Definition>`. The site of the bug. |
| **`renderOutputType`** | Optional descriptor field: `(params) → string` for `contract.d.ts`. |
| **`paramsSchema`** | Required descriptor field: a `StandardSchemaV1<Params>` for runtime validation when params arrive as data (PSL parse, JSON load). |
| **`storage.types`** | Existing contract IR registry of *named* parameterized type instances (e.g. `Embedding1536: vector(1536)`). |
| **`typeRef`** | Existing column property pointing at a `storage.types` entry by name (alternative to inline `typeParams`). |
| **Anonymous instance** | The `storage.types`-equivalent entry the runtime synthesizes for an inline-`typeParams` column. Deterministic name `<anon:table.column>`. |
| **Branded type** | A nominal TypeScript type marked by an unused phantom property/symbol — e.g. `Vector<N> = number[] & { __vectorLength?: N }`. The factory's return type may include such types; the factory itself is not a brand. |

## Cases that pin the design

These are the concrete codecs the design must support end-to-end. They constrain the moving parts; each "How it works" subsection traces back to one or more.

### Case V — Vector (literal-typed numeric param)

A user writes `vector(1536)` at a column site. The column's TS type resolves to `Vector<1536>` in both the emit path and the no-emit path. The factory's signature is `<N extends number>(length: N) => (ctx: Ctx) => Codec<…, Vector<N>>`. `ctx` is unused by Vector. Same shape pins `char(N)`, `numeric(p, s)`, `timestamp(N)`. Worked code: [authoring-ergonomics.md#case-v](design/authoring-ergonomics.md#case-v--vector-literal-typed-numeric-param).

What this case pins:

- The factory's return type carries the resolved column type, parameterized over `params`.
- Literal numeric inference must flow through (`1536`, not `number`).
- Emit and no-emit paths produce the same type — `renderOutputType` and the factory's TS return are written next to each other and tested against each other.

### Case J — JSON-with-schema

A user writes `json(ProductSchema)` where `ProductSchema` is an Arktype / Zod / Valibot schema. The column's TS type resolves to `StandardSchemaV1.InferOutput<ProductSchema>`. The same schema validates wire payloads at runtime. We do not ship a JSON-Schema-to-TS converter. Worked code: [authoring-ergonomics.md#case-j](design/authoring-ergonomics.md#case-j--json-with-schema).

What this case pins:

- The factory's signature can take a *schema value* and project a TS type from it (`StandardSchemaV1.InferOutput<S>`). No HKT needed — TS infers `S` at the call site and the return type uses it directly.
- The factory's body uses the same schema for runtime validation.
- `json` is just one factory among many; nothing JSON-specific in the framework.

### Case C — CipherStash column-scoped encryption

`ctx` is load-bearing. A CipherStash codec encrypts column values with a key derived from `(table, column)` plus contract-level config. The factory `cipherStashText(params)(ctx)` derives the key from `params` + `ctx.usedAt` and returns a codec whose `encode`/`decode` close over the key. A subcase, `encryptedJson<S>(schema, params)(ctx)`, composes Case J with this one. Worked code: [runtime-contract-and-compatibility.md#case-c](design/runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption).

What this case pins:

- `ctx` shape: `{ name, usedAt: ReadonlyArray<{ table, column }> }`. `usedAt` is plural so a shared `storage.types` instance can derive one key bound to all its columns.
- The factory runs at runtime load too — closures over derived state must survive contract serialization.
- Encryption invisible at the type level: the factory's return is `Codec<…, string>` (plaintext), even though the wire is ciphertext.

## How it works

Six moving parts. Each links to detailed design.

### 1. The base `Codec` interface is unchanged — driving cases: V, J, C

The base `Codec` interface (`id`, `targetTypes`, `traits`, `encode`, `decode`, `encodeJson`, `decodeJson`, `meta`) stays as it is. No interface split, no new required fields. The currently-optional `paramsSchema?` and `init?` (the SQL `Codec` extension over framework-components' base) are removed — they migrate to `ParameterizedCodecDescriptor` (paramsSchema) and the higher-order factory (init's intent absorbed into the closure the factory returns).

→ Detail: [higher-order-codecs.md#the-codec-interface](design/higher-order-codecs.md#the-codec-interface).

### 2. A higher-order codec is a curried, typed factory function — driving cases: V, J, C

Each parameterized codec ships as a curried function:

```typescript
function vector<N extends number>(length: N) {
  return (ctx: Ctx): Codec<'pg/vector@1', ['equality'], string, Vector<N>> => ({
    id: 'pg/vector@1',
    targetTypes: ['vector'],
    traits: ['equality'],
    typeParams: { length },                                  // becomes part of contract IR
    encode: (v: number[]) => `[${v.join(',')}]`,
    decode: (w: string) => parseVector(w),
    encodeJson: (v) => v,
    decodeJson: (j) => j as number[],
    meta: { db: { sql: { postgres: { nativeType: 'vector' } } } },
  });
}
```

The function is the type-level surface (its return type is what `FieldOutputType` reads) *and* the runtime implementation (its body builds the codec object). One artifact.

→ Detail: [higher-order-codecs.md#anatomy-of-a-higher-order-codec](design/higher-order-codecs.md#anatomy-of-a-higher-order-codec).

### 3. The descriptor registers the factory with the framework — driving cases: V, J, C

Each parameterized codec ships a `ParameterizedCodecDescriptor`:

```typescript
export const pgVectorCodec: ParameterizedCodecDescriptor<{ length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: vector,
};
```

Packs export both the function (for column authoring) and the descriptor (for the framework to register via the existing `parameterizedCodecs` slot on the runtime descriptor). This mirrors ADR 204's `{method, self, impl}` shape for operations.

→ Detail: [higher-order-codecs.md#the-descriptor](design/higher-order-codecs.md#the-descriptor).

### 4. The no-emit `FieldOutputType` reads the factory's return type — driving cases: V, J, C

`FieldOutputType` in [packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts) follows `typeRef` through `storage.types`, then reads `Js` off the `Codec<Id, Traits, Wire, Js>` resulting from applying the user's column expression to a synthetic `ctx` at the type level. Nullability preserved.

→ Detail: [higher-order-codecs.md#rewriting-the-no-emit-fieldoutputtype](design/higher-order-codecs.md#rewriting-the-no-emit-fieldoutputtype).

### 5. The contract-authoring API supplies `ctx` — driving case: C (V, J ignore it)

When the user writes `.column('embedding', vector(1536))`, the value passed in is the partially-applied `(ctx) => Codec<…, Vector<1536>>`. The authoring builder, having walked the model and computed `(table, column)`, applies it: `vector(1536)({ name: '<anon:Document.embedding>', usedAt: [{ table: 'Document', column: 'embedding' }] })`. For `storage.types` entries, `ctx.usedAt` lists every column that references the entry (post-aggregation).

→ Detail: [authoring-ergonomics.md#how-ctx-is-supplied](design/authoring-ergonomics.md#how-ctx-is-supplied).

### 6. The runtime calls the factory again at contract load — driving case: C

When `contract.json` is loaded, the runtime walks `storage.types` entries (named + anonymous-from-inline). For each entry it looks up the descriptor by `codecId`, validates the JSON-sourced `typeParams` via `descriptor.paramsSchema`, then calls `descriptor.factory(typeParams)(ctx)` once. The returned `Codec` is indexed by instance name; `encode`/`decode` for any column referencing the instance dispatches through it.

The runtime side is **declared here, implemented in [TML-2330](https://linear.app/prisma-company/issue/TML-2330)**. This project locks the factory + descriptor shape so CipherStash and other extension authors can author against a stable surface today.

→ Detail: [runtime-contract-and-compatibility.md#runtime-materialization-contract](design/runtime-contract-and-compatibility.md#runtime-materialization-contract).

### 7. JSON columns use a shipped factory — driving case: J

We ship one new factory + descriptor pair in `@prisma-next/postgres-core`: `json<S extends StandardSchemaV1>(schema: S)` returning `(ctx) => Codec<'pg/json@1', ['equality'], string, InferOutput<S>>`. Pack authors and users get correct inference for JSON columns without us writing a JSON-Schema-to-TS converter — the user's schema library does it via Standard Schema.

→ Detail: [authoring-ergonomics.md#json-factory](design/authoring-ergonomics.md#json-factory).

## Project base

Branched from `origin/worktree/op-registry-ts` ([PR #374](https://github.com/prisma/prisma-next/pull/374)). #374 establishes "function is the signature" for SQL operations ([ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md)); this project applies the same principle to parameterized codecs. Once #374 merges to `main`, rebase to `origin/main`. Detail: [runtime-contract-and-compatibility.md#rebase-strategy](design/runtime-contract-and-compatibility.md#rebase-strategy).

## Outcomes

Concretely:

- **TML-2229** is closed by Cases V and J working in the no-emit path.
- **[ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) follow-up** is the same Cases V and J no-emit fix; emit-path output is unchanged.
- **CipherStash G1 forward-compat** is Case C: their codec authors against `(params, ctx)` today, even though the runtime side ships in [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- **CipherStash G16 forward-compat** is Case J: `encryptedJson<S>` reuses the `json(schema)` pattern.
- **Pack-author DX** is the consequence of how Cases V and J are authored — one typed factory function per codec, no parallel boilerplate.

Out-of-scope items (CipherStash G4, G6, G9, G10, G2/G3) are listed under [Non-goals](#non-goals).

## Acceptance criteria

Observable properties grouped by area; each is a green-light gate for a milestone in [plan.md](plan.md).

### AC-1. Higher-order codec factories type-resolve correctly

- `vector(1536)` typechecks as `(ctx: Ctx) => Codec<'pg/vector@1', ['equality'], string, Vector<1536>>`.
- `json(productSchema)` typechecks with `Js = StandardSchemaV1.InferOutput<typeof productSchema>`.
- `cipherStashText({ keyId: 'k', mode: 'deterministic' })` typechecks as `(ctx) => Codec<'cipherstash/text@1', ['equality'], string, string>`.
- Literal numeric / object types preserved through the factory call.
- `ParameterizedCodecDescriptor.factory`'s type matches the exported factory function's type.

### AC-2. No-emit `FieldOutputType` resolves correctly

- Inline column written as `.column('embedding', vector(1536))` resolves to `Vector<1536>`.
- `typeRef` column resolves through `storage.types` to the same type.
- JSON column with a Standard-Schema schema resolves to its `InferOutput`.
- Non-parameterized columns unchanged.
- `Vector<1536> | null` for nullable columns.
- `ComputeColumnJsType` returns the same resolved type for the same fixtures.

### AC-3. Authoring-side `ctx` is supplied to factories

- Writing `.column('embedding', vector(1536))` causes the contract-authoring builder to apply the partially-applied factory with `ctx.name = '<anon:Document.embedding>'` and `ctx.usedAt = [{ table: 'Document', column: 'embedding' }]`.
- `storage.types: { Embedding1536: vector(1536) }` applies the factory with `ctx.name = 'Embedding1536'` and `ctx.usedAt` listing every referencing column post-aggregation.

### AC-4. Existing parameterized codecs migrated

- pgvector, postgres-core (numeric, timestamp/timestamptz, char if present, json/jsonb), and mongo codecs ship as curried factory functions paired with `ParameterizedCodecDescriptor` exports.
- Per-codec column-descriptor factories (e.g. `vectorColumn`, today's `vector(N)` returning a generic descriptor) are removed; the typed factory replaces them.
- Today's `paramsSchema?` and `init?` fields on the SQL `Codec` interface are removed; the equivalent moves to `ParameterizedCodecDescriptor`.
- Emit-path snapshots byte-identical pre/post.

### AC-5. JSON factory ships

- `json<S extends StandardSchemaV1>(schema: S)` is exported from `@prisma-next/postgres-core`.
- Inferred output equals `StandardSchemaV1.InferOutput<S>` at the type level.
- Factory body validates wire payloads against `schema` at runtime.
- `ParameterizedCodecDescriptor` for `pg/json@1` is exported and uses Standard Schema as `paramsSchema`.

### AC-6. CipherStash forward-compat surface is locked

- The curried factory shape `(params) => (ctx: { name, usedAt }) => Codec<…>` typechecks for a synthetic CipherStash-style fixture.
- The runtime contract for "factory is called once per `storage.types` instance at contract load" is documented (not implemented) in [runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md).

### AC-7. Build performance acceptable

- Typecheck of `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts` within ±20% of the M0 baseline (recorded in `assets/typecheck-baseline.md`).

### AC-8. Documentation lands

- ADR under `docs/architecture docs/adrs/` extending [ADR 186](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md), referencing [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) as the precedent for "function is the signature."
- Pack-author README sections on writing higher-order codecs, the `(params, ctx)` shape, and `paramsSchema` / `renderOutputType` co-located metadata.
- Codec subsystem doc in `docs/architecture docs/subsystems/` updated.
- Project artifacts under `projects/codec-model-unification/` removed at close-out (long-lived content migrated to `docs/`).

## Non-goals

- **Runtime rewiring of per-instance materialization.** Factory shape only; the runtime calling factories per `storage.types` instance and routing dispatch is [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- **Other codec interface slots**: `bulkEncode` (CipherStash G4), `AbortSignal` plumbing (G10), redaction traits (G9, [TML-2329](https://linear.app/prisma-company/issue/TML-2329)), `preferParam` (G6). Each is orthogonal to this project's shape and easy to add later.
- **PSL-side authoring of parameterized types.** PSL parsing already lands `typeParams` on the descriptor; this project addresses the TS-authored path. The PSL → factory bridge runs at runtime, where `paramsSchema` validates the JSON-sourced params before factory invocation.
- **`ComputeColumnJsType` rework.** Already delegates to `ExtractFieldOutputTypes<Contract>`; picks up the fix transparently.
- **Migration-planner input plumbing** (CipherStash G2/G3). Same architectural pattern, different plane.
- **Sanity-checking `typeRef` at column-declaration time.** Out of scope.
- **Publishing the codec model as a stable external API.** Internal until pack-author docs land.

## Non-functional constraints

- **Typesafety rules** ([AGENTS.md](../../AGENTS.md)): no `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`, no biome suppressions. The new model should require **zero** type casts in the per-codec migration; if a cast appears, it's evidence the factory's signature is wrong.
- **No backwards-compatibility shims**: hard cut on the old optional fields on base `Codec` and on per-codec column-descriptor factories.
- **Layering**: the `Codec` type stays at framework-components. Factories live in their owning packs. `Ctx` lives in framework-components. `pnpm lint:deps` passes.
- **No global declaration merging.** Each factory is its own typed function; the contract-authoring API resolves codecs by `codecId` at runtime via the existing registry.
- **No in-house JSON-Schema → TS converter.** JSON inference comes from the user's Standard Schema.

## Open questions

Project-level questions affecting what we ship. Each has a default resolution in the design docs; locked at the relevant milestone.

1. **Where does `ParameterizedCodecDescriptor` live?** Default: `@prisma-next/framework-components` (next to the base `Codec` interface). Alternative: `@prisma-next/sql-relational-core/ast` (next to today's SQL `Codec` extension). Default keeps the descriptor target-family-agnostic so non-SQL families (mongo, document) can reuse it. Locked at M1.
2. **`renderOutputType` placement: base `Codec` or descriptor?** Default: migrate to the descriptor, where it belongs (only parameterized codecs have it). Once moved, the base `Codec` carries no parameterization slots at all. Locked at M1.
3. **Anonymous instance naming.** Default: `<anon:${table}.${column}>`. Locked at M1.

## Alternatives considered

Each alternative was considered and rejected for the reasons summarized; full rationale lives in the design docs.

### Type-level brand / `OutputType` HKT field on the codec

Earlier iteration of this project. The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>` in the no-emit path. Rejected because the same information already lives in the factory function's TS return type — there's no reason to encode it twice and synchronize the two encodings via `renderOutputType`. Detail: [higher-order-codecs.md#rejected-alternatives](design/higher-order-codecs.md#rejected-alternatives).

### Optional `init(params, instance)` hook on the codec

Earlier iteration. Codec carries `init?` separately from the factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — they have the same signature, the same lifecycle, and the same purpose. One artifact, not two. Detail: same link.

### `columnFor(codec)(params)` discriminated helper

Earlier iteration. A single `columnFor` helper turned any codec into a column-descriptor factory, type-discriminated on whether the codec was parameterized. Rejected once each pack ships a typed factory directly — `columnFor` had no type information to add and added an indirection at the call site. Pack authors ship `vector`, not `columnFor(pgVectorCodec)`. Detail: [authoring-ergonomics.md#why-not-a-shared-columnfor-helper](design/authoring-ergonomics.md#why-not-a-shared-columnfor-helper).

### Global `CodecOutputTypes` interface with declaration merging

Each codec augments a global registry. Rejected for ambient global pollution, order-dependent merging, and version/identity brittleness. Detail: [higher-order-codecs.md#rejected-alternatives](design/higher-order-codecs.md#rejected-alternatives).

### Compute output type from the codec's `output` type alone

A "smart" `FieldOutputType` narrows the codec's existing `output` (e.g. `number[]`) using `typeParams`. Rejected: there's no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is what the factory's return type does. Doesn't generalize to JSON-with-schema.

### Implement the runtime per-instance materialization in this project

Rejected as scope creep. The runtime side has its own design surface (error handling, resource lifecycle, async helper construction) and would balloon the PR. Locking the factory shape is free and high-leverage; implementing the runtime is [TML-2330](https://linear.app/prisma-company/issue/TML-2330). Detail: [runtime-contract-and-compatibility.md#why-declare-without-implementing](design/runtime-contract-and-compatibility.md#why-declare-without-implementing).

## References

- [ADR 186 — Codec-dispatched type rendering](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)
- [ADR 204 — Operations as TypeScript functions](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) — the "function is the signature" precedent
- [TML-2229](https://linear.app/prisma-company/issue/TML-2229) — original ticket (re-scoped)
- [TML-2329](https://linear.app/prisma-company/issue/TML-2329) — trait-gated redaction (CipherStash G9 follow-up)
- [TML-2330](https://linear.app/prisma-company/issue/TML-2330) — runtime per-instance materialization + concurrency (CipherStash G1, G4 follow-up)
- [PR #374 — feat(operations): author SQL operations as TypeScript functions](https://github.com/prisma/prisma-next/pull/374)
- [Standard Schema spec](https://github.com/standard-schema/standard-schema)
- [assets/cipherstash-ext-framework-gaps.md](assets/cipherstash-ext-framework-gaps.md) — framework-gaps analysis driving forward-compatibility work
- Design docs:
  - [design/higher-order-codecs.md](design/higher-order-codecs.md)
  - [design/authoring-ergonomics.md](design/authoring-ergonomics.md)
  - [design/runtime-contract-and-compatibility.md](design/runtime-contract-and-compatibility.md)
