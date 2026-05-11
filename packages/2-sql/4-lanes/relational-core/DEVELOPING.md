# Developing `@prisma-next/sql-relational-core`

Internal contributor guide. See [README.md](README.md) for the package overview.

## CodecRef invariant for AST authors

Every codec-bearing AST node carries `codec: CodecRef | undefined` — a serializable `(codecId, typeParams?)` pair populated at AST construction time. This is the single source of truth for codec identity on the AST; the runtime resolves it via `resolver.forCodecRef(node.codec)` without any contract-walk triangulation.

### Which nodes carry `codec`?

- **`ParamRef`** — encode-side. Every column-bound parameter value carries the codec of the column it targets.
- **`ProjectionItem`** — decode-side. Every column-bearing projection carries the codec so the decode path reads `item.codec` directly.

### Builder construction sites

Column-bound construction sites derive `codec` from the contract via `descriptors.codecRefForColumn(table, column)`:

```ts
const ref = descriptors.codecRefForColumn('document', 'embedding');
// → { codecId: 'pg/vector@1', typeParams: { length: 1536 } }

ParamRef.of(value, { codec: ref });
```

For non-column-bound sites (raw SQL, expression-level computations), `codec` is either:
- Explicitly supplied by the caller (e.g. `sql.value(42, { codec: { codecId: 'pg/int8@1' } })`).
- `undefined` — the param flows through the driver as-is. Build-time validation rejects refs-less `ParamRef`s that should carry a codec but don't.

### Serialization safety

`CodecRef.typeParams` is `JsonValue`-safe by construction: descriptors validate params via `paramsSchema` (Standard Schema), which structurally rejects non-JSON-safe values. This guarantees AST nodes round-trip through `JSON.stringify` → `JSON.parse` without loss — a property exploited by `dataTransformAst` migrations that embed serialized ASTs in `ops.json`. See [ADR 212 — AST-bound codec resolution](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20AST-bound%20codec%20resolution.md).

### AST parsing (`parseAnyQueryAst`)

`parseAnyQueryAst(json, registry)` reconstructs class instances from serialized JSON by walking the `kind` discriminator. When a `ParamRef` carries `codec`, the parser validates `typeParams` against the `CodecDescriptorRegistry` (if the descriptor is registered). At apply time (e.g. migration runner), a permissive registry skips validation — the AST was already validated at authoring time.

## Key architectural references

- [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — the codec descriptor model
- [ADR 212 — AST-bound codec resolution](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20AST-bound%20codec%20resolution.md) — `CodecRef` on AST nodes; content-keyed resolver
- [ADR 207 — Codec call context](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — per-call context (`signal`, `column`)
