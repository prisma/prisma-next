# Phase 1.6: Codec-Owned Value Serialization — Execution Plan

## Summary

Replace the hardcoded bigint/Date value serialization branches scattered across six locations with codec-dispatched `encodeJson`/`decodeJson` methods. Extract a common `Codec` base interface to the framework layer so both SQL and Mongo families share it. After this phase, adding a new non-JSON-safe type means implementing two methods on a codec — not touching six files across four packages.

**ADR:** [ADR 184 — Codec-owned value serialization](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md)

**Linear:** [TML-2202](https://linear.app/prisma-company/issue/TML-2202)

**Spec:** [projects/orm-consolidation/spec.md](../spec.md)

## Collaborators

| Role  | Person | Context                                          |
| ----- | ------ | ------------------------------------------------ |
| Maker | Will   | Drives execution                                 |
| FYI   | Alexey | SQL ORM owner — no SQL ORM changes in Phase 1.6  |

## Key references (implementation)

### Codec interfaces and factories

- SQL `Codec` interface + `CodecRegistry` + `codec()` factory: [`sql-relational-core/src/ast/codec-types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts)
- Mongo `MongoCodec` interface + `mongoCodec()` factory: [`mongo-codec/src/codecs.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts)
- Mongo `MongoCodecRegistry`: [`mongo-codec/src/codec-registry.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codec-registry.ts)
- Postgres codec implementations: [`adapter-postgres/src/core/codecs.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/codecs.ts)

### Emission pipeline

- `emit()` entry point: [`control-plane/src/emission/emit.ts`](../../../packages/1-framework/1-core/migration/control-plane/src/emission/emit.ts)
- `EmitStackInput`: [`control-plane/src/emission/types.ts`](../../../packages/1-framework/1-core/migration/control-plane/src/emission/types.ts)
- `TargetFamilyHook` + `ValidationContext`: [`framework-components/src/emission-types.ts`](../../../packages/1-framework/1-core/shared/framework-components/src/emission-types.ts)
- SQL emitter hook (generates `contract.d.ts`): [`sql-contract-emitter/src/index.ts`](../../../packages/2-sql/3-tooling/emitter/src/index.ts)
- `bigintJsonReplacer` + tagged types: [`contract/src/types.ts`](../../../packages/1-framework/0-foundation/shared/contract/src/types.ts)
- `canonicalizeContract` (uses `bigintJsonReplacer`): [`contract/src/canonicalization.ts`](../../../packages/1-framework/0-foundation/shared/contract/src/canonicalization.ts)

### Authoring (encoding defaults)

- `encodeDefaultLiteralValue`: [`sql-contract-ts/src/build-contract.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/build-contract.ts)
- PSL printer (tagged bigint handling): [`psl-printer/src/default-mapping.ts`](../../../packages/1-framework/2-authoring/psl-printer/src/default-mapping.ts), [`psl-printer/src/raw-default-parser.ts`](../../../packages/1-framework/2-authoring/psl-printer/src/raw-default-parser.ts)

### Contract loading / validation

- SQL `validateContract` + `decodeContractDefaults`: [`sql-contract/src/validate.ts`](../../../packages/2-sql/1-core/contract/src/validate.ts)
- Framework `validateContract`: [`contract/src/validate-contract.ts`](../../../packages/1-framework/0-foundation/shared/contract/src/validate-contract.ts)

### DDL rendering (deferred — not in scope for Phase 1.6)

- `renderDefaultLiteral`: [`target-postgres/src/core/migrations/planner-ddl-builders.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts)

### Type generation

- `DefaultLiteralValue<>` conditional type: [`sql-contract-emitter/src/index.ts`](../../../packages/2-sql/3-tooling/emitter/src/index.ts) (lines 309–314)
- `serializeValue`: [`emitter/src/domain-type-generation.ts`](../../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts), [`sql-contract-emitter/src/index.ts`](../../../packages/2-sql/3-tooling/emitter/src/index.ts) (lines 467–497)

## Architecture

### Current flow (six hardcoded branches)

```
Authoring                    Emission                     Loading
─────────                    ────────                     ───────
encodeDefaultLiteralValue    bigintJsonReplacer           decodeContractDefaults
  bigint → {$type:'bigint'}    bigint → {$type:'bigint'}    {$type:'bigint'} → BigInt()
  Date → ISO string            (JSON.stringify replacer)     {$type:'raw'} → unwrap
  {$type:...} → {$type:'raw'}
```

### Target flow (codec dispatch)

```
Authoring                    Emission                     Loading
─────────                    ────────                     ───────
codec.encodeJson(value)      codec.encodeJson(value)      codec.decodeJson(json)
  ↓ lookup by codecId          ↓ walk contract values        ↓ lookup by codecId
  Date → ISO string            Date → ISO string             ISO string → Date
  number → number              number → number               number → number
  string → string              string → string               string → string
```

No tags, no collision guards, no `JSON.stringify` replacer. The codec registry is the single dispatch mechanism.

### Interface design

```ts
// Framework layer — shared by SQL and Mongo
interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;

  encode?(value: TJs): TWire;
  decode(wire: TWire): TJs;

  encodeJson(value: TJs): JsonValue;
  decodeJson(json: JsonValue): TJs;
}

// SQL layer — extends with SQL-specific fields
interface SqlCodec<...> extends Codec<...> {
  readonly meta?: CodecMeta;
  readonly paramsSchema?: Type<TParams>;
  readonly init?: (params: TParams) => THelper;
}
```

The `codec()` and `mongoCodec()` factories provide identity defaults for `encodeJson`/`decodeJson` when not explicitly supplied.

### Packages touched

| Package | Layer | What changes |
|---------|-------|-------------|
| `@prisma-next/contract` | framework/foundation | New `Codec` base interface + `CodecTrait` type. Remove `TaggedBigInt`, `TaggedRaw`, `TaggedLiteralValue`, `bigintJsonReplacer`, collision guard types. |
| `@prisma-next/sql-relational-core` | sql/lanes | `Codec` extends framework base. `codec()` factory adds `encodeJson`/`decodeJson` identity defaults. |
| `@prisma-next/mongo-codec` | mongo/foundation | `MongoCodec` extends or aliases framework base. `mongoCodec()` factory adds identity defaults. |
| `@prisma-next/adapter-postgres` | targets/adapters | Implement `encodeJson`/`decodeJson` on `pg/timestamptz@1`, `pg/timestamp@1`. |
| `@prisma-next/sql-contract-ts` | sql/authoring | Replace `encodeDefaultLiteralValue` with codec dispatch. |
| `@prisma-next/core-control-plane` | framework/core | Extend `EmitStackInput` with codec registry. Replace `bigintJsonReplacer` in `emit()` and `canonicalizeContract()`. |
| `@prisma-next/sql-contract` | sql/core | Replace `decodeContractDefaults`/`decodeDefaultLiteralValue` with codec dispatch. `validateContract` gains codec registry parameter. |
| `@prisma-next/sql-contract-emitter` | sql/tooling | Simplify `DefaultLiteralValue<>`. Update `serializeValue` for decoded types. |
| `@prisma-next/psl-printer` | framework/authoring | Remove tagged bigint handling from `default-mapping.ts` and `raw-default-parser.ts`. |
| `@prisma-next/target-postgres` | targets | Remove `isTaggedBigInt` usage from `renderDefaultLiteral` (use codec dispatch or passthrough — DDL rendering itself is deferred but tag removal is in scope). |
| `@prisma-next/family-sql` | sql/family | Remove `isTaggedBigInt` usage from `verify-sql-schema.ts`. |

### Generated fixtures that will change

Re-emitting contracts changes `DefaultLiteralValue<>` in all generated `contract.d.ts` files:

- `test/integration/test/fixtures/contract.d.ts`
- `test/e2e/framework/test/fixtures/generated/contract.d.ts`
- `packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.d.ts`
- `packages/2-sql/4-lanes/sql-builder/test/fixtures/generated/contract.d.ts`
- `examples/prisma-next-demo/src/prisma/contract.d.ts`

## Milestones

### Milestone 1: Framework codec base interface

Extract the common codec shape into a base interface at the framework layer. Both families extend it.

#### 1.1 Define base `Codec` interface at framework layer

Create the base interface in `@prisma-next/contract` (or a new foundation package if warranted). Include `id`, `targetTypes`, `traits`, `encode`, `decode`, `encodeJson`, `decodeJson`. Define `CodecTrait` as a shared type.

#### 1.2 SQL `Codec` extends framework base

Refactor `@prisma-next/sql-relational-core`'s `Codec` to extend the framework base, adding `meta`, `paramsSchema`, `init`. Update the `codec()` factory to provide identity `encodeJson`/`decodeJson` defaults. Verify all existing codec registrations still compile.

#### 1.3 Mongo `MongoCodec` extends framework base

Refactor `@prisma-next/mongo-codec`'s `MongoCodec` to extend or alias the framework base. Update the `mongoCodec()` factory. `MongoCodecTrait` unifies with `CodecTrait` if the trait vocabularies match (they do: both define `equality | order | boolean | numeric | textual`, Mongo adds `vector`).

#### 1.4 Tests

- Framework base interface type tests (codec with and without `encodeJson`/`decodeJson` overrides)
- SQL codecs still register and function with the extended interface
- Mongo codecs still register and function with the extended interface
- Identity defaults: a codec without explicit `encodeJson`/`decodeJson` passes values through unchanged

### Milestone 2: Concrete codec implementations

#### 2.1 Implement on Date codecs

Add `encodeJson`/`decodeJson` on `pg/timestamptz@1` and `pg/timestamp@1` in `adapter-postgres/src/core/codecs.ts`:

```ts
encodeJson: (value: Date) => value.toISOString(),
decodeJson: (json: JsonValue) => new Date(json as string),
```

#### 2.2 Verify identity codecs

Confirm that all other Postgres codecs (`pg/text@1`, `pg/int4@1`, `pg/int8@1`, `pg/float8@1`, `pg/bool@1`, `pg/uuid@1`, `pg/jsonb@1`, etc.) work correctly with identity `encodeJson`/`decodeJson` from the factory defaults.

#### 2.3 Tests

- `pg/timestamptz@1`: `encodeJson(new Date('2024-01-15'))` produces `"2024-01-15T00:00:00.000Z"`
- `pg/timestamptz@1`: `decodeJson("2024-01-15T00:00:00.000Z")` produces a `Date` equal to `new Date('2024-01-15')`
- `pg/int4@1`: `encodeJson(42)` produces `42`, `decodeJson(42)` produces `42` (identity)
- `pg/text@1`: `encodeJson("hello")` produces `"hello"`, `decodeJson("hello")` produces `"hello"` (identity)
- Round-trip: `decodeJson(encodeJson(value))` equals `value` for Date codecs

### Milestone 3: Emission — codec dispatch

Replace the tagged-value emission pipeline with codec-dispatched serialization.

#### 3.1 Extend `EmitStackInput`

Add a codec registry (or a minimal `{ get(id: string): Codec | undefined }` lookup interface) to `EmitStackInput` in `control-plane/src/emission/types.ts`.

#### 3.2 Replace `encodeDefaultLiteralValue` in authoring

In `sql-contract-ts/src/build-contract.ts`, replace `encodeDefaultLiteralValue` with a function that looks up the column's codec and calls `codec.encodeJson(value)`. The authoring builder needs access to the codec registry — either passed in or available from the builder's context.

#### 3.3 Replace `bigintJsonReplacer` in emission

In `control-plane/src/emission/emit.ts`, replace `JSON.stringify(canonicalized, bigintJsonReplacer, 2)` with a pre-pass that walks contract values and encodes them via codecs, followed by plain `JSON.stringify(encoded, null, 2)`.

In `contract/src/canonicalization.ts`, replace `bigintJsonReplacer` in `canonicalizeContract()` with the same approach. This changes contract hashes for contracts with non-JSON-safe defaults — an expected and acceptable consequence.

#### 3.4 Tests

- Emit a contract with a Date default → JSON contains ISO string, no `$type` tags
- Emit a contract with a number default → JSON contains the number directly
- Emit a contract with a JSON object default containing a `$type` key → JSON contains the object directly (no `raw` wrapper)
- Canonicalization produces deterministic output without `bigintJsonReplacer`
- Contract hash stability: contracts without non-JSON-safe defaults produce the same hash as before

### Milestone 4: Contract loading — codec dispatch

Replace `decodeContractDefaults` with codec-dispatched deserialization.

#### 4.1 Add codec registry to `validateContract`

Update SQL's `validateContract` in `sql-contract/src/validate.ts` to accept a codec registry parameter. The function calls `codec.decodeJson()` on literal default values (and any other serialized typed values) after structural validation.

#### 4.2 Implement codec-dispatched decoding

Replace `decodeContractDefaults` and `decodeDefaultLiteralValue` with a function that:

1. Walks all columns in `storage.tables`
2. For each column with a `{ kind: 'literal' }` default, looks up the column's `codecId` in the registry
3. Calls `codec.decodeJson(default.value)` to get the decoded value

#### 4.3 Update call sites

All callers of `validateContract` need to supply a codec registry. Key call sites:

- `ExecutionContext` / control instance creation (already has codec stack)
- Integration tests (need a test codec registry or the real one)
- E2E tests
- Demo app
- CLI operations

#### 4.4 Tests

- `validateContract` with codec registry decodes Date defaults correctly
- `validateContract` with codec registry passes through JSON-safe defaults unchanged
- Loading a contract.json with an ISO string default for a timestamptz column produces a `Date` in memory
- Round-trip: emit → load produces the original typed values

### Milestone 5: Type generation — `DefaultLiteralValue` simplification

#### 5.1 Simplify `DefaultLiteralValue` conditional type

In `sql-contract-emitter/src/index.ts`, replace the three-level conditional:

```ts
type DefaultLiteralValue<CodecId extends string, Encoded> =
  CodecId extends keyof CodecTypes
    ? CodecTypes[CodecId] extends { readonly output: infer O }
      ? O extends Date | bigint ? O : Encoded
      : Encoded
    : Encoded;
```

With a simpler form that derives the type from `CodecTypes` without hardcoding `Date | bigint`:

```ts
type DefaultLiteralValue<CodecId extends string, _Encoded> =
  CodecId extends keyof CodecTypes
    ? CodecTypes[CodecId]['output']
    : _Encoded;
```

This must also handle parameterized types where the output type depends on type parameters. For the emit path, the emitter can generate the resolved type inline per column. For the no-emit path, the conditional type above is the fallback.

#### 5.2 Update `serializeValue` if needed

`serializeValue` in the emitter renders runtime values as TypeScript literal types. If the encoded form changes (e.g., no more tagged bigint objects), the serializer needs to handle the new shapes.

#### 5.3 Re-emit test fixtures

Re-emit all generated `contract.d.ts` fixtures to reflect the new `DefaultLiteralValue` definition:

- `test/integration/test/fixtures/contract.d.ts`
- `test/e2e/framework/test/fixtures/generated/contract.d.ts`
- `packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.d.ts`
- `packages/2-sql/4-lanes/sql-builder/test/fixtures/generated/contract.d.ts`
- `examples/prisma-next-demo/src/prisma/contract.d.ts`

#### 5.4 Tests

- Generated `contract.d.ts` for a column with `pg/timestamptz@1` default has `readonly value: Date`
- Generated `contract.d.ts` for a column with `pg/int4@1` default has `readonly value: number` (identity codec — no change from current)
- Type-level test: `DefaultLiteralValue<'pg/timestamptz@1', string>` resolves to `Date`
- Type-level test: `DefaultLiteralValue<'pg/int4@1', 42>` resolves to `number`
- Parameterized type: a typed JSON column's default resolves to the schema type

### Milestone 6: Cleanup

Remove the tagged value infrastructure that is no longer needed.

#### 6.1 Remove tagged types from `@prisma-next/contract`

Delete from `contract/src/types.ts`:
- `TaggedBigInt` type and `isTaggedBigInt` guard
- `TaggedRaw` type and `isTaggedRaw` guard
- `TaggedLiteralValue` type
- `bigintJsonReplacer` function
- Update `ColumnDefaultLiteralValue` to just `JsonValue` (tags no longer exist)
- Update `ColumnDefaultLiteralInputValue` — remove `bigint` from the union (int8 uses `number`)

Remove re-exports from `contract/src/exports/types.ts`.

#### 6.2 Remove tag handling from consumers

- `@prisma-next/sql-contract`: remove `isBigIntColumn`, tagged value imports from `validate.ts`
- `@prisma-next/target-postgres`: remove `isTaggedBigInt` from `planner-ddl-builders.ts` and `statement-builders.ts`
- `@prisma-next/family-sql`: remove `isTaggedBigInt` from `verify-sql-schema.ts`
- `@prisma-next/psl-printer`: remove tagged bigint handling from `default-mapping.ts` and `raw-default-parser.ts`
- `@prisma-next/sql-contract-ts`: remove `TaggedRaw` import, `$type` collision guard from `build-contract.ts`

#### 6.3 Update tests

Tests that directly verify tagged value behavior need updating:

- `contract-ts/test/contract-builder.methods.test.ts` — tests for `encodeDefaultLiteralValue` (bigint tag, `$type` → `raw`)
- `sql-contract/test/validate.test.ts` — tests for `decodeDefaultLiteralValue` (bigint unwrap, raw unwrap)
- `contract/test/canonicalization.test.ts` — tests for `bigintJsonReplacer`
- `family-sql/test/schema-verify.defaults.test.ts` — tagged bigint in JSONB defaults
- `psl-printer/test/raw-default-parser.test.ts` — tagged bigint parsing
- `psl-printer/test/default-mapping.test.ts` — tagged bigint mapping

#### 6.4 Tests

- No remaining references to `$type`, `TaggedBigInt`, `TaggedRaw`, or `bigintJsonReplacer` in source code (excluding docs and ADR 167 historical context)
- All existing test suites pass
- `pnpm build` succeeds
- `pnpm typecheck` succeeds

## Test coverage

| Acceptance criterion | Test type | Milestone |
|---|---|---|
| Framework base `Codec` interface with `encodeJson`/`decodeJson` | Type test | 1.4 |
| SQL codecs extend framework base | Unit | 1.4 |
| Mongo codecs extend framework base | Unit | 1.4 |
| Identity defaults pass values through | Unit | 1.4 |
| `pg/timestamptz@1` `encodeJson` produces ISO string | Unit | 2.3 |
| `pg/timestamptz@1` `decodeJson` produces `Date` | Unit | 2.3 |
| Identity codecs round-trip correctly | Unit | 2.3 |
| Date default round-trips through `encodeJson`/`decodeJson` | Unit | 2.3 |
| Emit with Date default produces ISO string in JSON | Unit | 3.4 |
| Emit with no `$type` tags | Unit | 3.4 |
| `$type`-containing user objects emit without collision guard | Unit | 3.4 |
| Contract hash stable for JSON-safe defaults | Unit | 3.4 |
| `validateContract` decodes Date defaults via codec | Unit | 4.4 |
| `validateContract` passes through JSON-safe defaults | Unit | 4.4 |
| Emit → load round-trip produces original typed values | Integration | 4.4 |
| `DefaultLiteralValue` resolves to codec output type | Type test | 5.4 |
| Generated `contract.d.ts` has `Date` for timestamp defaults | Snapshot | 5.4 |
| Parameterized types resolve correctly in defaults | Type test | 5.4 |
| No remaining tagged value references in source | Grep check | 6.4 |
| All existing tests pass | Full suite | 6.4 |

## Follow-ups

### DDL literal codec (`DdlLiteralCodec`)

`renderDefaultLiteral` in `@prisma-next/target-postgres` currently has hardcoded bigint/Date branches for DDL rendering. ADR 184 defines a `DdlLiteralCodec` interface at the target/adapter layer, but it lands incrementally with migration work. Phase 1.6 removes the tagged value handling from `renderDefaultLiteral` but does not introduce the full `DdlLiteralCodec` dispatch.

### PSL literal codec (`PslLiteralCodec`)

Similarly, PSL printing of literal defaults currently uses hardcoded branches. The `PslLiteralCodec` interface from ADR 184 lands with authoring work. Phase 1.6 removes the tagged value handling but does not introduce PSL codec dispatch.

### Codec base interface extraction scope

Phase 1.6 extracts the common shape to the framework layer. Full unification of `CodecRegistry` and `MongoCodecRegistry` (shared registry interface) is a natural follow-up but not required for this phase.

### `ColumnDefaultLiteralInputValue` and `bigint` in authoring

The current authoring API accepts `bigint` as a column default input value (for int8 columns). With `pg/int8@1` staying `number`, the authoring layer should either reject `bigint` input for int8 columns or convert with a range check. This is a narrow authoring change that may land with Phase 1.6 or as a follow-up.

## Open items

1. **Where to place the framework base `Codec` interface.** Options: (a) in `@prisma-next/contract` alongside the contract types, (b) in a new `@prisma-next/codec` foundation package. The former is simpler; the latter is cleaner separation. Decide during milestone 1.

2. **`CodecTrait` unification.** SQL defines `CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual'`. Mongo defines `MongoCodecTrait` with the same set plus `'vector'`. The framework base should use the union of both. Should `vector` be in the shared set or a Mongo extension?

3. **Backward compatibility for `validateContract` callers.** Adding a codec registry parameter changes the public API. Consider whether to make it optional with a deprecation warning (decode without codec = identity/no-op), or require it immediately.

4. **Contract hash migration.** Removing `bigintJsonReplacer` from canonicalization changes hashes for contracts with bigint defaults. Since contracts are regenerated from source, this is expected. Verify that migration history (which stores contract hashes) handles the transition correctly.
