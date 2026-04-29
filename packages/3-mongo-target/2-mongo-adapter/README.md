# @prisma-next/adapter-mongo

MongoDB adapter for Prisma Next. Lowers abstract MongoDB commands into wire-protocol documents.

## Responsibilities

- **Command lowering**: Converts `MongoCommand` instances (find, aggregate) into MongoDB wire-protocol documents
- **Codec application**: Applies codec transformations to query parameters and result documents

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-core` (command types, codec types)

## Higher-order codec authoring

The Mongo adapter ships one parameterized codec — `mongo/vector@1` — as a higher-order codec:

- **`vector(N)`** (`@prisma-next/adapter-mongo/codecs`) — column-author factory. Returns a `ColumnTypeDescriptor` whose `type` slot carries the curried `(length) => (ctx) => Codec<…, Vector<N>>` for the no-emit `FieldOutputType` resolver. `vector(1536)` resolves to `Vector<1536>` (literal `N` preserved) with no `pnpm emit` step.
- **`mongoVectorParameterizedCodec`** (`@prisma-next/adapter-mongo/codecs`) — the framework-registration `ParameterizedCodecDescriptor<{ length: number }>` that pairs the factory with `paramsSchema` (Standard Schema validating `length` at the JSON boundary) and `renderOutputType` (the emit-path renderer that stamps `Vector<N>` into `contract.d.ts`).

The Mongo control descriptor does not yet carry a `parameterizedCodecs` slot; until it does, the descriptor is exported and tested but not registered with the framework. Mongo schemas that use vectors at the IR level today author through the regular `mongoVectorCodec` codec instance; column-author code that wants the no-emit type inference can call `vector(N)` directly. See [ADR 205 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) for the design rationale.

## Exports

- `./codec-types`: Mongo codec types (`CodecTypes`, `Vector<N>`)
- `./codecs`: Higher-order vector factory (`vector`) and its descriptor (`mongoVectorParameterizedCodec`, type alias `MongoVectorCodec`)
- `./control`: Control-plane entry point (Mongo control adapter descriptor)
