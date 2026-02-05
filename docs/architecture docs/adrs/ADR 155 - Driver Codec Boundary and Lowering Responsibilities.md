# ADR 155 — Driver/Codec boundary value representation and responsibilities

Prisma Next executes parameterized query Plans: adapters lower intent to SQL with placeholders, the runtime encodes values, and drivers bind values and execute against the database.

That sounds simple, but in practice we’ve been mixing responsibilities between adapters, codecs, and drivers. As a result:

- codec implementations start depending on what a particular JS driver library happens to return (`Date`, `string`, `number`, etc.)
- driver swapping becomes “best effort”
- upcoming features that need deterministic value serialization (for example, value sets) have no stable representation to build on

This ADR makes those boundaries explicit and enforceable.

## Problem statement

We currently conflate three separate concepts:

1. **Lowering:** converting an AST/intent into SQL text (dialect-specific)
2. **Value encoding/decoding:** converting JS/domain values into values that can be bound to placeholders, and converting returned row values into JS/domain values
3. **Transport:** binding parameters and executing SQL via a driver/library

When these are conflated, we get a representational failure:

- Codecs are contributed by many components (adapters, targets, extension packs), but the wire shapes they have to deal with are determined by whichever driver library is currently used.
- Drivers are intended to be swappable, but swapping driver libraries changes wire shapes and silently invalidates codecs.

We also explicitly do **not** want to solve this by inlining SQL literals (string concatenation). Parameterization is a core architecture constraint (safety, plan identity stability, and correctness).

## Design constraints (the “why” behind the decision)

- **Parameterized Plans:** we execute `sql + params`, not “SQL with values substituted”.
- **Codecs are component-provided:** adapters, targets, and extension packs can contribute codecs; codecs are not “owned by the driver”.
- **Drivers are swappable:** a Prisma Next driver is a wrapper around an underlying library (e.g. `pg`), and we want to be able to swap that wrapper/library without rewriting codec logic.
- **No SQL literal codecs:** codecs must not generate SQL fragments; SQL text is produced by lowering.

Taken together, these constraints force a single conclusion: the boundary between codecs and drivers must be standardized.

## Evidence in the current codebase (what’s leaking today)

Even before we introduce contract-level literal serialization, driver/library-specific behavior has already leaked into codecs and execution behavior:

### A codec references a specific driver library requirement (pgvector)

The `pg/vector@1` codec explicitly calls out a `pg` library requirement:

```ts
// packages/3-extensions/pgvector/src/core/codecs.ts
// PostgreSQL's pg library requires the vector format string
return `[${value.join(',')}]`;
```

This is a problem because “vector values are formatted as pgvector text strings” may be true, but “required by the pg library” is not a contract we want codecs to depend on. It makes swapping the underlying library a codec-audit exercise.

### Codecs accept driver-specific JS wire types (`Date`)

Timestamp codecs accept `string | Date`:

```ts
// packages/3-targets/6-adapters/postgres/src/core/codecs.ts
decode: (wire: string | Date): string => {
  if (typeof wire === 'string') return wire;
  if (wire instanceof Date) return wire.toISOString();
  return String(wire);
}
```

That union exists because some JS libraries return timestamps as `Date`. But a different driver library might return strings or a different wrapper type. When the wire contract shifts, codecs shift.

### Scalar codecs assume a particular parsing configuration (`int8`)

`pg/int8@1` is currently typed as `number → number` and is identity:

```ts
// packages/3-targets/6-adapters/postgres/src/core/codecs.ts
const pgInt8Codec = codec<'pg/int8@1', number, number>({ encode: (v) => v, decode: (w) => w });
```

Many Postgres JS libraries return `int8` as **strings** by default to avoid precision loss. If the underlying library returns strings, this codec is wrong. That’s the exact failure mode we want to eliminate.

### The current Postgres driver wrapper does not normalize row values

The driver yields rows directly from `pg` without normalization:

```ts
// packages/3-targets/7-drivers/postgres/src/postgres-driver.ts
const result = await client.query(sql, params as unknown[] | undefined);
for (const row of result.rows as Record<string, unknown>[]) yield row;
```

With no normalization at the driver boundary, codecs inevitably become coupled to the underlying library’s choices.

### Lowering already emits casts for determinism (`::vector`)

The Postgres adapter already emits `::vector` for `pg/vector@1` params:

```ts
// packages/3-targets/6-adapters/postgres/src/core/adapter.ts
if (columnMeta?.codecId === VECTOR_CODEC_ID) return `$${ref.index}::vector`;
```

This is a strong indicator of the problem: it shows we already need lowering to carry SQL type intent (casts), separate from value encoding.

## Decision (what we standardize)

### Responsibilities: lowering vs codecs vs drivers

We standardize responsibilities into three stages:

#### 1) Lowering (adapter responsibility)

Adapters render **SQL text** from AST/intent plus contract context:

