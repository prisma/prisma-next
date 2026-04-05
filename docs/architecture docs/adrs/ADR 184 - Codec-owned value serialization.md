# ADR 184 — Codec-owned value serialization

## The problem

A Postgres column with type `int8` stores 64-bit integers. In JavaScript, these are `bigint` values. But JSON has no `bigint` type — so when a `bigint` value appears in the contract (as a column default, say), the system must convert it to something JSON-safe, and convert it back when the contract is loaded.

Today, adding support for one non-JSON-safe type means touching six places:

```
Authoring:    encodeDefaultLiteralValue()   — if bigint, wrap in { $type: 'bigint', value: '42' }
Emission:     bigintJsonReplacer()          — if bigint, convert to tagged object
Validation:   decodeContractDefaults()      — if tagged bigint on bigint column, BigInt(value)
.d.ts gen:    serializeValue()              — if bigint, emit ${value}n
              DefaultLiteralValue<>         — if output extends Date | bigint, use output type
Migration:    renderDefaultLiteral()        — if bigint, render as numeric literal
```

Every branch says "if bigint" or "if Date." To add a third type (binary data, a custom decimal, an extension type with non-JSON-safe precision), you'd copy the same pattern across all six places.

This problem isn't limited to column defaults. Discriminator values (the `"value": "bug"` in a polymorphic model's `variants` section) are the same problem: a typed value in the contract JSON that needs to be converted to a runtime value, rendered to DDL, and parsed from PSL. So are temporary defaults that the migration planner generates for NOT NULL columns. Any place a typed value appears in the contract hits the same boundary.

The system already has a mechanism for type-specific behavior: **codecs**. Each codec has an ID (like `pg/int8@1`) and owns encode/decode methods for the database wire protocol. But today, codecs only handle one serialization boundary (wire). The other boundaries are handled by hardcoded branches in unrelated code.

## Decision

**The codec that owns a type is responsible for converting its values across all serialization boundaries.** Instead of scattering "if bigint" checks across the codebase, each boundary asks the codec: "serialize this value for your medium."

### The key insight: codec ID is always available from context

Every place a typed value appears in the contract, a codec ID is in scope:

- A column default? The column has `codecId: 'pg/int8@1'`.
- A discriminator value? The discriminator field has a `codecId`.
- A type parameter? The column has `codecId`.
- A migration temporary default? The planner knows the column's `codecId`.

The consumer doesn't need the value to be self-describing (no `$type` tags). It looks up the codec by ID and asks it to decode the value. This eliminates the entire tagged type system.

### Four boundaries, three interfaces

A typed value passes through up to four serialization boundaries during its lifetime:

| Boundary | When | Example: `pg/int8@1`, value `42n` |
|---|---|---|
| **Contract JSON** | Emitting and loading the contract artifact | `42n` ↔ `"42"` (JSON string) |
| **Wire** (DB protocol) | Query execution | `42n` ↔ Postgres int8 wire bytes |
| **DDL** | Migration planning and schema verification | `42n` → `42` (SQL literal in `DEFAULT 42`) |
| **PSL** | Schema authoring in Prisma Schema Language | `42n` ↔ `42` (PSL source text) |

These four boundaries split into three interfaces because they have different scope:

**1. Core codec interface — extended with contract JSON methods**

Wire and contract JSON are universal: every codec must handle both. Two optional methods are added to the existing `Codec` interface:

```ts
interface Codec<Id, TTraits, TWire, TJs, TParams, THelper> {
  // existing wire methods
  encode?(value: TJs): TWire;
  decode?(wire: TWire): TJs;

  // new: contract JSON serialization
  toContractJson?(value: TJs): JsonValue;
  fromContractJson?(json: JsonValue): TJs;
}
```

When omitted, values pass through unchanged — which is correct for JSON-safe types (strings, numbers, booleans). Only codecs for non-JSON-safe types need to implement these:

```ts
const pgInt8Codec = codec({
  typeId: 'pg/int8@1',
  // ...existing wire encode/decode...
  toContractJson: (value: bigint) => value.toString(),
  fromContractJson: (json: JsonValue) => BigInt(json as string),
});
```

**2. DDL literal interface — migration layer**

DDL rendering is a migration-specific, target-specific concern. Not every codec needs it (only those whose values appear in column defaults, partial index conditions, or migration operations). Contributed through the target or adapter descriptor, keyed by codec ID:

```ts
interface DdlLiteralCodec<TJs = unknown> {
  renderDdl(value: TJs): string;
  parseDdl?(raw: string): TJs | undefined;
}
```

The migration planner calls `renderDdl` to produce DDL literals (`DEFAULT 42`). `parseDdl` supports schema verification — parsing a raw database default string back to a runtime value for comparison.

**3. PSL literal interface — authoring layer**

PSL is an authoring-specific concern. PSL's grammar constrains what literal syntax is possible — not every codec can have a PSL literal representation. Contributed through the authoring layer, keyed by codec ID:

```ts
interface PslLiteralCodec<TJs = unknown> {
  renderPsl(value: TJs): string;
  parsePsl?(text: string): TJs | undefined;
}
```

### End-to-end: a bigint column default

Here's how a bigint column default flows through the system after this change:

1. **TS authoring**: The developer writes `default: { kind: 'literal', value: 42n }`. The authoring layer looks up the `pg/int8@1` codec and calls `codec.toContractJson(42n)` → `"42"`.

