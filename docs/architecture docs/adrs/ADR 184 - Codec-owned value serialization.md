# ADR 184 — Codec-owned value serialization

## At a glance

A column with `codecId: "pg/int8@1"` has a default value of `42n` — a JavaScript `bigint`. This value has to survive a round-trip through `contract.json`, but `bigint` has no JSON representation. The codec handles it:

```ts
const pgInt8Codec = codec({
  typeId: 'pg/int8@1',
  targetTypes: ['int8'],
  traits: ['equality', 'order', 'numeric'],

  // Wire (existing)
  encode: (value: number) => value,
  decode: (wire: number) => wire,

  // Contract JSON (new) — only needed when JS type ≠ JSON type
  encodeJson: (value: bigint) => value.toString(),
  decodeJson: (json: JsonValue) => BigInt(json as string),
});
```

The resulting contract JSON is plain — no tags, no wrappers:

```json
{
  "fields": {
    "counter": {
      "codecId": "pg/int8@1",
      "nullable": false,
      "default": { "kind": "literal", "value": "42" }
    }
  }
}
```

The consumer reads `"42"`, looks up `pg/int8@1`, calls `decodeJson("42")`, gets `42n`. Most codecs don't need these methods at all — strings, numbers, booleans, and null are already JSON-safe. Only codecs for types that JSON can't represent (`bigint`, `Date`, binary data) implement them.

The same typed value crosses other boundaries too. The migration planner renders it into DDL (`DEFAULT 42`). The PSL printer renders it into schema source (`@default(42)`). Migration operations carry it in `ops.json`. These are the same problem for different media, but they live at different layers:

```ts
// Target/adapter layer, keyed by codec ID
interface DdlLiteralCodec<TJs = unknown> {
  encodeDdl(value: TJs): string;
  decodeDdl?(raw: string): TJs | undefined;
}

// Authoring layer, keyed by codec ID
interface PslLiteralCodec<TJs = unknown> {
  encodePsl(value: TJs): string;
  decodePsl?(text: string): TJs | undefined;
}
```

All three interfaces are dispatched by the same `codecId`. A codec ships with wire + contract JSON support; DDL and PSL support are added independently by the target or authoring layer. Here's the full lifecycle of a bigint column default:

| Stage | Call | Result |
|---|---|---|
| TS authoring | `codec.encodeJson(42n)` | `"42"` in contract JSON |
| Contract loading | `codec.decodeJson("42")` | `42n` in memory |
| Migration DDL | `ddlCodec.encodeDdl(42n)` | `DEFAULT 42` |
| PSL printing | `pslCodec.encodePsl(42n)` | `@default(42)` |

Column defaults aren't the only place typed values appear:

| Value | Codec ID source |
|---|---|
| Column default | `column.codecId` |
| Discriminator value | `model.fields[discriminator.field].codecId` |
| Type parameter | `column.codecId` |
| Migration temporary default | Column's `codecId` |

In every case, the codec ID is in scope. The codec can always be found.

## The codec ID is the type ID

Today, values that JSON can't represent — `bigint` and `Date` — are wrapped in self-describing tags:

```json
{ "$type": "bigint", "value": "42" }
```

This lets a consumer decode the value without knowing what field it belongs to. The tag is the type. But the consumer *already* knows what field it belongs to — column defaults are on columns, discriminator values are on models whose discriminator field has a `codecId`. The tag duplicates information that the contract structure provides.

Tags also need a collision guard. A user JSON object that happens to have a `$type` key would be misinterpreted as a tagged value, so the encoding wraps those in `{ $type: 'raw', value: ... }`. This is a protocol layered on top of JSON to solve a problem that wouldn't exist if values didn't need to be self-describing.

The insight: we already use codec IDs as type identifiers throughout the system — for wire encoding, for trait lookup, for capability gating. A typed value in the contract is no different. The codec ID from context *is* the type ID. Tags are unnecessary.

## Six branches become one dispatch

The tag approach is implemented as hardcoded branches in six locations:

| Stage | Function | What it does |
|---|---|---|
| Emit | `encodeDefaultLiteralValue` | Wraps `bigint`/`Date` in `$type` tags |
| Emit | `bigintJsonReplacer` | `JSON.stringify` replacer for bigint |
| Load | `decodeContractDefaults` | Unwraps `$type` tags back to JS values |
| DDL | `renderDefaultLiteral` | Hardcoded `bigint` → SQL literal branch |
| Types | `DefaultLiteralValue<>` | Conditional type mapping `bigint`/`Date`/etc. |
| Migration | `serializeValue` | Hardcoded value serialization for ops |

Adding a new non-JSON-safe type — say, a `Decimal` from an extension pack — means touching all six. With codec-owned serialization, it means implementing `encodeJson`/`decodeJson` on the decimal codec. One place.

## Consequences

### Benefits

- **Extensible without core changes.** New non-JSON-safe types are handled by their codec — no changes to shared infrastructure, validation, or rendering.
- **Discriminator values work naturally.** A discriminator value is a value of the discriminator field's type. The field's codec knows how to serialize it.
- **Simpler contract JSON.** No `$type` tags, no collision guards, no special `JSON.stringify` replacer.
- **Separation of concerns.** Contract JSON conversion lives on the core codec. DDL lives in the target layer. PSL lives in the authoring layer. Each interface is where it belongs.

### Costs

- **Contract decoding requires the codec stack.** Typed literal values are opaque without the codec implementation. This is already true for wire values; it becomes true for contract values too.
- **Migration from tagged values.** Existing contracts with `{ $type: 'bigint', value: '42' }` need a transition path.

## Alternatives considered

### Keep tags, make them extensible

ADR 167 outlined a "v2" where extension packs register namespaced `$type` tags (e.g., `{ $type: 'pgvector/vector', value: [1.0, 2.0] }`). Values would be self-describing via a tag registry.

Rejected because the codec ID is always available from context. Tags duplicate information already in scope, and they layer a protocol on top of JSON that creates problems (collision guards) while solving none.

### Single interface with all boundaries

Put `encodeJson`, `decodeJson`, `encodeDdl`, `decodeDdl`, `encodePsl`, `decodePsl` all on the `Codec` interface.

Rejected because DDL and PSL are layer-specific. DDL rendering is target-specific and migration-only. PSL is authoring-specific and grammar-constrained. Bundling everything onto one interface mixes concerns and creates unnecessary dependencies.

### Separate `DefaultLiteralCodec` interface (ADR 167 v2)

ADR 167 proposed a standalone `DefaultLiteralCodec` interface, parallel to `Codec`, with its own `encode`/`decode`/`render`/`normalize`.

Rejected because this isn't a separate kind of codec — it's an extension of codec responsibilities. The codec already owns the type; value serialization is part of what owning a type means.

## Supersedes

- **ADR 167 v2** (deferred codec-keyed `DefaultLiteralCodec` SPI) — this ADR generalizes and implements the concept. The v1 hardcoded pipeline is replaced.

## Resolves

- **ADR 173 open question: "Discriminator values are untyped strings."** Discriminator values are encoded/decoded through the discriminator field's codec.

## Related

- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md) — the v1 design this supersedes
- [ADR 170 — Codec trait system](ADR%20170%20-%20Codec%20trait%20system.md) — the trait system on the `Codec` interface
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — discriminator values are a motivating instance