- choose placeholder style (`$1` vs `?`)
- emit dialect-specific syntax
- emit casts when needed for unambiguous type parsing (e.g. `$1::vector`, `$1::int8`)

Adapters do **not** serialize JS values into SQL literals.

#### 2) Encoding/decoding (codec responsibility)

Codecs translate:

- JS/domain values ⇄ canonical driver boundary values

Codecs do **not** render SQL text.

#### 3) Transport and normalization (driver responsibility)

Drivers (Prisma Next wrappers around DB libraries) are responsible for:

- binding parameters and executing SQL
- streaming row results
- normalizing the underlying library’s parameter/row representations to a canonical boundary

Drivers do **not** lower AST and do **not** inject casts.

### Canonical codec↔driver boundary value representation

We standardize the boundary between codecs and drivers as:

- parameter values: `string | Uint8Array | null`
- row values: `string | Uint8Array | null`

Meaning:

- `string` is the canonical **text form** for the type (as defined by the codec policy for that `codecId`).
- `Uint8Array` is an opaque **binary blob** when a codec/target chooses a binary representation.
- `null` is SQL `NULL`.

This intentionally excludes driver-library-specific JS types (`Date`, `bigint`, `Buffer`, custom wrappers).

### Type intent lives in SQL (and plan metadata), not in parameter values

An easy mistake is to assume that a parameter value (the `string | Uint8Array | null`) must also carry “what type it is” (e.g. the column’s `nativeType`). We deliberately do **not** put type information into the value.

Instead:

- The adapter (during lowering) is responsible for making the database parse bound parameters correctly.
- For Postgres, this commonly means emitting explicit casts in SQL (e.g. `$1::vector`, `$1::uuid`, `$1::int8`) when inference would otherwise be ambiguous.

Plans already have a place to carry type information separately from values (e.g. param descriptors / codec IDs). Lowering and runtime encoding can use that metadata without turning parameters into “typed objects” or SQL literal fragments.

### How this ensures “codecs from any component” + “drivers are swappable”

This is the central compatibility mechanism:

- Codecs can come from any component, because they always speak the same boundary representation.
- Drivers can be swapped, because drivers are required to normalize into that boundary representation.

Swapping a driver should not require auditing codecs; it should require the driver to pass conformance.

### Conformance and enforcement

This is a behavioral contract, not just a TS type alias. We enforce it via:

- **Conformance tests** (ADR 026): per driver/target, prove that:
  - returned row values normalize to `string | Uint8Array | null` for representative types
  - bound params accept `string | Uint8Array | null` and execute correctly
- **Optional dev-mode validation:** fail fast if a driver returns a row value outside the canonical set (e.g. a `Date`).

## FAQ (questions a reader is likely to ask)

### “Why not just escape values and substitute them into SQL?”

Because substitution turns “data” into “code” again. Modern database protocols and libraries bind parameters as values, not SQL snippets. Binding gives us stronger safety guarantees than escaping, and it keeps Plans stable (important for identity, caching, and observability).

This ADR is specifically about keeping that parameterized architecture while still allowing codecs and drivers to be independently swappable components.

### “What is ‘canonical text form’?”

It means: for a given `codecId`, the codec defines a deterministic string representation that is accepted by the database when bound (often with an adapter-emitted cast) and that can be decoded back into a JS/domain value.

Examples in the current system:

- `pg/vector@1` uses pgvector’s text format like `"[0.1,1,42]"`.
- timestamp codecs already lean toward ISO strings for determinism (`Date` is accepted as input today but is not a desirable wire type).

Canonical text is the key ingredient we need later for deterministic contract literal serialization (e.g. value sets), because it is stable across driver libraries.

### “Does this mean all types are sent as strings?”

Not necessarily. Strings are the default because they are portable and deterministic. `Uint8Array` is reserved for cases where we intentionally use a binary representation (for example, raw bytes).

This ADR does not require us to implement type-specific binary encodings for every scalar (that would recreate driver protocol complexity in codecs). The binary path is for true blob-like values or cases where a target explicitly chooses it.

### “How does a driver wrapper actually normalize values?”

Each Prisma Next driver wrapper is allowed to configure its underlying library and/or post-process values so the wrapper outputs only `string | Uint8Array | null`.

For example, if an underlying library returns timestamps as `Date`, the wrapper would convert them to ISO strings before the codec layer sees them.

## Worked example: `pg/vector@1`

This example mirrors the current pgvector codec behavior (pgvector text format like `"[1,2,3]"`) and shows where responsibilities sit.

### Scenario

- column: `embedding` with `codecId: 'pg/vector@1'`, `nativeType: 'vector'`
- query: insert a row with `embedding`
- JS value: `[0.1, 1, 42]` (the exact domain type can vary; the boundary stays the same)

### Flow

#### A) Lane produces a parameterized intent

- params: `[[0.1, 1, 42]]`
- no SQL literal substitution

#### B) Adapter lowers intent to SQL text

- SQL: `INSERT INTO "post" ("embedding") VALUES ($1::vector)`
- `::vector` cast is emitted during lowering so the DB parses a text parameter as a `vector`