2. **Contract JSON**: The emitted `contract.json` contains `{ "kind": "literal", "value": "42" }`. No tags, no `$type` — just a plain JSON string.

3. **Contract loading**: The validator looks up `pg/int8@1` from the stack and calls `codec.fromContractJson("42")` → `42n`. The runtime now has a proper `bigint`.

4. **DDL rendering**: The migration planner needs `DEFAULT 42` in a `CREATE TABLE` statement. It looks up the DDL codec for `pg/int8@1` and calls `ddlCodec.renderDdl(42n)` → `"42"`.

5. **PSL rendering**: The PSL printer needs to emit `@default(42)`. It looks up the PSL codec for `pg/int8@1` and calls `pslCodec.renderPsl(42n)` → `"42"`.

For a string value (`pg/text@1`), none of this is needed — strings are JSON-safe, DDL-safe, and PSL-safe. The codec omits `toContractJson`/`fromContractJson`, and the value passes through unchanged.

### Migration operations

Migration operations (in `ops.json`) also contain typed values — for example, a `SetColumnDefault` operation carries a literal value, and the planner generates temporary defaults for NOT NULL columns. These values need the same treatment. Whether the serialization boundary for `ops.json` is contract JSON (the operations are JSON artifacts) or DDL (the values are rendered into target-specific commands) depends on how the runner processes them. Either way, the codec provides the conversion — the dispatch mechanism is the same.

### What this eliminates

Today's hardcoded infrastructure collapses into codec methods:

- `TaggedBigInt`, `isTaggedBigInt`, `bigintJsonReplacer`, `TaggedRaw`, `isTaggedRaw` → gone (no tags)
- `encodeDefaultLiteralValue` → `codec.toContractJson()`
- `decodeContractDefaults` with `isBigIntColumn` heuristic → `codec.fromContractJson()`
- `DefaultLiteralValue<CodecId, Encoded>` in emitted `.d.ts` → the codec type map already knows the output type
- Hardcoded bigint/Date branches in `renderDefaultLiteral`, `serializeValue`, `normalizeLiteralValue` → `ddlCodec.renderDdl()`

## Consequences

### Benefits

- **Extensible without core changes.** A new codec provides `toContractJson`/`fromContractJson` and optionally DDL/PSL methods. No changes to shared types, validation, or rendering logic.
- **Discriminator values work naturally.** A discriminator value is just a value of the discriminator field's codec type. The emitter calls `codec.toContractJson()`; the runtime calls `codec.fromContractJson()`. No special "discriminator value encoding" logic.
- **Simpler contract JSON.** No `$type` tags, no collision guards, no special JSON replacer. Values are plain JSON, interpreted through the codec ID from context.
- **Separation of concerns.** Each interface lives at the layer that needs it. A codec can ship with just wire + contract JSON support, and DDL/PSL support can be added later.

### Costs

- **Contract decoding requires the stack.** Typed literal values in the contract are a black box without codec implementations from the composition stack (family + target + extension packs). This is already true — the validator needs the stack to interpret codec IDs — but it becomes explicit.
- **Migration from tagged values.** Existing contracts with `{ $type: 'bigint', value: '42' }` need a transition path. The validator can accept both formats during the transition.

## Alternatives considered

### Keep tags, make them extensible

ADR 167 outlined a "v2" design where extension packs register namespaced `$type` tags (e.g., `{ $type: 'pgvector/vector', value: [1.0, 2.0] }`). Values would be self-describing, and a tag registry would handle encode/decode.

Rejected because the codec ID is always available from context. Tags duplicate information that's already in scope, and they complicate the contract JSON with a tag protocol (collision guards, the `$type: 'raw'` escape hatch) that serves no purpose when the consumer can just ask the codec.

### Single codec interface with all four boundaries

Put `toContractJson`, `fromContractJson`, `renderDdl`, `parseDdl`, `renderPsl`, `parsePsl` all on the `Codec` interface.

Rejected because DDL and PSL are layer-specific concerns. DDL rendering is target-specific (Postgres vs MongoDB syntax) and only needed in the migration layer. PSL handling is authoring-specific and constrained by PSL's grammar. Forcing every codec to implement all six methods mixes concerns from different layers and creates dependencies between layers that should be independent. A codec can ship without DDL or PSL support; those can be added by the target or authoring layer as needed.

### Separate `DefaultLiteralCodec` interface (ADR 167 v2 outline)

ADR 167 proposed a standalone `DefaultLiteralCodec` interface, separate from the `Codec` interface, with `encode`, `decode`, `render`, and `normalize` methods.

Rejected because this is not a separate kind of codec — it's an extension of codec responsibilities. The codec already owns the type; value serialization is part of what owning a type means. Creating a parallel interface keyed by the same codec ID adds indirection without benefit.

## Supersedes

- **ADR 167 v2** (deferred codec-keyed `DefaultLiteralCodec` SPI) — this ADR implements and generalizes the concept. The v1 hardcoded pipeline is replaced.

## Resolves

- **ADR 173 open question: "Discriminator values are untyped strings."** Discriminator values are encoded/decoded through the discriminator field's codec. The open question is resolved.

## Related

- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md) — the v1 design this supersedes
- [ADR 170 — Codec trait system](ADR%20170%20-%20Codec%20trait%20system.md) — the trait system on the `Codec` interface
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — discriminator values are a motivating instance of this problem
