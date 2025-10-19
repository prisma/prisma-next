# ADR 030 — Result decoding & codecs registry

## Context

Plans execute against heterogeneous targets and drivers that surface wire types not directly usable in JS/TS. Users expect stable, predictable JS values that respect the data contract's types and nullability. Lanes may request explicit casts or richer shapes (JSON aggregates, arrays), and PPg preflight must decode consistently for diagnostics. We need a single composition model for where decoding logic lives, how it is selected, and what happens on conflicts or failures.

## Decision

Introduce a Codecs Registry and a deterministic decoding pipeline that composes four sources of truth in a strict precedence order:

1. **Lane hints** on the Plan annotations
2. **Contract-declared codecs** on columns and scalar types
3. **Adapter codecs** for target-specific wire types
4. **Driver native mapping** as the final fallback

Decoding is pure, deterministic, and side-effect free. Failures produce RuntimeError envelopes with stable codes and redacted messages per ADR 027

## Terminology
- **Codec**: pure function pair `{ decode: (wire) => value, encode?: (value) => wire }` plus metadata
- **Wire type**: value as returned by the driver before transformation
- **Contract type**: logical scalar declared in the data contract (e.g., integer, decimal, datetime, json, bytes, enum)
- **Lane hint**: per-Plan annotation that requests a specific codec for a projected field

## Goals
- Deterministic decoding across environments
- Clear conflict resolution and visibility into which codec produced a value
- Extensible registry for community and first-party codecs
- Safe defaults that prioritize correctness and observability over silent coercion

## Non-goals
- SQL parsing in core for type inference from raw text
- Auto-magical timezone conversion beyond declared codec policy

## Precedence rules

For each projected field in a result row:

1. **Lane hint wins**
   - Plan annotations may specify `annotations.codecs[alias] = 'ns/codec@v'`
   - If present and available, use it, else emit PLAN.UNSUPPORTED or fall back by policy

2. **Contract-declared codec next**
   - Column or scalar type in the contract may declare `codec: 'ns/codec@v'`
   - Guarantees consistent decoding for that field across all lanes

3. **Adapter codec next**
   - Adapter maps target wire types to recommended codecs, e.g., timestamptz → time/iso8601@1
   - Driven by adapter capabilities and profile per ADR 031

4. **Driver native mapping last**
   - Whatever the driver returns is surfaced, possibly as strings or buffers
   - Only used if no prior rule applies

If decoding fails at any stage, emit RUNTIME.DECODE_FAILED with `cause.origin = 'adapter' | 'lane'` depending on where the selected codec came from

## Registry model
- Global, versioned registry keyed by name = `'namespace/codec@version'`
- Namespaces required to avoid collisions, e.g., `core/decimal@1`, `pg/numeric@1`, `vendorX/uuid@2`
- Each codec publishes:
  - `decode`, optional `encode`
  - `accepts`: predicate on wire value shape and optional driver OIDs/typeIds
  - `targetTypes`: set of contract scalar kinds it satisfies
  - `configSchema`: arktype schema for per-codec config
  - `deterministic`: true assertion and precisionNotes if applicable

## Built-in starter set
- `core/int` for int2|int4|int8 → number | bigint
- `core/float` for float4|float8 → number
- `core/decimal` for numeric → Decimal with pluggable backend (decimal.js)
- `core/iso-datetime` for timestamp|timestamptz → string ISO 8601
- `core/date` for date → string ISO date
- `core/bytes` for bytea → Uint8Array | Buffer
- `core/json` for json|jsonb → any with deep-freeze optional
- `core/enum` generated from contract enum variants
- `pg/interval` for interval → { months, days, microseconds } or string
- `pg/uuid` for uuid → string

## Configuration

### Project-level defaults

