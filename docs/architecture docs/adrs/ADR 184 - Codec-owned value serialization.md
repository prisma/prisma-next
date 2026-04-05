# ADR 184 — Codec-owned value serialization

## At a glance

Typed values appear throughout the contract in several places: column defaults, discriminator values, type parameters. Each value has a codec ID available from context — the column's `codecId`, the discriminator field's `codecId`, etc. The codec that owns that ID is responsible for converting the value between every representation the system uses.

Today, the system hardcodes conversion logic for `bigint` and `Date` across five pipeline stages. This ADR replaces those hardcoded branches with codec-dispatched serialization: the codec owns all representations of its values.

```ts
// Column default for a bigint column — the codec ID is on the column
{
  "codecId": "pg/int8@1",
  "default": { "kind": "literal", "value": "42" }
}
// The pg/int8@1 codec knows:
//   "42" (JSON string) ↔ 42n (runtime bigint) ↔ 42 (DDL literal) ↔ 42 (PSL literal)

// Discriminator value — the codec ID is on the discriminator field
{
  "discriminator": { "field": "type" },
  "variants": { "Bug": { "value": "bug" } }
}
// The pg/text@1 codec knows:
//   "bug" (JSON string) ↔ "bug" (runtime string) ↔ 'bug' (DDL literal) ↔ "bug" (PSL literal)
```

No tags. No `$type` wrappers. The codec ID from context tells you which codec to ask; the codec handles the rest.

## Context

The contract is a JSON artifact. JSON natively represents strings, numbers, booleans, null, objects, and arrays. Some runtime types used in the system — `bigint`, `Date`, binary data — have no JSON representation.

When these values appear in the contract (as column defaults, discriminator values, or type parameters), they must be encoded into JSON for the contract artifact and decoded back to runtime values when the contract is loaded. They must also be rendered to DDL for migration planning, and parsed/rendered in PSL for schema authoring.

ADR 167 introduced a typed default literal pipeline for column defaults, handling `bigint` and `Date` as hardcoded special cases with a tagged type system (`{ $type: 'bigint', value: '42' }`). It outlined a deferred "v2" codec-keyed SPI for extensibility.

Since then, two things have changed:

1. **Discriminator values** need the same treatment. The contract stores discriminator values as JSON strings, but the discriminator field has a `codecId` that determines the runtime type. This is the second instance of the problem, and it blocks polymorphism support in the emitter (Phase 1.75 of the ORM consolidation plan).

2. **The tagged type system is unnecessary.** Values in the contract always appear in a context that supplies the codec ID — columns have `codecId`, discriminator fields have `codecId`. The consumer doesn't need self-describing tags on the values; it can ask the codec identified by context to decode the value. This eliminates the entire tag protocol (`TaggedBigInt`, `isTaggedBigInt`, `TaggedRaw`, `bigintJsonReplacer`) and the `$type` collision guard.

## Problem

Typed literal values must survive four serialization boundaries:

| Boundary | Used by | Example: `pg/int8@1`, value `42n` |
|---|---|---|
| **Wire** (DB protocol) | Runtime | `42n` ↔ Postgres int8 wire bytes |
| **Contract JSON** | Emitter, validator, contract consumers | `42n` ↔ `"42"` (JSON string) |
| **DDL** | Migration planner | `42n` → `42` (SQL numeric literal in `DEFAULT 42`) |
| **PSL** | PSL parser/printer | `42n` ↔ `42` (PSL source literal) |

Today, wire encoding/decoding is codec-dispatched (the `encode`/`decode` methods on the `Codec` interface). The other three boundaries use hardcoded branches that check for `bigint` and `Date` across multiple pipeline stages:

