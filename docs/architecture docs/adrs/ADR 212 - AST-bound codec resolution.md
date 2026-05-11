# ADR 212 — AST-bound codec resolution

## At a glance

Every codec-bearing AST node now carries a serializable `CodecRef` — a `(codecId, typeParams?)` pair — populated at build time. Runtime encode and decode resolve codecs through a single content-keyed lookup: `resolver.forCodecRef(node.codec)`. Eight runtime dispatch heuristics that existed to triangulate codec identity from column references are deleted.

```ts
// Before: ParamRef carried a column reference; runtime triangulated the codec.
ParamRef.of(value, { codecId: 'pg/vector@1', refs: { table: 'document', column: 'embedding' } })
// Runtime: forColumn('document', 'embedding') → byCodecId → alias-resolver → consistency check → …

// After: ParamRef carries the codec identity directly.
ParamRef.of(value, { codec: { codecId: 'pg/vector@1', typeParams: { length: 1536 } } })
// Runtime: resolver.forCodecRef(paramRef.codec) → cache hit → done.
```

## Context

[ADR 208](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) established `CodecDescriptor.factory(params)(ctx) → Codec` as the canonical materialization shape for parameterized types. The previous AST representation recorded a column reference (`ParamRef.refs: { table; column }`) instead of the codec identity itself. At encode time, the runtime *triangulated* the codec by looking up `storage.tables[table].columns[column]` in the contract — an indirection through the contract to recover a fact the builder already knew at construction time.

That indirection was the root cause of eight runtime heuristics:

1. **`ParamRef.refs`** — the builder derived refs at build time; the runtime re-derived the codec from those refs at encode time. Two lookups for one fact.
2. **`alias-resolver.ts`** — self-join aliases (`p1`, `p2`) in `refs.table` don't match contract table names. The alias resolver mapped aliases back to source tables so `forColumn` could find the codec.
3. **The codec-id consistency check** — guarded against ORM heuristics attaching refs whose codec id disagreed with the column's. Only necessary because refs and codec identity were stored separately.
4. **`ambiguousCodecIds` set + `forCodecId` fallback** — refs-less `ParamRef`s hit a codec-id-keyed lookup. When two columns shared a parameterized codec id with different `typeParams` (e.g. `vector(1024)` and `vector(1536)`), the lookup was ambiguous and had to reject.
5. **`parameterizedRepresentatives` map + `factory(undefined)` hack** — synthesized a "representative" codec for refs-less fallback by passing `undefined` to a factory that required real params. Only worked because pgvector's wire format happened to be dimension-independent.
6. **`PgVectorDescriptor.factory` lying about its signature** — declared `factory(params: VectorParams)` but defensively read `(params as VectorParams | undefined)?.length` because the runtime called it with no params.
7. **`factory.bind(descriptor)`** — `this`-binding workaround at call sites because descriptors were pulled from the registry and called without their `this` context.
8. **`validateParamRefRefs`** — a validation pass that rejected refs-less `ParamRef`s targeting parameterized codec ids. Enforced what the type system couldn't because `refs?:` was structurally optional.

All eight shared one root cause: the AST recorded an indirection (column reference) instead of the fact (codec identity). Recording `(codecId, typeParams)` directly eliminates the triangulation and all its compensating heuristics.

## Decision

### `CodecRef` on AST nodes

`ParamRef` and `ProjectionItem` carry `codec: CodecRef | undefined`, replacing the previous `codecId?: string` and `refs?: { table; column }` fields. `CodecRef` is a family-agnostic type defined in `framework-components/codec`:

```ts
export interface CodecRef {
  readonly codecId: string;
  readonly typeParams?: JsonValue;
}
```

The optional shape (`codec?: CodecRef`) preserves the legitimate "no codec known" case: expression-level computed projections and refs-less raw SQL paths where the caller explicitly opts out. For column-bound construction, builders stamp `codec` from `descriptors.codecRefForColumn(table, column)` at AST construction time.

### Content-keyed resolver (`AstCodecResolver`)

A per-`ExecutionContext` resolver wraps `descriptorFor(codecId).factory(typeParams)(ctx)` with content-keyed memoization:

```ts
interface AstCodecResolver {
  forCodecRef(ref: CodecRef): Codec;
}
```

