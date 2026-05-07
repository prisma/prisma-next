# Spec — Typed `Codec` flow through `CodecDescriptor` (TML-2357 prerequisite)

> **Pivotal precondition for the rest of TML-2357.** Surfaced during M2 R4 (see [`wip/unattended-decisions.md` Decision #11](../../../wip/unattended-decisions.md)) when deleting the legacy `mkCodec`-call-result typed instances broke `<Contract, TypeMaps>` derivation downstream. The bug is a TML-2229 regression that should have been caught before merge. **No part of TML-2357's downstream codec migration (AC-1, AC-2, AC-3, AC-7) can land cleanly without this fix first.**

## Decision

`defineCodec({...})` MUST return a descriptor type that preserves the four codec generics its `spec` argument inferred (`Id`, `TTraits`, `TWire`, `TInput`) in addition to `TParams`. The factory's return type IS the resolved codec's type; consumers of a descriptor record (e.g. `PgDescriptors`, `SqlDescriptors`, `PgvectorDescriptors`) recover the typed `Codec<Id, TTraits, TWire, TInput>` directly from the descriptor's type — no `mkCodec`-call-result instance kept alive in parallel as a "type carrier."

After this fix, the typed flow runs end-to-end through descriptors only:

```
defineCodec({...})                              ── author site, codec generics inferred
  → PgDescriptors / SqlDescriptors / ...        ── per-package typed descriptor records
  → defineContract({target, family, packs}, ..) ── contract-ts builder reads typed records
  → field.uuidv4() / field.text() / ...         ── typed field specs
  → typeof contract                             ── carries per-column codec types
  → sqlBuilder<typeof contract>({context})      ── propagates types to query expressions
  → sql.user.where((f, fns) => fns.eq(f.id, x)) ── x must be string for a uuid column
```

In the emit path (`pnpm emit`), the same descriptor records drive `contract.d.ts` text generation; the typed `CodecTypes`/`TypeMaps` entries in the emitted file are derived from the descriptor types. Both paths converge on descriptor-resident typed factories as the single source of truth for the typed-codec flow.

## Why

The codec-registry-unification work ([TML-2229](https://linear.app/prisma-company/issue/TML-2229)) introduced `defineCodec` / `CodecDescriptor` as the unified registration shape but kept `mkCodec`-produced typed `Codec` instances alive in parallel, accidentally serving as the source of typed flow into `CodecTypes`/`TypeMaps`. This conflated two concerns:

1. **Codec registration** — a runtime/contributor-protocol concern, solved by descriptors flowing through the unified `codecs:` slot.
2. **Typed `Codec` flow into user code** — a TypeScript-type concern. Only relevant in (i) the no-emit authoring path (`field.uuidv4()` typing) and (ii) emit-path `contract.d.ts` generation (typed `CodecTypes` entries). Solved accidentally by keeping typed `mkCodec`-result instances alive.

When TML-2357 M2 R4 attempted to delete the legacy typed instances (the `mkCodec` factory and its callers), the type flow collapsed because:

- `defineCodec` declares its return as `CodecDescriptor<TParams>` (see [`packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:587-593`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) at HEAD), dropping the `Id`, `TTraits`, `TWire`, `TInput` parameters its `spec` argument inferred.
- Per-target descriptor records (`PgDescriptors`, `SqliteDescriptors`, `PgvectorDescriptors`) carry `CodecDescriptor<void>` per descriptor, not the typed shape.
- `ReturnType<ReturnType<D['factory']>>` collapses to base `Codec` because `D extends CodecDescriptor<infer P>` widens `D` to the unparameterized interface declaration before extraction.

Concrete failure shapes observed in M2 R4 ([`wip/unattended-decisions.md` Decision #11](../../../wip/unattended-decisions.md)):

- `sql-builder/test/playground/select.test-d.ts`: `SqlQueryPlan` constraint `{table: never; ...}` failures because `<Contract, TypeMaps>`-parameterized types lost per-codec-id specificity.
- `sql-builder/test/runtime/builders.test.ts`: `CodecExpression<"pg/int4@1", boolean, ...>` — `boolean` (default fallback) where `number` (`TypeMaps['pg/int4@1'].input`) was required.
- `sqlite/test/codecs.test.ts`: `result` typed as `unknown` instead of `Date`.

The variance failure was diagnosed as a real TS-type design problem, not an implementation bug. Two M2 R4 implementer subagents crashed iterating on workarounds; the orchestrator rolled back the entire commit chain to the M2 R3 HEAD (`a29e06245`).

This bug should have been caught and fixed in TML-2229. TML-2357 was scoped as "downstream codec migration"; it cannot complete its scope without first landing the type-flow fix.

## Cases that pin the design

These four cases anchor the acceptance criteria. If any can't be expressed cleanly under the typed-flow design, the design is wrong.

### Case U — Non-parameterized codec, no-emit query author types end-to-end

**Setup.** `pgUuidv4Descriptor` is defined in `packages/3-targets/3-targets/postgres/src/core/codecs.ts` via `defineCodec({factory: () => () => buildSqlCodec({typeId: 'pg/uuid@1', encode: (s: string) => uuidParse(s), decode: (b: Buffer) => uuidStringify(b), traits: ['equality']})})`. A no-emit author writes `field.id.uuidv4()` in `prisma/contract.ts`.

**Expected behavior.** `sql.user.where((f, fns) => fns.eq(f.id, '550e8400-e29b-41d4-a716-446655440000'))` typechecks. Substituting `1234` (number) fails to compile with a clear TS error pointing at the codec mismatch.

**What this pins.**
- `defineCodec`'s return preserves all five codec generics inferred from `spec`.
- `PgDescriptors['uuidv4']`'s type is rich enough that downstream `field.uuidv4()` returns a typed field spec carrying `Codec<'pg/uuid@1', readonly ['equality'], Buffer, string>`.
- The contract-ts `field` proxy propagates the typed shape through `defineContract({...}, ({field}) => ...)`.

### Case V — Parameterized codec (vector), typed flow under params validation

**Setup.** `pgVectorDescriptor` is defined with `paramsSchema: lengthSchema`, `factory: ({length}) => (ctx) => buildSqlCodec({typeId: 'pg/vector@1', encode: (arr: number[]) => packVector(arr, length), decode: (b: Buffer) => unpackVector(b, length), traits: []})`. A no-emit author writes `type.pgvector.Vector(1536)`, then a column references it.

**Expected behavior.** The column's effective codec type is `Codec<'pg/vector@1', readonly [], Buffer, number[]>`. Query expressions like `vectorCol.eq([1.2, 3.4, ...])` typecheck; passing `'string'` fails.

**What this pins.**
- Parameterized descriptors preserve typed codec generics through `paramsSchema` validation.
- The typed codec at the materialization site (`descriptor.factory(params)(ctx)`) carries the same generics as the factory's declaration.

### Case E — Emit-path `contract.d.ts` typed `TypeMaps` derivation

**Setup.** `pnpm emit` runs against `examples/prisma-next-demo`. The emitter walks the descriptors registered through the unified `codecs:` slot, derives per-codec-id `{input, output, traits}` shapes, and writes them into `contract.d.ts`'s `TypeMaps` projection.

**Expected behavior.** Generated `TypeMaps` projection has correct per-codec-id shapes:
```typescript
type TypeMaps = {
  'pg/int4@1':  { input: number;   output: number;   traits: ... };
  'pg/uuid@1':  { input: string;   output: string;   traits: 'equality' };
  'pg/vector@1':{ input: number[]; output: number[]; traits: ... };
  // ...
};
```

`pnpm fixtures:check` passes across all fixture pairs.

**What this pins.**
- The emit-path `TypeMaps` derivation reads from typed descriptors (no shadow `mkCodec`-result instance map needed).
- Demo emit output is byte-identical to the post-TML-2229 baseline.

### Case D — Heterogeneous descriptor storage at the registration boundary

**Setup.** Postgres adapter's contributor protocol returns `codecs: () => ReadonlyArray<AnyCodecDescriptor>` (per AC-2 of the parent spec). `Object.values(pgDescriptors)` flattens the typed record into a generic descriptor array for runtime registration.

**Expected behavior.** The runtime registration path (`@prisma-next/sql-runtime` → `CodecLookup.descriptorFor(codecId)`) accepts the heterogeneous array. The framework treats each entry as base `CodecDescriptor` (or `AnyCodecDescriptor`); typed-codec generics are not required at runtime — they served their purpose at the no-emit authoring boundary and at emit time.

**What this pins.**
- The variance erasure point is bounded to the *registration boundary* — type-flow ergonomics survive at the descriptor-record-of-typed-descriptors level (where it matters); the framework runtime continues to consume codecs as black boxes (where it shouldn't matter).

## Acceptance criteria

### AC-0.1. `defineCodec` preserves typed factory return

`defineCodec({...})`'s return type carries enough generic information for the typed `Codec<Id, TTraits, TWire, TInput>` to flow into per-package descriptor records. Two equivalent implementation shapes admissible (decision deferred to plan-time):

- **Shape A** (parameterize `CodecDescriptor`): `CodecDescriptor<Id, TTraits, TWire, TInput, TParams>`. Verbose but explicit.
- **Shape B** (intersection return): `CodecDescriptor<TParams> & { codecId: Id; traits: TTraits; factory: (p: TParams) => (ctx: SqlCodecInstanceContext) => Codec<Id, TTraits, TWire, TInput> }`. Less invasive at the interface level; consumers extract structurally.

The key constraint: extracting the typed `Codec` from the descriptor's type must NOT route through `D extends CodecDescriptor<infer P>` (which discards generics). Either the interface carries them as type parameters (Shape A), or the `defineCodec` return intersects in the typed factory (Shape B).

**Verification.** A negative type test in `packages/2-sql/4-lanes/relational-core/test/`:
```typescript
const d = defineCodec({factory: () => () => buildSqlCodec({typeId: 'pg/int4@1' as const, encode: (n: number) => Buffer.from([n]), decode: (b: Buffer) => b[0]!})});
type C = ResolvedCodec<typeof d>; // however we name the extractor
expectTypeOf<C>().toEqualTypeOf<Codec<'pg/int4@1', readonly [], Buffer, number>>();
```

### AC-0.2. Per-target descriptor records carry typed shape

Per-package descriptor records preserve each entry's full descriptor type by inference:
- `packages/3-targets/3-targets/postgres/src/core/codecs.ts` — `PgDescriptors`.
- `packages/3-targets/3-targets/sqlite/src/core/codecs.ts` — `SqliteDescriptors`.
- `packages/3-extensions/pgvector/src/core/codecs.ts` — `PgvectorDescriptors`.
- `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts` — `SqlDescriptors`.
- `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts` — `ArktypeJsonDescriptors`.

`PgDescriptors['uuidv4']` is *not* `CodecDescriptor<void>`; it carries the descriptor's full inferred shape from which `Codec<'pg/uuid@1', readonly [...], Buffer, string>` is recoverable.

**Verification.** Negative type tests in each package's `test/` directory.

### AC-0.3. No-emit authoring chain types end-to-end

The no-emit authoring chain (using `examples/prisma-next-demo/prisma/contract.ts` + `prisma-no-emit/context.ts` as the reference shape) types every step:

- `field.uuidv4()` returns a field spec whose codec generic is `Codec<'pg/uuid@1', ..., Buffer, string>`.
- `defineContract({target: postgresPack, family: sqlFamily, extensionPacks: {pgvector}}, ...)` produces a contract type carrying per-column codec types (e.g. `User.fields.id` → `pg/uuid@1` codec; `Post.fields.embedding` → `pg/vector@1` codec).
- `sqlBuilder<typeof contract>({context})`-produced query expressions accept correctly-typed parameters and reject incorrectly-typed ones.

**Verification.** A `*.test-d.ts` constructive test in the no-emit chain. Both positive (correct types compile) and negative (wrong types fail) cases.

### AC-0.4. Emit-path `contract.d.ts` typed `TypeMaps` derivation works

The emitter, given a descriptor record, produces a `contract.d.ts` whose `TypeMaps` projection has correct per-codec-id `{input, output, traits}` shapes. Generated text matches the post-TML-2229 baseline byte-for-byte.

**Verification.** `pnpm fixtures:check` passes across all fixture pairs.

### AC-0.5. Legacy `mkCodec` typed-instance source becomes deletable

After AC-0.1–AC-0.4 land, the typed flow no longer depends on `mkCodec` (the legacy `codec()`-renamed factory) being a public surface. The factory may still exist as an *internal* helper (e.g. `buildSqlCodec`) called inside `defineCodec` factory closures, but its public export from `@prisma-next/sql-relational-core/ast` is no longer load-bearing for type flow.

This AC is the precondition for parent spec AC-3 (Codec narrow), AC-7 (closing-grep zero), and the M2 R4 deletion path that was rolled back.

**Verification.** AC-0.5 is verified at a later milestone (M2 R4 retry); for this sub-spec, it is sufficient to demonstrate that AC-0.1–AC-0.3 work *without consulting any `mkCodec`-call-result instance for type information* — the typed-flow path runs entirely through descriptors.

### AC-0.6. Validation gates green throughout

- `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm test:packages`, `pnpm test:e2e`, `pnpm build` all green at every commit boundary.
- No new type casts in production code. No `any`. No `@ts-expect-error` outside negative type tests. No `@ts-nocheck`. No biome suppressions.
- Demo emit byte-identical against the post-TML-2229 baseline (`origin/main`).

## Non-goals

- **`byScalar` map cleanup.** The `byScalar` slot on each target package's codec module is an antipattern (adapters import codec maps from targets at registration time — adapters that need codecs should own them, not import them). Logged as a separate ticket. During implementation of this sub-spec, if `byScalar`'s presence obstructs the type-flow fix, it MAY be deleted opportunistically; otherwise it stays for now and the cleanup ticket handles it later. See [TML-2393](https://linear.app/prisma-company/issue/TML-2393).

- **Heterogeneous descriptor storage ergonomics.** Whether `AnyCodecDescriptor` becomes 5-arg (under Shape A) or stays 1-arg (under Shape B) is the implementation choice. Both shapes are admissible for AC-0.1.

- **Mongo type flow.** Mongo doesn't use this descriptor record pattern at HEAD; its wire-dispatch path is reshaped under [TML-2324](https://linear.app/prisma-company/issue/TML-2324). Out of scope.

- **Renaming `defineCodec` / `CodecDescriptor`.** Names stay; only the type signatures change.

## References

- [TML-2229](https://linear.app/prisma-company/issue/TML-2229) — codec-registry-unification (parent project where this regression was introduced).
- Parent spec: [`spec.md`](../spec.md) — TML-2357 canonical spec; this sub-spec is a precondition for AC-1 / AC-2 / AC-3 / AC-7.
- [`wip/unattended-decisions.md` Decision #11](../../../wip/unattended-decisions.md) — diagnosis of the M2 R4 type-system failure that surfaced this problem.
- [`packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:587-593`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) — current `defineCodec` declaration, where the variance erasure happens.
- [`examples/prisma-next-demo/prisma/contract.ts`](../../../examples/prisma-next-demo/prisma/contract.ts), [`examples/prisma-next-demo/src/prisma-no-emit/context.ts`](../../../examples/prisma-next-demo/src/prisma-no-emit/context.ts) — reference no-emit authoring chain.