- `encodeDefaultLiteralValue` (authoring) — hardcoded `bigint` → tagged object, `Date` → ISO string
- `bigintJsonReplacer` (emission) — hardcoded `bigint` → tagged JSON
- `decodeContractDefaults` (validation) — hardcoded tagged bigint → `BigInt()`, gated by `isBigIntColumn`
- `renderDefaultLiteral` (migration) — hardcoded branches for bigint, Date, JSON
- `serializeValue` (emitter `.d.ts` generation) — hardcoded `bigint` → `${value}n`
- `DefaultLiteralValue` (emitted `.d.ts`) — hardcoded `O extends Date | bigint ? O : Encoded`

Every new non-JSON-safe type would require changes across all of these. Discriminator values add a second instance of the problem that cannot reuse the column-default pipeline because it's specifically about column defaults, not about "typed values in the contract."

## Constraints

1. **The codec ID is always available from context.** Column defaults have the column's `codecId`. Discriminator values have the discriminator field's `codecId`. Type parameters have the column's `codecId`. There is no case where a typed value appears in the contract without a codec ID in scope.

2. **Contract JSON must be valid JSON.** Values that aren't natively JSON-representable (bigint, Date, binary) must be encoded to JSON-safe representations. The codec decides the encoding.

3. **Most codecs don't need custom serialization.** String, number, boolean, and null are already JSON-safe, DDL-safe, and PSL-safe. Only codecs for non-JSON-safe types need to implement custom methods. The default behavior is identity/passthrough.

4. **DDL and PSL are target-specific and authoring-specific respectively.** Wire and contract JSON are universal (every codec needs them). DDL rendering is a migration concern. PSL parsing/rendering is an authoring concern. These should not all live on a single interface.

5. **The stack provides codecs.** Contract decoding needs the full composition stack (family + target + extension packs) to resolve codec IDs to implementations. Literal values in the contract are a black box without the stack.

## Decision

### Codec-dispatched serialization replaces hardcoded branches

The codec that owns a type ID is responsible for converting values between all representations. Instead of the system hardcoding "if bigint, do X; if Date, do Y" across five stages, each stage asks the codec: "encode this value for your medium."

### Three interfaces at different layers

The four serialization boundaries split into three interfaces, because wire and contract JSON are universal while DDL and PSL are layer-specific:

**1. Core codec interface (wire + contract JSON) — universal**

Every codec already has `encode`/`decode` for wire serialization. Two new methods handle contract JSON:

```ts
interface Codec<Id, TTraits, TWire, TJs, TParams, THelper> {
  // ... existing wire methods ...
  encode?(value: TJs): TWire;
  decode?(wire: TWire): TJs;

  // Contract JSON serialization
  toContractJson?(value: TJs): JsonValue;
  fromContractJson?(json: JsonValue): TJs;
}
```

When `toContractJson`/`fromContractJson` are not provided, the value is assumed to be JSON-safe and passes through unchanged. Only codecs for non-JSON-safe types (`bigint`, `Date`, binary, etc.) need to implement these.

Example: `pg/int8@1` would provide `toContractJson: (v: bigint) => v.toString()` and `fromContractJson: (j: JsonValue) => BigInt(j as string)`.

**2. DDL literal interface — migration layer**

Codecs that can appear as DDL literals (column defaults, partial index conditions) contribute a rendering function. This is target-specific — Postgres DDL syntax differs from MongoDB command syntax.

```ts
interface DdlLiteralCodec<TJs = unknown> {
  renderDdl(value: TJs): string;
  parseDdl?(raw: string): TJs | undefined;
}
```

Contributed through the target or adapter descriptor, keyed by codec ID. The migration planner looks up the DDL codec for a column's `codecId` and calls `renderDdl` to produce the DDL literal. `parseDdl` supports schema verification — parsing a raw database default string back to a runtime value for comparison.

**3. PSL literal interface — authoring layer**

Codecs that support PSL literal syntax contribute parse/render functions. PSL's grammar constrains what literal syntax is possible — not every codec can have a PSL literal representation.

```ts
interface PslLiteralCodec<TJs = unknown> {
  renderPsl(value: TJs): string;
  parsePsl?(text: string): TJs | undefined;
}
```

Contributed through the authoring layer, keyed by codec ID. The PSL printer calls `renderPsl` to emit a literal; the PSL parser calls `parsePsl` to interpret one.