#### C) Codec encodes the JS value to a canonical boundary value

- codec encodes to a `string`:
  - `"[0.1,1,42]"`

This is a bound parameter value, not SQL text.

#### D) Driver binds and executes

- driver executes:
  - SQL: `... VALUES ($1::vector)`
  - params: `["[0.1,1,42]"]`

#### E) Driver returns canonical row values

If rows are returned, the driver normalizes them to the canonical boundary representation.

For `vector`, that means the row value is a `string` in pgvector text format:

- `"[0.1,1,42]"`

#### F) Codec decodes canonical row value to JS value

- codec decodes back to the JS/domain representation (today: `number[]`)

### Variant: arbitrary precision numeric elements (`BigDec[]`)

Now assume the JS/domain type is not `number[]` but `BigDec[]` (an arbitrary‑precision decimal type).

This does not change the codec↔driver boundary: the codec still emits a `string` for the parameter and receives a `string` for row values.

What changes is *where the precision policy lives*.

#### A) JS/domain value

- JS value: `[BigDec("0.1"), BigDec("1.0000000000000000001"), BigDec("42")]`

#### B) Lowering (unchanged)

- SQL remains: `... VALUES ($1::vector)`

Lowering is still responsible for `::vector` so the DB parses the text parameter as a vector.

#### C) Encoding policy lives in the codec

pgvector ultimately stores floating point values, so not all `BigDec` values are representable without loss.
The codec must define an explicit policy, for example:

- **Reject** values that can’t round-trip to the supported float precision (preferred for correctness), or
- **Round** with a documented strategy (acceptable if the product wants this behavior)

With a “reject on precision loss” policy, encoding would look like:

- codec encodes to a `string` (pgvector text format):
  - `"[0.1,1.0000000000000000001,42]"`
- but throws if the target representation cannot safely store `1.0000000000000000001`

The key point is that *the codec*, not the driver, owns this decision.

#### D–F) Driver and decode (unchanged)

- Driver still binds a string parameter.
- Driver still normalizes row values to strings.
- Codec still parses the text vector format back into domain values (possibly with its own explicit precision policy).

## Worked example: MySQL `DECIMAL` with `BigDec`

This example shows a different target with different adapter semantics:

- placeholder syntax: `?` instead of `$1`
- type disambiguation via `CAST(... AS ...)` rather than `::type`

### Scenario

- column: `orders.total` stored as `DECIMAL(65, 30)` (exact precision)
- JS/domain value: `BigDec("1234.567890123456789012345678901")`

### Flow

#### A) Lane produces a parameterized intent

- params: `[BigDec("1234.567890123456789012345678901")]`
- no SQL literal substitution

#### B) Adapter lowers intent to SQL text

For many inserts, MySQL can infer the type from the target column. But when we want deterministic parsing behavior (and to avoid relying on driver/library heuristics), the adapter can emit an explicit cast:

- SQL: `INSERT INTO \`orders\` (\`total\`) VALUES (CAST(? AS DECIMAL(65,30)))`

The exact cast form is dialect-specific; the point is that the adapter owns it.

#### C) Codec encodes `BigDec` to canonical boundary value

- codec encodes to a `string`:
  - `"1234.567890123456789012345678901"`

This is a bound parameter value, not SQL text.

#### D) Driver binds and executes

- driver executes:
  - SQL: `... VALUES (CAST(? AS DECIMAL(65,30)))`
  - params: `["1234.567890123456789012345678901"]`

The database parses the bound string into a DECIMAL value according to the SQL cast.

#### E) Driver returns canonical row values

Many MySQL libraries return DECIMAL columns as strings (to avoid precision loss). Under this ADR, the driver wrapper must normalize to the canonical boundary, which already allows `string`.

- row value: `"1234.567890123456789012345678901"`

#### F) Codec decodes canonical row value to `BigDec`

- codec decodes from `string` to `BigDec`

### What this illustrates

- The codec↔driver boundary remains the same across targets.
- Adapter/lowering semantics differ by dialect (casts and placeholder style), and that difference is contained entirely within the adapter.
- Precision behavior lives in codecs, not in drivers and not in SQL literal concatenation.

## Consequences

### Benefits

- Codec implementations stop depending on driver-library-specific “wire types”.
- Swapping drivers becomes realistic: conforming drivers work with the same codec registry.
- Lowering remains the single owner of SQL text details (including casts), preserving parameterization and plan identity stability.
- The canonical boundary representation becomes a stable foundation for deterministic literal serialization in future features (for example, value sets).

### Costs

- Drivers must normalize (or configure underlying libraries to avoid parsing into `Date`, etc.).
- Adapters may emit more explicit casts to keep DB type parsing deterministic when params are textual.

## Related ADRs

- ADR 016 — Adapter SPI for Lowering
- ADR 030 — Result decoding & codecs registry
- ADR 011 — Unified Plan Model