```typescript
createRuntime({
  ir: contract,
  adapter: pgAdapter(),
  codecs: {
    // preferred implementations per scalar
    decimal: 'core/decimal@1',
    datetime: 'core/iso-datetime@1',
    bytes: 'core/bytes@1',
    overrides: {
      // per-column override by table.column or projection alias
      'user.createdAt': 'core/iso-datetime@1',
      'orders.total': { name: 'core/decimal@1', config: { rounding: 'half-up', scale: 2 } }
    }
  }
})
```

- Overrides are merged after adapter defaults but before driver mapping
- Lane hints still take precedence over these runtime defaults

### Composition with contract

- Contract scalars optionally carry codec and codecConfig
- Enum scalars autogenerate core/enum with allowed variants
- Column nullability in contract enforces null passthrough before decoding
- For JSON projections originating from SQL functions (json_agg), lanes may include annotations.projectionTypes to instruct nested decoding

### Lane hints

DSL and ORM lanes can attach hints at projection time:

```typescript
select({
  total: t.order.total.hintCodec('core/decimal@1', { scale: 2 }),
  payload: t.event.data.hintCodec('core/json@1')
})
```

Raw lane can annotate the Plan JSON:

```json
{
  "annotations": {
    "codecs": {
      "payload": "core/json@1",
      "total": { "name": "core/decimal@1", "config": { "scale": 2 } }
    }
  }
}
```

## Decoding pipeline

For each row:

- Build a per-column decode plan by resolving precedence once per projection alias
- Apply null short-circuit
- Invoke selected codec's decode
- If it throws, wrap in RUNTIME.DECODE_FAILED with `{ alias, codec, wirePreview }` redacted
- Attach decodingTrace in diagnostics when debug is enabled

### Streaming and cursors

- Decode row-by-row to support large results
- Codecs must be synchronous and non-blocking
- Drivers that stream buffers must surface backpressure to runtime

## Precision and timezone policy

### Decimals

- Default to Decimal object with no implicit rounding
- Option to return string with warning level lint LINT.DECIMAL_STRING if chosen

### Timestamps

- Default to string ISO 8601 for determinism and TZ neutrality
- Optional Date decoding behind an explicit setting with caveats documented

### Bytes

- Default Uint8Array
- Optional base64 string via codec config

### Intervals and bigints

- Bigint surfaces as bigint by default in Node, or string in edge with policy toggle

## PPg and preflight considerations

- PPg uses a restricted codec set vetted for safety
- Custom codecs from tenants are not executed in PPg preflight services by default
- Diagnostics store decoded shape sizes and redacted previews, not full values

## Extension points

- Third-party packages can register codecs via `runtime.registerCodec(...)`
- Namespaces are required, versioning is semantic
- Conformance Kit (ADR 026) includes round-trip and golden decode tests

## Error mapping

- Decode failure from selected codec → RUNTIME.DECODE_FAILED
- No acceptable codec found → PLAN.UNSUPPORTED at build or RUNTIME.DECODE_FAILED at run depending on lane
- Driver parse error before codec selection → ADAPTER.SYNTAX_ERROR or ADAPTER.DECODE_FAILED if adapter surfaces this class

## Observability

- Telemetry records selected codec per alias as tags without values
- Sample rate for decodingTrace controlled by runtime debug policy
- Top decode failures grouped by sqlFingerprint and codec

## Acceptance criteria

- Deterministic decoding under identical contract, adapter profile, and registry version
- Lane hints override confirmed by golden tests
- Contract-declared codecs honored across all lanes
- Adapter profiles document default codec mappings
- PPg preflight surfaces decoded diagnostics without executing untrusted codecs

## Alternatives considered

- **Single hardcoded mapping per target**
  Not flexible enough for enums, decimals, and JSON policies
- **Always prefer driver mapping**
  Produces inconsistent behavior across drivers and loses control over precision and TZ

## Open questions

- Do we provide a safe sandbox for custom codecs in PPg with strict time and memory limits
- Should registries be project-local only, or can global registries be shared across services
- Do we support lazy decoding for very large JSON aggregates to reduce memory pressure