### Dispatch by codec ID from context

Every place a typed value appears in the contract, the codec ID is available from context:

| Value location | Codec ID source |
|---|---|
| Column default | `column.codecId` |
| Discriminator value | `model.fields[discriminator.field].codecId` |
| Type parameters | `column.codecId` |

The pipeline stages become codec-dispatched:

1. **Authoring**: `codec.toContractJson(runtimeValue)` → JSON-safe value for the contract
2. **Emission**: values are already JSON-safe; no special handling needed
3. **Validation/loading**: `codec.fromContractJson(jsonValue)` → runtime value, using the codec ID from context
4. **Migration rendering**: `ddlCodec.renderDdl(runtimeValue)` → DDL literal
5. **PSL**: `pslCodec.renderPsl(runtimeValue)` / `pslCodec.parsePsl(text)` → runtime value

### No tags in contract JSON

Values in the contract are plain JSON. No `$type` wrappers, no `TaggedBigInt`, no collision guards. A bigint column default is stored as:

```json
{ "kind": "literal", "value": "42" }
```

The consumer knows this is a bigint because the column's `codecId` is `pg/int8@1`, and that codec's `fromContractJson` converts `"42"` to `42n`. The value doesn't need to be self-describing.

### What gets deleted

- `TaggedBigInt`, `isTaggedBigInt`, `bigintJsonReplacer` — replaced by `codec.toContractJson`
- `TaggedRaw`, `isTaggedRaw` — no longer needed (no tags to collide with)
- `TaggedLiteralValue`, `ColumnDefaultLiteralValue` type — replaced by `JsonValue`
- `encodeDefaultLiteralValue` — replaced by `codec.toContractJson`
- `decodeContractDefaults` with `isBigIntColumn` heuristic — replaced by `codec.fromContractJson`
- `DefaultLiteralValue<CodecId, Encoded>` in emitted `.d.ts` — the codec type map already knows the output type
- Hardcoded bigint/Date branches in `renderDefaultLiteral`, `serializeValue`, `normalizeLiteralValue`

## Consequences

### Benefits

- **Extensible without core changes.** A new extension codec (e.g., pgvector with non-JSON-safe precision, a binary codec, a custom decimal type) provides its own `toContractJson`/`fromContractJson` and optionally DDL/PSL methods. No changes to shared types, validation, or rendering logic.
- **Discriminator values work naturally.** A discriminator value is just a value of the discriminator field's codec type — no special encoding logic. The emitter calls `codec.toContractJson(discriminatorValue)` and the runtime calls `codec.fromContractJson(jsonValue)`.
- **Simpler contract JSON.** No `$type` tags, no collision guards, no special JSON replacer. Values are plain JSON, interpreted through context.
- **Separation of concerns.** Wire serialization, contract JSON serialization, DDL rendering, and PSL handling are separate interfaces at appropriate layers. A codec can participate in some without implementing all.

### Costs

- **Contract decoding requires the stack.** You cannot decode typed literal values from a contract without the codec implementations from the stack. This is already true in practice — the validator needs the stack to interpret codec IDs — but it becomes explicit.
- **Migration from tagged values.** Existing contracts with `{ $type: 'bigint', value: '42' }` need a migration path. The validator can accept both the old tagged format and the new untagged format during a transition period.

### Supersedes

- **ADR 167 v2 (deferred codec-keyed SPI)** — this ADR implements and generalizes the outline from ADR 167. The v1 hardcoded pipeline from ADR 167 is replaced.

### Resolves

- **ADR 173 open question: "Discriminator values are untyped strings."** Discriminator values are encoded/decoded through the discriminator field's codec, using the same mechanism as column defaults. The open question is resolved.

## Related

- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md) — the v1 design this ADR supersedes
- [ADR 170 — Codec trait system](ADR%20170%20-%20Codec%20trait%20system.md) — the trait system on the `Codec` interface that this extends
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — discriminator values are a motivating instance of this problem