The cache key is `${codecId}:${canonicalizeJson(typeParams)}`, where `canonicalizeJson` is a sorted-keys recursive `JSON.stringify` (lifted from `migration` to `framework-components/utils` for runtime use). Non-parameterized codecs key as `${codecId}:undefined` and share one instance. The contract walk pre-populates the cache at context construction time, so the first `forCodecRef` call for any contract-known ref is a cache hit.

### `forColumn` survives as a build-time helper

`descriptors.codecRefForColumn(table, column)` derives the canonical `CodecRef` from contract storage (resolving `typeRef` entries to their `storage.types` `typeParams`). The existing `forColumn(table, column): Codec` wrapper is retained as a convenience API; internally it calls `forCodecRef(codecRefForColumn(table, column))`. The runtime encode/decode hot path reads `node.codec` directly and never calls `forColumn`.

### AST serialization round-trip

`CodecRef` is `JsonValue`-safe by construction: `codecId` is a string; `typeParams` is validated by `descriptor.paramsSchema` which structurally rejects non-JSON-safe values. This means AST nodes survive `JSON.stringify` → `JSON.parse` without loss. The `dataTransformAst` migration operation type exploits this property: it embeds the serialized AST in `ops.json` at authoring time and reconstructs it via `parseAnyQueryAst` at apply time. The resolver materializes codecs from the deserialized `CodecRef`s using the same content-keyed path as the in-memory execution path. See [ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) for why `ops.json` is the authoritative migration artifact.

### Honest descriptor signatures

With the triangulation removed, descriptors no longer need to accept `undefined` params as a proxy for "no params known". `PgVectorDescriptor.factory(params: VectorParams)` reads `params.length` directly; the defensive `(params as VectorParams | undefined)?.length` cast is deleted. `PgVectorCodec.length` narrows from `number | undefined` to `number`. The undimensioned `vectorColumn` helper (which relied on the representative-codec hack) is retired; users use `vector(N)` exclusively.

## Consequences

### What works better

- **Single dispatch path.** Encode and decode both resolve codecs via `resolver.forCodecRef(node.codec)`. No alias resolution, no consistency check, no ambiguity detection, no fallback chain.
- **Self-joins require no special handling.** Both sides of a self-join carry identical `CodecRef`s stamped at build time from the underlying table, not from query-local aliases. `alias-resolver.ts` is deleted.
- **AST serialization is lossless.** `CodecRef` round-trips through JSON without a "rebuild refs from contract" reconstruction step. Migration ASTs embedded in `ops.json` carry their codec identity through the serialization boundary.
- **Type-safe descriptors.** Parameterized descriptors receive validated params; non-parameterized descriptors receive `void`. No runtime type lies, no `as unknown as` casts.
- **Net code deletion.** The change removes more lines than it adds. The eight heuristics and their associated test infrastructure are replaced by a content-keyed cache and a `CodecRef` field on two AST node types.

### Trade-offs

- **Builder construction sites must stamp `codec`.** Every column-bound `ParamRef` and `ProjectionItem` construction site calls `codecRefForColumn` at build time. This is a one-time cost per node (previously the builder was already calling `forColumn` to derive `refs`), but the call is now explicit and required rather than optional.
- **Refs-less raw SQL paths require explicit codec.** `sql.value(42)` without an explicit codec argument fails at build time. Default-codec ergonomics (e.g. `defaultCodecForJsType` on the family adapter) are out of scope; tracked separately.
- **Breaking: `vectorColumn` retired.** The undimensioned vector column helper is removed. Users migrate to `vector(N)`. This is acceptable because the undimensioned form only worked due to the representative-codec hack, and any future parameterized codec whose wire format depends on its params would have silently produced malformed output.

## References

- [ADR 208 — Higher-order codecs for parameterized types](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md). The codec descriptor model this ADR composes with; defines `factory(params)(ctx)` and the descriptor registry. ADR 208's `ParamRef.refs`-based dispatch (§ "Trade-offs") is superseded by this ADR's `CodecRef`-based dispatch.
- [ADR 207 — Codec call context: per-query AbortSignal and column metadata](ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md). Per-call context baseline (`SqlCodecCallContext`). This ADR does not change the per-call context; it changes the per-node identity that selects *which* codec receives the call.
- [ADR 192 — ops.json is the migration contract](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md). Migration serialization contract. `CodecRef`'s JSON-safety enables AST embedding in `ops.json` via `dataTransformAst`.
- [Linear: TML-2456](https://linear.app/prisma-company/issue/TML-2456). Implementation ticket.
