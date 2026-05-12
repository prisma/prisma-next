# Project 2 — Expanded type/operator surface

> **Linear:** [TML-2375](https://linear.app/prisma-company/issue/TML-2375). Component-level tracking only — no per-task or per-milestone Linear sub-issues.

# Summary

Expand `@prisma-next/extension-cipherstash` from "one column type, two operators" (Project 1) to the full CipherStash first-attempt surface: five new encrypted column types (`EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`); the `orderAndRange` operator family on strings, numerics and dates (`cipherstashGt/Gte/Lt/Lte`, `cipherstashBetween/NotBetween`); equality extensions (`cipherstashNe`, `cipherstashInArray/NotInArray`); free-text-search extensions (`cipherstashNotIlike`); JSON search (`cipherstashJsonbPathExists` predicate plus `cipherstashJsonbPathQueryFirst` / `cipherstashJsonbGet` SELECT-expression helpers); and sort helpers (`cipherstashAsc` / `cipherstashDesc`). Each type and operator instantiates Project 1's pattern. End-to-end-tested against live Postgres + EQL.

# Description

Project 1 shipped the canonical pattern — envelope class + parameterized codec + bulk-encrypt middleware participation + PSL constructor + TS factory + parity test + codec lifecycle hook + namespaced operator (empty traits, `eql_v2.<fn>(self, encryptedArg)` lowering) + type-visibility — for `EncryptedString` with `cipherstashEq` and `cipherstashIlike`. Project 2 instantiates the same pattern across the rest of the surface CipherStash users get in the team's official Drizzle integration ([`@cipherstash/stack/drizzle`](https://cipherstash.com/docs/stack/encryption/drizzle)). After Project 2, a Prisma Next user has feature parity with the Drizzle integration for the types and operators in scope.

The work cleaves cleanly along type/operator lines and lands as a single PR with one validation gate at the end. Adding a new type is mostly per-type wiring once the shared infrastructure is in place: a subclass of the `EncryptedEnvelopeBase<T>` abstract class, a parameterized codec descriptor, a codec lifecycle hook configured by the shared `makeCipherstashCodecHooks` factory, a PSL constructor / TS factory pair, an operator registry contribution, and an end-to-end test against live Postgres + EQL.

The original Project 2 mandate to implement `planTypeOperations` integration (and its framework prerequisites — per-column input, prior-state contract for destructive DDL) is obsolete: TML-2397's codec lifecycle hook is the framework-wide planner-integration mechanism, and each new type wires its own `onFieldEvent` arm via the shared factory.

# Decisions

This section records design decisions taken during shaping. Each captures the conclusion, the reasoning behind it, and the assumptions it rests on, so the maker (and future readers) doesn't have to re-derive them.

## D1 — SDK accepts JS values polymorphically

The framework-native `CipherstashSdk` interface (`packages/3-extensions/cipherstash/src/execution/sdk.ts`) shifts from string-typed (`bulkEncrypt({ values: ReadonlyArray<string> })`, `bulkDecrypt: Promise<ReadonlyArray<string>>`) to polymorphic (`bulkEncrypt({ values: ReadonlyArray<unknown> })`, `bulkDecrypt: Promise<ReadonlyArray<unknown>>`). Each batch is homogeneously-typed by virtue of its `(table, column)` routing key — a single column has a fixed JS type — so no per-batch `cast_as` hint is needed at the SDK boundary; the CipherStash SDK derives the cast from the search-config already registered on the column.

**Why.** The CipherStash team explicitly requested this shape. It avoids duplicating JS↔canonical-string adapters across five codecs and matches the SDK's existing internal handling of EQL's `i.t` / `i.c` schema markers.

**Assumes.** The wrapped real ZeroKMS SDK accepts heterogeneous JS values keyed only on `(table, column)`. The `CipherstashSdk` interface is one we own — we vendor it; the real SDK is wrapped — so we are free to shape it as the integration needs.

## D2 — Codec name reflects the underlying machine type

The numeric codec is `cipherstash/double@1`, not `cipherstash/number@1`. The bigint codec is `cipherstash/bigint@1`. The date codec is `cipherstash/date@1`. The boolean codec is `cipherstash/boolean@1`. The JSON codec is `cipherstash/json@1`.

**Why.** Codec ids are durable wire-level identifiers — once published they cannot be renamed without contract-breakage. Naming them after the machine type they encode (`double`, `bigint`) rather than the JS-language category (`number`) keeps the codec id meaningful when the language-level distinction is informative (JS `number` ≠ JS `bigint` ≠ EQL `int` ≠ EQL `big_int`).

The 5 codecs and their EQL cast types:

| Codec id | Plaintext type | EQL `cast_as` |
|---|---|---|
| `cipherstash/string@1` (already shipped) | `string` | `text` |
| `cipherstash/double@1` | `number` (IEEE-754) | `double` |
| `cipherstash/bigint@1` | `bigint` | `big_int` |
| `cipherstash/date@1` | `Date` (calendar date, no time) | `date` |
| `cipherstash/boolean@1` | `boolean` | `boolean` |
| `cipherstash/json@1` | JSON-serializable `unknown` | `jsonb` |

## D3 — Per-codec envelope class atop a shared abstract base

Each codec ships its own envelope class — `EncryptedString` (shipped), `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`. Each carries a typed plaintext slot. A shared abstract `EncryptedEnvelopeBase<T>` factors the ~130 lines that are identical across types (constructor, handle, `expose()`, `decrypt()` body, the five `[REDACTED]` overrides for `toJSON`/`toString`/`valueOf`/`[Symbol.toPrimitive]`/`[Symbol.for('nodejs.util.inspect.custom')]`, and the handle-mutator helpers).

Concrete subclasses provide only:
- `static from(plaintext: T): Self` — typed factory.
- `typeName` getter — for error messages.
- Optional: `parseDecryptedValue(sdkResult: unknown): T` — narrowing hook if the SDK's `Promise<unknown>` return needs type-narrowing on the read side. (For most codecs this is a no-op; for `EncryptedDate` it converts whatever the SDK returns to a `Date` instance.)
- Optional: `encodeJson` representation — placeholder for `JSON.stringify` (each type returns a distinct `{ $encryptedX: '<opaque>' }` shape).

**Why.** Four new envelope classes × ~130 shared lines = ~520 lines of pure duplication avoided. Strong typing per type (the user gets `Promise<Date>` from `envelope.decrypt()` on an `EncryptedDate`, not `Promise<unknown>` cast at the call site). Matches Project 1's already-tested per-class shape.

**Assumes.** The `[REDACTED]` redaction overrides are identical for every type (no per-type customization needed).

## D4 — Shared codec lifecycle hook factory

`packages/3-extensions/cipherstash/src/migration/codec-hooks-factory.ts` exports `makeCipherstashCodecHooks({ flagToIndex, castAs })`. Each codec configures:
- `flagToIndex: Readonly<Record<FlagName, CipherstashSearchIndex>>` — its own set of search-mode flags and the EQL index name each enables.
- `castAs: string` — the EQL cast type to pass to `eql_v2.add_search_config(...)`.

The factory returns a `CodecControlHooks` implementing `onFieldEvent` over the configured flag set and `expandNativeType` as the identity (matching today's `cipherstashStringCodecHooks`).

The existing `cipherstashStringCodecHooks` is refactored to use the factory as a behavior-preserving change. The string codec's hook config becomes:

```typescript
export const cipherstashStringCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { equality: 'unique', freeTextSearch: 'match', orderAndRange: 'ore' },
  castAs: 'text',
});
```

**Why.** Five codecs would otherwise duplicate ~80 lines of identical `onFieldEvent` walk loop. The factory collapses that to a single declarative config per codec.

**Assumes.** Every cipherstash codec maps each search-mode flag 1:1 to one EQL index, and the `cast_as` per codec is a static per-codec property (no per-column overrides needed).

## D5 — `CipherstashSearchIndex` widens to the full EQL vocabulary

`CipherstashSearchIndex` in `packages/3-extensions/cipherstash/src/migration/call-classes.ts` widens from `'unique' | 'match'` to `'unique' | 'match' | 'ore' | 'ste_vec'` — the full set EQL's `add_search_config` accepts. The existing `cipherstashAddSearchConfig` / `cipherstashRemoveSearchConfig` factories handle the new index names without further change (they already accept `index` and `castAs` parameters).

**Why.** All four EQL index types are used in Project 2: `'unique'` (equality), `'match'` (free-text search), `'ore'` (order-and-range), `'ste_vec'` (JSON search).

## D6 — `EncryptedString` gains `orderAndRange` in this project

CipherStash's Drizzle integration accepts `orderAndRange` on `encryptedType<string>`, enabling range queries on encrypted strings. Project 1 shipped `EncryptedString({ equality?, freeTextSearch? })` only. Project 2 extends this constructor to accept `orderAndRange?` as well — a small backwards-compatible addition to the PSL constructor, TS factory, parity test, and parameterized codec descriptor for `cipherstash/string@1`. The codec hook (now using the factory) picks up the new flag with one new entry in `flagToIndex`.

**Why.** Surface-completeness against CipherStash Drizzle. Strings are orderable (EQL `cast_as: 'text'` with `'ore'` index works), and CipherStash already ships this for Drizzle users. Closing it off would be a deliberate divergence with no upside.

## D7 — Operator surface decomposes into column methods and free-standing helpers

The cipherstash operator surface for Project 2 splits along the framework's natural cleavage between predicate operators (return a boolean-trait codec) and non-predicate operators (return non-boolean codecs):

| Operator | Surface | Required flag | Notes |
|---|---|---|---|
| `cipherstashEq` (shipped) | column method | `equality` | |
| `cipherstashNe` | column method | `equality` | |
| `cipherstashInArray` | column method (var-arity) | `equality` | |
| `cipherstashNotInArray` | column method (var-arity) | `equality` | |
| `cipherstashIlike` (shipped) | column method | `freeTextSearch` | |
| `cipherstashNotIlike` | column method | `freeTextSearch` | |
| `cipherstashGt` | column method | `orderAndRange` | |
| `cipherstashGte` | column method | `orderAndRange` | |
| `cipherstashLt` | column method | `orderAndRange` | |
| `cipherstashLte` | column method | `orderAndRange` | |
| `cipherstashBetween` | column method (3-arg) | `orderAndRange` | |
| `cipherstashNotBetween` | column method (3-arg) | `orderAndRange` | |
| `cipherstashJsonbPathExists` | column method | `searchableJson` | |
| `cipherstashAsc` | **free-standing helper** | `orderAndRange` | Returns `OrderByItem` |
| `cipherstashDesc` | **free-standing helper** | `orderAndRange` | Returns `OrderByItem` |
| `cipherstashJsonbPathQueryFirst` | **free-standing helper** | `searchableJson` | Returns `Expression` for SELECT |
| `cipherstashJsonbGet` | **free-standing helper** | `searchableJson` | Returns `Expression` for SELECT |

**Why the split.** Predicate operators (return type carries the `'boolean'` trait) flow through the framework's existing `SqlOperationDescriptor` registry path; the model accessor (`packages/3-extensions/sql-orm-client/src/model-accessor.ts:170-178`) detects predicates via the return codec's traits and returns the raw AST for WHERE clauses. Non-predicate operators on cipherstash columns can't use this path productively — cipherstash codecs declare empty traits to block built-in `.eq()` / `.asc()` chaining, so the registry's non-predicate result (chainable comparison methods keyed by return-codec traits) collapses to an empty object. The natural shape for sort and SELECT-expression operations is therefore a free-standing helper that consumes a column accessor and returns the right AST node directly (`OrderByItem` for sort, `Expression<ScopeField>` for SELECT-expressions). This mirrors CipherStash Drizzle's `encryptionOps.asc(col)` / `encryptionOps.jsonbPathQueryFirst(col, path)` shape.

**User-facing import shape.** Predicates are reached via column accessor autocomplete (`m.email.cipherstashEq(...)`). The four helpers are imported from `@prisma-next/extension-cipherstash/runtime`:

```typescript
import { cipherstashAsc, cipherstashJsonbPathExists } from '@prisma-next/extension-cipherstash/runtime';

const rows = await db.user.findMany()
  .orderBy((u) => cipherstashAsc(u.age));
```

**Assumes.** Two import sites for the operator surface is acceptable. The split is documented in the package README so users know the distinction. The TypeScript type system enforces the boundary naturally — `OrderByItem` is not assignable to `Expression<ScopeField>` and vice versa.

## D8 — Sort and JSON-SELECT lowerings use existing AST primitives

`cipherstashAsc(col)` constructs `OrderByItem.asc(eqlOrderByWrap(col))` where `eqlOrderByWrap(col)` is the package-internal helper that wraps a column reference in the appropriate EQL ORDER BY-friendly expression. The exact wrapping shape (whether EQL needs a function call like `eql_v2.order_by(col)` or whether bare `<` / `>` overloading on `eql_v2_encrypted` is sufficient) is an implementation detail confirmed at integration time against the live EQL bundle.

`cipherstashJsonbPathQueryFirst(col, path)` lowers to `eql_v2.jsonb_path_query_first({{col}}, {{path}})` (returns `eql_v2_encrypted`). `cipherstashJsonbGet(col, path)` lowers to `eql_v2."->"({{col}}, {{path}})` using the `(eql_v2_encrypted, text)` overload (returns `eql_v2_encrypted`). Both construct `RawSqlExpr` (the AST node Project 1 ships) wrapping the column ref + path string. The path is treated as a SQL literal — JSONpath / JSON-key strings are user-authored static literals, not user-controlled runtime values, so SQL-injection concerns do not apply at the framework level.

**Why.** No new framework substrate. Both shapes consume primitives Project 1 already ships (`OrderByItem`, `RawSqlExpr`).

## D9 — Mode-flag downgrade is handled by the existing destructive-op classification

The codec hook factory already classifies `cipherstashRemoveSearchConfig` calls as `'destructive'` (via the `CipherstashRemoveSearchConfigCall` class shipped in Project 1). The planner's existing handling of destructive ops surfaces them in plan output and supports the framework's standard mechanisms for gating destructive migrations. No new policy is introduced in Project 2.

**Why.** Project 1's `CipherstashRemoveSearchConfigCall.operationClass = 'destructive'` already exists. The framework's destructive-op surfacing is the canonical mechanism; introducing a cipherstash-specific warning would duplicate functionality.

## D10 — Re-encryption migration is out of scope

Adopting cipherstash for an existing populated column — flipping a column from plain `Number` to `EncryptedDouble` with rows in place — requires re-encrypting existing row data. The codec hook fires `'altered'` for the type change and emits the right search-config DDL, but does not touch existing row data. The framework primitive for "re-encrypt existing rows" is unspecified. Could be a hand-authored `dataTransform` op the user invokes once, or a generated planner-emitted op. **Out of scope for Project 2.** Documented as a known limitation in the package README; tracked as a future framework primitive if customer demand surfaces.

## D11 — Single PR with one validation gate

All work lands on a single branch and ships as a single PR. There is no milestone breakdown into separately-shippable units. The validation gate at the end of the work runs `pnpm test:packages && pnpm test:integration && pnpm test:e2e && pnpm lint:deps && pnpm --filter cipherstash-integration-example typecheck`.

**Why.** The work is internally coherent — adding new types and operators to a single extension — and individual types ship at low marginal cost once the shared infrastructure is in place. Breaking it into milestones with their own PR cadences would multiply the merge cost without separating concerns that actually need separating.

**Assumes.** PR review can handle a ~2000-line change without bogging down. If the work expands materially during execution, the project can be re-cleaved at that point.

# Functional Requirements

## FR1 — Generalized SDK surface

`CipherstashSdk.bulkEncrypt` accepts `ReadonlyArray<unknown>` and `bulkDecrypt` returns `Promise<ReadonlyArray<unknown>>`. Mock SDK fixtures used by package tests are updated to the polymorphic shape; mock SDKs round-trip the input values verbatim (the real SDK encrypts; mocks pass through).

## FR2 — Shared `EncryptedEnvelopeBase<T>`

`packages/3-extensions/cipherstash/src/execution/envelope-base.ts` exports an abstract `EncryptedEnvelopeBase<T>` class encapsulating the handle, `expose()`, `decrypt({signal?})`, and the five redaction overrides. The existing `EncryptedString` (`./envelope.ts`) refactors to extend the base as a behavior-preserving change; all existing tests pass without modification.

## FR3 — Five new envelope classes

Each new envelope class:
- Lives in `packages/3-extensions/cipherstash/src/execution/envelopes/<type>.ts`.
- Extends `EncryptedEnvelopeBase<T>` with the appropriate `T`.
- Exposes a `static from(plaintext: T): Self` constructor.
- Exposes `static fromInternal(args): Self` matching the existing `EncryptedString.fromInternal` shape, used by the codec's `decode` path.
- Re-exports from `@prisma-next/extension-cipherstash/runtime`.

| Class | `T` | Module path |
|---|---|---|
| `EncryptedDouble` | `number` | `execution/envelopes/double.ts` |
| `EncryptedBigInt` | `bigint` | `execution/envelopes/bigint.ts` |
| `EncryptedDate` | `Date` | `execution/envelopes/date.ts` |
| `EncryptedBoolean` | `boolean` | `execution/envelopes/boolean.ts` |
| `EncryptedJson` | `unknown` (JSON-serializable) | `execution/envelopes/json.ts` |

## FR4 — Five new parameterized codec descriptors

Each codec descriptor mirrors the existing `cipherstash/string@1` shape from `packages/3-extensions/cipherstash/src/execution/parameterized.ts`:
- `codecId` per D2.
- `targetTypes: ['eql_v2_encrypted']` (same as string — all cipherstash columns share the EQL composite type).
- `traits: []` (per Project 1's empty-traits decision).
- `paramsSchema` — an arktype schema for the codec's typeParams (the search-mode flags).
- `meta: { db: { sql: { postgres: { nativeType: 'eql_v2_encrypted' } } } }`.
- `renderOutputType(_params): string` returning the bare type name (`'EncryptedDouble'`, etc.).
- `factory(params) => (ctx) => codec` returning the SDK-bound codec instance (same shared-codec pattern as today).

The codec runtime body for each codec follows the existing `CipherstashStringCodec` pattern with two differences:
- `encode(envelope, ctx)` extracts the ciphertext from the envelope handle (identical to today; the ciphertext is opaque per-cell `unknown`).
- `decode(wire, ctx)` constructs the right envelope subclass via `<TypeName>.fromInternal({...})`.

The factory `createParameterizedCodecDescriptors(sdk)` in `parameterized.ts` extends to return descriptors for all six codecs (string + five new).

## FR5 — Five new codec lifecycle hook configurations

`packages/3-extensions/cipherstash/src/migration/codec-hooks-factory.ts` exports `makeCipherstashCodecHooks({ flagToIndex, castAs })`. Each codec's hook is a single call to the factory:

```typescript
export const cipherstashStringCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { equality: 'unique', freeTextSearch: 'match', orderAndRange: 'ore' },
  castAs: 'text',
});

export const cipherstashDoubleCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { equality: 'unique', orderAndRange: 'ore' },
  castAs: 'double',
});

export const cipherstashBigIntCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { equality: 'unique', orderAndRange: 'ore' },
  castAs: 'big_int',
});

export const cipherstashDateCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { equality: 'unique', orderAndRange: 'ore' },
  castAs: 'date',
});

export const cipherstashBooleanCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { equality: 'unique' },
  castAs: 'boolean',
});

export const cipherstashJsonCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: { searchableJson: 'ste_vec' },
  castAs: 'jsonb',
});
```

The extension descriptor (`exports/control.ts`) wires all six entries into `types.codecTypes.controlPlaneHooks[<codecId>]`.

## FR6 — PSL constructors and TS factories (six total — string updated; five new)

### PSL constructors (`contract/authoring.ts`)

`cipherstashAuthoringTypes.cipherstash` namespace gains five new entries plus an extended `EncryptedString` entry. Constructor argument shape mirrors the existing `EncryptedString({ equality?, freeTextSearch? })` pattern. Each constructor takes one optional object argument with optional boolean flags:

| PSL type | Flags | Defaults |
|---|---|---|
| `EncryptedString` (extended) | `equality`, `freeTextSearch`, `orderAndRange` | all `true` |
| `EncryptedDouble` | `equality`, `orderAndRange` | both `true` |
| `EncryptedBigInt` | `equality`, `orderAndRange` | both `true` |
| `EncryptedDate` | `equality`, `orderAndRange` | both `true` |
| `EncryptedBoolean` | `equality` | `true` |
| `EncryptedJson` | `searchableJson` | `true` |

The defaults are `true` per Project 1's "searchable by default" precedent — searchable encryption is the legitimate default for an extension whose entire reason for existing is to make encrypted columns queryable.

### TS factories (`exports/column-types.ts`)

One per PSL constructor — `encryptedString`, `encryptedDouble`, `encryptedBigInt`, `encryptedDate`, `encryptedBoolean`, `encryptedJson`. Each is the TS counterpart that lowers to the same `ColumnTypeDescriptor` shape as the PSL constructor.

### Parity tests

Each new constructor ships a parity test fixture under `packages/3-extensions/cipherstash/test/integration/parity/`. Mirrors the existing `cipherstash-encrypted-string/` fixture.

## FR7 — Operator surface

### Predicate operators (column methods)

Twelve new predicate operators register through `cipherstashQueryOperations()` in `packages/3-extensions/cipherstash/src/execution/operators.ts`. Each follows the existing `cipherstashEq` / `cipherstashIlike` pattern:
- `self: { codecId: <cipherstash-codec-id> }` (some operators register against multiple codec ids — e.g. `cipherstashGt` registers against `cipherstash/string@1`, `cipherstash/double@1`, `cipherstash/bigint@1`, `cipherstash/date@1`).
- `impl(self, ...args)` wraps user args in the appropriate envelope, stamps routing context, returns `Expression<{codecId: 'pg/bool@1', nullable: false}>` via `buildOperation`.
- Lowering template: `eql_v2.<fn>({{self}}, {{arg0}})` for single-arg operators, `eql_v2.<fn>({{self}}, {{arg0}}, {{arg1}})` for three-arg `between` / `notBetween`, dynamic `(eql_v2.eq({{self}}, {{arg0}}) OR eql_v2.eq({{self}}, {{arg1}}) OR ...)` for variable-arity `inArray` / `notInArray`.

The new operators and their lowering targets:

| Operator | EQL function (or composition) |
|---|---|
| `cipherstashNe` | `NOT eql_v2.eq({{self}}, {{arg0}})` |
| `cipherstashInArray` | `(eql_v2.eq({{self}}, {{arg0}}) OR eql_v2.eq({{self}}, {{arg1}}) OR ...)` |
| `cipherstashNotInArray` | `NOT (eql_v2.eq({{self}}, {{arg0}}) OR ...)` |
| `cipherstashNotIlike` | `NOT eql_v2.ilike({{self}}, {{arg0}})` |
| `cipherstashGt` | `eql_v2.gt({{self}}, {{arg0}})` |
| `cipherstashGte` | `eql_v2.gte({{self}}, {{arg0}})` |
| `cipherstashLt` | `eql_v2.lt({{self}}, {{arg0}})` |
| `cipherstashLte` | `eql_v2.lte({{self}}, {{arg0}})` |
| `cipherstashBetween` | `eql_v2.gte({{self}}, {{arg0}}) AND eql_v2.lte({{self}}, {{arg1}})` |
| `cipherstashNotBetween` | `NOT (eql_v2.gte({{self}}, {{arg0}}) AND eql_v2.lte({{self}}, {{arg1}}))` |
| `cipherstashJsonbPathExists` | `eql_v2.jsonb_path_exists({{self}}, {{arg0}})` |

### Free-standing helpers

Four helpers exported from `@prisma-next/extension-cipherstash/runtime`:

```typescript
export function cipherstashAsc(col: Expression<ScopeField>): OrderByItem;
export function cipherstashDesc(col: Expression<ScopeField>): OrderByItem;
export function cipherstashJsonbPathQueryFirst(col: Expression<ScopeField>, path: string): Expression<...>;
export function cipherstashJsonbGet(col: Expression<ScopeField>, path: string): Expression<...>;
```

Each helper:
- Inspects the column's codec id to validate the column is a cipherstash-encrypted column. Throws a descriptive error on mismatch.
- Constructs the appropriate AST node directly (`OrderByItem.asc/desc(...)` for sort, `RawSqlExpr` for JSON SELECT-expression helpers).
- Does not participate in the operator registry.

### Type-visibility (`types/operation-types.ts`)

The flat `QueryOperationTypes` type extends to declare type signatures for the 13 new column-method operators, gated per codec id. Each registration mirrors the existing `cipherstashEq` / `cipherstashIlike` entries.

The four free-standing helpers are typed at the function declaration site; no `QueryOperationTypes` entry is needed.

## FR8 — Bulk-encrypt middleware extension

The middleware in `packages/3-extensions/cipherstash/src/middleware/bulk-encrypt.ts` currently filters params by `codecId === 'cipherstash/string@1'`. Project 2 widens the filter to match any cipherstash codec id (prefix match on `'cipherstash/'`, or explicit set from the runtime descriptor's `parameterizedCodecs`). The routing-key grouping is unchanged — `(table, column)` is still the bulk-batch key, and homogeneity-by-column means each batch is naturally typed.

## FR9 — `decryptAll` extension

`packages/3-extensions/cipherstash/src/execution/decrypt-all.ts` walks for `EncryptedEnvelopeBase` instances (not specifically `EncryptedString`). Each found envelope's `(table, column)` routing context groups it for bulk decryption; the SDK's `bulkDecrypt: Promise<ReadonlyArray<unknown>>` returns the polymorphic plaintext array that the envelope subclass's `parseDecryptedValue` narrows to its `T`.

## FR10 — Example app extension

`examples/cipherstash-integration` extends its schema with one column of each new type and a sample query exercising at least one new operator per type. The example's `typecheck` script doubles as the positive type-visibility test substrate.

# Non-Functional Requirements

- **No regression in the existing string surface.** All currently-passing tests in `@prisma-next/extension-cipherstash` and the example app continue to pass without modification. Behaviour-preserving refactors (envelope base extraction, codec-hook factory adoption for the string codec) are verified by the existing test suite.
- **Bulk amortization is preserved.** Per-query encrypt collapses to one SDK call per `(table, column)` routing key, irrespective of how many columns or types are in the query. `decryptAll` collapses similarly.
- **Cancellation is wired everywhere.** `ctx.signal` is forwarded to the SDK on every call path on every codec (already wired for string; new envelopes inherit from the base).
- **Per-cell `decrypt()` is acceptable but not optimal.** Same posture as Project 1.

# Acceptance Criteria

The single PR is review-ready when all of the following are green.

## AC-PKG — Package shape and layering

- [ ] **AC-PKG1**: `pnpm --filter @prisma-next/extension-cipherstash build` succeeds. New subpath exports (if any) register correctly.
- [ ] **AC-PKG2**: `pnpm lint:deps` passes. No new package layering violations introduced.

## AC-SDK — Generalized SDK contract

- [ ] **AC-SDK1**: `CipherstashSdk.bulkEncrypt` accepts `ReadonlyArray<unknown>`; `bulkDecrypt` returns `Promise<ReadonlyArray<unknown>>`. Type-test in the package's unit tests pins the interface shape.
- [ ] **AC-SDK2**: Mock SDK fixtures used by package tests are updated; all existing `cipherstash/string@1` tests pass without behavioural change.

## AC-ENV — Envelope class hierarchy

- [ ] **AC-ENV1**: `EncryptedEnvelopeBase<T>` exists in `execution/envelope-base.ts` and encapsulates the handle, `decrypt({signal?}): Promise<T>`, `expose()`, and the five redaction overrides.
- [ ] **AC-ENV2**: `EncryptedString` refactors to extend `EncryptedEnvelopeBase<string>` with no behavioural change.
- [ ] **AC-ENV3**: For each of `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`: a concrete subclass exists with the correct `T`, a `static from(...)` constructor, and a `fromInternal` factory. Each is re-exported from the `/runtime` subpath.
- [ ] **AC-ENV4**: For each envelope, the five redaction overrides return `[REDACTED]` (regression-pinned).
- [ ] **AC-ENV5**: `JSON.stringify(envelope)` returns the placeholder shape `{ "$encryptedX": "<opaque>" }` for each type X.

## AC-CODEC — Parameterized codecs

- [ ] **AC-CODEC1**: For each of the five new codec ids, a `RuntimeParameterizedCodecDescriptor` exists with the correct `paramsSchema`, `targetTypes: ['eql_v2_encrypted']`, `nativeType: 'eql_v2_encrypted'`, empty `traits`, and a `factory` returning the SDK-bound codec.
- [ ] **AC-CODEC2**: `createParameterizedCodecDescriptors(sdk)` returns all six descriptors (string + five new) in a stable order.
- [ ] **AC-CODEC3**: Each codec's `encode` extracts ciphertext from the envelope handle; `decode` constructs the appropriate envelope subclass via `<Type>.fromInternal({...})`.

## AC-HOOK — Codec lifecycle hooks

- [ ] **AC-HOOK1**: `makeCipherstashCodecHooks({ flagToIndex, castAs })` exists and produces `CodecControlHooks` with the correct `onFieldEvent` + identity `expandNativeType`.
- [ ] **AC-HOOK2**: `cipherstashStringCodecHooks` refactors to use the factory. Behavior is unchanged — the existing baseline migration in `examples/cipherstash-integration` regenerates byte-identical.
- [ ] **AC-HOOK3**: Each of the five new codec hook configurations is wired into the extension descriptor's `controlPlaneHooks` map under its codec id.
- [ ] **AC-HOOK4**: `CipherstashSearchIndex` widens to `'unique' | 'match' | 'ore' | 'ste_vec'`; the `cipherstashAddSearchConfig` factory accepts the new index values.

## AC-AUTH — PSL constructors and TS factories

- [ ] **AC-AUTH1**: For each of `EncryptedString` (extended), `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`: the PSL constructor in `contract/authoring.ts` accepts the appropriate flag set with `true` defaults; lowers to the corresponding `ColumnTypeDescriptor` shape.
- [ ] **AC-AUTH2**: For each, the TS factory in `exports/column-types.ts` accepts the same options object and lowers to the same descriptor shape.
- [ ] **AC-AUTH3**: A parity fixture under `test/integration/parity/<codec-name>/` confirms PSL- and TS-authored contracts emit byte-identical `contract.json`.

## AC-OP — Operator surface

### Predicate operators (column methods)

- [ ] **AC-OP-PRED1**: `cipherstashNe`, `cipherstashInArray`, `cipherstashNotInArray`, `cipherstashNotIlike`, `cipherstashGt`, `cipherstashGte`, `cipherstashLt`, `cipherstashLte`, `cipherstashBetween`, `cipherstashNotBetween`, `cipherstashJsonbPathExists` register through `cipherstashQueryOperations()`.
- [ ] **AC-OP-PRED2**: Each predicate operator lowers to the expected EQL function call per FR7 (SQL-snapshot test).
- [ ] **AC-OP-PRED3**: `cipherstashInArray` and `cipherstashNotInArray` handle variable-arity arrays correctly; each array element is wrapped in its own envelope with the same `(table, column)` routing key and produces an OR-of-equalities SQL fragment.
- [ ] **AC-OP-PRED4**: `cipherstashBetween` and `cipherstashNotBetween` lower to two-bound expressions with the correct inclusivity.
- [ ] **AC-OP-PRED5**: For each predicate operator, type-visibility is wired through `QueryOperationTypes` in `types/operation-types.ts` such that the operator autocompletes only on its target codec(s).

### Free-standing helpers

- [ ] **AC-OP-HELPER1**: `cipherstashAsc(col)` returns `OrderByItem` with `dir: 'asc'`; the inner expression is the EQL-wrapped column.
- [ ] **AC-OP-HELPER2**: `cipherstashDesc(col)` returns `OrderByItem` with `dir: 'desc'`.
- [ ] **AC-OP-HELPER3**: `cipherstashJsonbPathQueryFirst(col, path)` returns an `Expression<ScopeField>` lowering to `eql_v2.jsonb_path_query_first({{col}}, {{path}})`.
- [ ] **AC-OP-HELPER4**: `cipherstashJsonbGet(col, path)` returns an `Expression<ScopeField>` lowering to `eql_v2."->"({{col}}, {{path}})` using the `(eql_v2_encrypted, text)` overload.
- [ ] **AC-OP-HELPER5**: Each helper throws a descriptive error when called on a non-cipherstash column.

### Type-visibility negative tests

- [ ] **AC-OP-TYPES1**: `m.email.cipherstashGt(...)` does NOT autocomplete or type-check on a non-cipherstash column. (`@ts-expect-error` pinned.)
- [ ] **AC-OP-TYPES2**: `m.profile.cipherstashJsonbPathExists(...)` does NOT autocomplete or type-check on non-`cipherstash/json@1` columns.
- [ ] **AC-OP-TYPES3**: The same flag-gating that Project 1 enforces (cipherstash operators don't appear on plain `pg/text@1` columns) holds for every new operator.

## AC-MW — Bulk-encrypt middleware

- [ ] **AC-MW1**: For a plan inserting N rows × multiple cipherstash columns of different types, the middleware groups envelopes by `(table, column)` correctly; one `bulkEncrypt` SDK call per `(table, column)` group, irrespective of codec type.
- [ ] **AC-MW2**: The middleware's filter matches all six cipherstash codec ids (verified by a unit test inserting columns of each type).

## AC-DEC — `decryptAll` extension

- [ ] **AC-DEC1**: `decryptAll(rows)` walks for any `EncryptedEnvelopeBase` instance; one bulk SDK call per `(table, column)` group across heterogeneous types.
- [ ] **AC-DEC2**: After return, every touched envelope's `decrypt()` returns its cached plaintext synchronously with the correct narrowed type.

## AC-E2E — End-to-end integration

Each item below runs against live Postgres + EQL (via the example app's integration test suite).

- [ ] **AC-E2E-NUM**: Round-trip insert + read of an `EncryptedDouble` column; `cipherstashGt`, `cipherstashGte`, `cipherstashLt`, `cipherstashLte`, `cipherstashBetween` each return the expected rows; `cipherstashAsc` / `cipherstashDesc` produce the expected order.
- [ ] **AC-E2E-BIGINT**: Same as AC-E2E-NUM, for `EncryptedBigInt` with `bigint` values that exceed `Number.MAX_SAFE_INTEGER`.
- [ ] **AC-E2E-DATE**: Round-trip insert + read of an `EncryptedDate` column; `cipherstashGt(<date>)` returns rows whose date is later; `cipherstashAsc` orders by calendar date.
- [ ] **AC-E2E-BOOL**: Round-trip insert + read of an `EncryptedBoolean` column; `cipherstashEq(true)` / `cipherstashEq(false)` / `cipherstashNe(...)` / `cipherstashInArray([true, false])` each return the expected rows.
- [ ] **AC-E2E-JSON**: Round-trip insert + read of an `EncryptedJson` column carrying a small object; `cipherstashJsonbPathExists('$.key')` filters; `cipherstashJsonbPathQueryFirst('$.key')` and `cipherstashJsonbGet('$.key')` extract values in SELECT.
- [ ] **AC-E2E-STR-RANGE**: `EncryptedString({ orderAndRange: true })` columns support `cipherstashGt('m')` and `cipherstashAsc` correctly.
- [ ] **AC-E2E-MIXED**: A query touching multiple cipherstash columns of different types in WHERE + ORDER BY + SELECT issues the minimum number of SDK round-trips (one per `(table, column)`).

## AC-EXAMPLE — Example app extension

- [ ] **AC-EXAMPLE1**: `examples/cipherstash-integration` schema includes at least one column of each new type and a sample query per type.
- [ ] **AC-EXAMPLE2**: `pnpm --filter cipherstash-integration-example typecheck` is green and exercises positive type-visibility for each operator.

## AC-DOC — Documentation

- [ ] **AC-DOC1**: Package `README.md` documents all five new types, the operator surface (predicate operators as column methods; non-predicates as imports), and the EQL search-config index types used.
- [ ] **AC-DOC2**: Project 2's design decisions migrate to a durable location at close-out: either as an amendment to the cipherstash extension's `DEVELOPING.md`, an extension to an existing ADR (e.g. ADR 211 — extension operator surface), or a new ADR if the scope warrants. The locked-in design lives in this spec for the duration of the project.
- [ ] **AC-DOC3**: A "Known limitations" section in the README enumerates the deferred surfaces: encrypted timestamp/datetime, non-bigint integer variants (`int`, `small_int`, `real`), re-encryption migration, per-column key-id override.

# Out of Scope

- **Encrypted timestamp / datetime.** Lexical comparison over text-serialized timestamps is correctness-fragile (timezone offsets, ISO-vs-RFC formatting); deserves its own design. CipherStash's own surface offers only calendar-date encryption.
- **Non-bigint integer variants.** EQL supports `cast_as` ∈ `{int, small_int, big_int, real}`. Project 2 ships `bigint` (`big_int`) and IEEE-754 (`double`) only. `encryptedInt`, `encryptedSmallInt`, `encryptedReal` can be added later via the same pattern if customer demand surfaces.
- **Re-encryption migration.** No framework primitive for re-encrypting existing row data on plaintext-to-encrypted column changes. Documented as a known limitation; user works around it with hand-authored `dataTransform` migrations until a framework primitive lands.
- **Per-column key-id override.** Inherited from Project 1's default: routing key is `(table, column)`, no per-column key-id slot on `encryptedX({...})` constructors.
- **Streaming-time decryption.** Same posture as Project 1.
- **Mode-flag downgrade policy beyond the existing destructive-op classification.** No cipherstash-specific warnings; rely on the framework's planner-side handling.
- **`@cipherstash/stack` SDK re-implementation.** All codecs wrap the existing CipherStash SDK; bulk-call shape mismatches escalate to the CipherStash team.

# Open Questions

- **Exact lowering for `cipherstashAsc` / `cipherstashDesc`.** Whether EQL needs an explicit `eql_v2.order_by_<index>(col)` wrapping in the ORDER BY expression, or whether EQL's overrides of `<` / `>` on `eql_v2_encrypted` make bare `ORDER BY col ASC` work directly. Resolved at implementation time against the bundled EQL functions; documented in `DEVELOPING.md` once confirmed.
- **`cipherstashInArray` lowering.** Whether to use dynamic OR-of-equalities (always safe) or a dedicated `eql_v2.in_array` function if EQL provides one. Default: OR-of-equalities until a dedicated function is verified to exist and be performance-superior.

# Alternatives Considered

## String-typed SDK with per-codec JS↔string adapters

Each codec serialises its native JS value to a canonical string (`String(number)`, `date.toISOString()`, `JSON.stringify(value)`) before passing to the SDK; deserialises on read. The SDK contract stays `ReadonlyArray<string>` → `Promise<ReadonlyArray<string>>`.

**Rejected** at the CipherStash team's request. The team's framework-native SDK shape accepts polymorphic JS values directly, deferring per-type encryption to the SDK. Keeping the wrapping `CipherstashSdk` interface polymorphic matches that intent and avoids duplicating per-type adapters across five codecs.

## Single `cipherstash/number@1` codec covering `number | bigint`

One codec with a `kind: 'double' | 'bigint'` runtime parameter; one envelope class with a union plaintext slot.

**Rejected.** TypeScript cannot narrow the envelope's plaintext type from a runtime parameter, so users would always see `Promise<number | bigint>` from `envelope.decrypt()`. The narrowing-by-codec-id matches the CipherStash Drizzle integration's split (`dataType: "number"` vs `dataType: "bigint"`) and gives precise per-codec types end-to-end.

## Codec id `cipherstash/number@1`

Naming the IEEE-754 codec after the JS-language category rather than the underlying machine type.

**Rejected.** Codec ids are wire-level identifiers and immutable once published. Naming the codec `cipherstash/double@1` describes what it is — the EQL `cast_as: 'double'` — and pairs cleanly with `cipherstash/bigint@1` (EQL `cast_as: 'big_int'`). The user-facing constructor name (`EncryptedDouble`) follows.

## Sort and SELECT-expression operators via the operator registry

Register `cipherstashAsc` / `cipherstashJsonbPathQueryFirst` etc. as operators that return cipherstash-typed expressions, and rely on the model accessor's non-predicate path to wire them through.

**Rejected.** The model accessor's non-predicate path (`model-accessor.ts:179-186`) returns chainable comparison methods keyed by the return codec's traits. Cipherstash codecs declare empty traits to block built-in `.eq()` / `.asc()` chaining (the wrong-SQL footgun protection), so the chainable-methods object would always be empty. Free-standing helpers consuming the column accessor and returning the right AST node directly (`OrderByItem` / `Expression`) is the natural fit; this is the same shape the CipherStash Drizzle integration uses (`encryptionOps.asc(col)` / `encryptionOps.jsonbPathQueryFirst(col, path)`).

## Encrypted timestamp/datetime via lexical-comparable text encoding

Encode `Date` values as ISO 8601 strings with normalized timezone, rely on lexical comparison under EQL `cast_as: 'text'` with `'ore'` index for range queries.

**Rejected for Project 2.** Lexical comparison over text-serialized timestamps is correctness-fragile (DST transitions, timezone offset rendering, leap seconds). Deserves dedicated design — the right shape is probably a fixed-width canonical timestamp encoding agreed with the EQL team. Out of scope for this project; tracked as future work if customer demand surfaces.

## Operator registry slots for non-predicate operators

Add framework substrate to expose the underlying AST of a non-predicate operator result so it can flow into SELECT clauses directly.

**Rejected.** Free-standing helpers already cover the use case without framework changes. Reopening this is a candidate for a future framework project if non-cipherstash extensions need the same shape and a `MaterializedExpressionOp` substrate would be principled to add. For Project 2, no framework work is needed.

# References

- [Project 1 spec](../project-1/spec.md) — establishes the patterns Project 2 instantiates per type.
- [Umbrella spec](../spec.md)
- [TML-2397 — contract spaces](https://linear.app/prisma-company/issue/TML-2397) — the codec lifecycle hook foundation.
- [CipherStash Drizzle integration docs](https://cipherstash.com/docs/stack/encryption/drizzle) — operator-surface precedent.
- [CipherStash EQL reference](https://cipherstash.com/docs/stack/platform/eql) — encrypted operator semantics and search-config index types.
- ADR 195 — Planner IR with two renderers.
- ADR 207 — Codec call context.
- ADR 208 — Higher-order codecs for parameterized types.
- ADR 211 — Extension operator surface (namespaced replacement operators).
- ADR 212 — Codec lifecycle hooks.
