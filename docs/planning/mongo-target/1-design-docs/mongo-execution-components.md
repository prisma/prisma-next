# Mongo Execution Pipeline

The runtime execution pipeline takes a query plan and runs it against MongoDB, returning typed results. This document covers the three core components of that pipeline and two cross-cutting concerns.

It does NOT cover the query surfaces that produce plans (the basic query builder or the ORM client) — those are upstream consumers of this pipeline.

## Components

The pipeline has three components. Each is family-specific — the Mongo versions are independent of their SQL equivalents (see [design question #3](design-questions.md#3-execution-plan-generalization)).

| Component | Role | SQL equivalent |
|---|---|---|
| **MongoQueryPlan** | Describes a database operation: what collection, what operation, what filter/document/pipeline | `ExecutionPlan` (SQL string + params) |
| **MongoRuntime** | Orchestrates execution: lowers via adapter, calls the driver, wraps results in `AsyncIterableResult`. Plugin hooks (`beforeExecute`/`onRow`/`afterExecute`) are planned but not yet implemented. | `RuntimeCoreImpl` |
| **MongoDriver** | Talks to MongoDB: dispatches commands to the `mongodb` Node.js driver, returns results as `AsyncIterable` | `Queryable` (sends SQL to Postgres) |

Data flows top-down:

```text
MongoQueryPlan { command, meta }
  │
  ▼
MongoRuntime
  lowers via adapter (resolves params, produces wire command)
  │
  ▼
MongoDriver
  dispatches wire command to mongodb driver
  returns AsyncIterable<Document>
  │
  ▼
MongoRuntime
  wraps in AsyncIterableResult<Row>
  (planned: codec decode, plugin hooks)
```

A **query plan** is the complete description of a database operation — everything the driver needs to execute it. In SQL, this is an SQL string + parameters, and there's a lowering step from the ORM's internal representation (`SqlQueryPlan`) to the wire format (`ExecutionPlan`). In Mongo, the adapter performs a similar lowering step (`adapter.lower()`) that resolves parameter references and converts `MongoCommand` objects into `MongoWireCommand` objects for the driver.

What's shared across families: `PlanMeta` (operation name, model, lane, target, storageHash), the plugin lifecycle pattern (`beforeExecute → onRow → afterExecute`, planned for Mongo), and `AsyncIterableResult<Row>`.

---

## MongoQueryPlan

**Status: implemented**

A query plan pairs a command (what to do) with metadata (context for plugins and telemetry):

```typescript
interface MongoQueryPlan<Row = unknown> {
  readonly command: AnyMongoCommand;
  readonly meta: PlanMeta;
}
```

Commands are a discriminated union on `kind`:

```typescript
type AnyMongoCommand = FindCommand | InsertOneCommand | UpdateOneCommand | DeleteOneCommand | AggregateCommand;
```

Each command class carries exactly the fields it needs (e.g. `FindCommand` has `collection`, `filter`, `projection`, `sort`, `limit`, `skip`; `AggregateCommand` has `collection` and `pipeline`). All command classes share `readonly kind` and `readonly collection`.

### Resolved questions

**`MongoCommand` as a discriminated union**: Yes — implemented as concrete classes with a `kind` discriminant. This gives precise typing per command type and enables exhaustive `switch` dispatch in both adapter and driver.

**`PlanMeta` compatibility**: Works as-is with `paramDescriptors` as an empty array and unused SQL-specific fields. A future cleanup may split `PlanMeta` into shared + family-specific.

**Mutation return types**: Each mutation command yields its own result shape (e.g., `InsertOneResult`, `UpdateOneResult`, `DeleteOneResult`), wrapped in `AsyncIterable`.

---

## MongoDriver

**Status: straightforward wrapping of the `mongodb` Node.js driver**

The driver wraps `MongoClient` and dispatches wire commands:

```typescript
interface MongoDriver {
  execute<Row>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}
```

Wire commands mirror the command structure but carry resolved values (no `MongoParamRef` instances). The adapter's `lower()` step converts `MongoCommand` → `MongoWireCommand`.

Dispatch is a switch on `wireCommand.kind`:
- `find` → `collection.find(filter, options)` → returns a `FindCursor` (already `AsyncIterable`)
- `insertOne` → `collection.insertOne(document)` → wrap acknowledgment in single-element iterable
- `aggregate` → `collection.aggregate(pipeline)` → returns an `AggregationCursor`
- etc.

The `mongodb` driver's cursors are already `AsyncIterable`, so the interface is natural.

### Open questions

**Connection management.** `MongoClient` has its own connection pool. Who owns the `MongoClient` lifecycle — the driver wrapper? A factory function? How does this parallel the SQL adapter's connection management?

**Session/transaction support.** The `mongodb` driver uses explicit `ClientSession` objects (`client.startSession()`, `session.withTransaction()`). The driver interface needs to accept an optional session, or transactions flow through a different mechanism. The initial implementation can omit this, but the interface shouldn't prevent it.

**`explain()` support.** The SQL budgets plugin calls `driver.explain()` for query plan estimates. MongoDB has `cursor.explain()`. Expose from the start, or add when the budgets plugin is ported?

---

## MongoRuntime

**Status: implemented (minimal PoC)**

The runtime orchestrates execution:

1. Lower the query plan via the adapter (`adapter.lower()` resolves `MongoParamRef` values and produces wire commands)
2. Call the driver with the wire command
3. Wrap the driver's `AsyncIterable<Row>` in `AsyncIterableResult<Row>`

Plugin hooks (`beforeExecute`, `onRow`, `afterExecute`), plan validation, and codec decode are planned but not yet implemented. The current PoC uses identity codecs and skips hooks.

### Open questions

**How much to duplicate from the SQL runtime?** The lifecycle orchestration in `RuntimeCoreImpl` (~100 lines) is identical regardless of family. The only family-specific parts are: what's passed to the driver (`{ sql, params }` vs. `MongoCommand`), plan validation logic, and codec encoding/decoding. Options: copy and adapt (simple, discoverable divergence); extract a generic lifecycle runner (premature abstraction risk); or copy now, extract later.

**Plugin interface.** The plugin lifecycle is well-understood and the interface is small. The initial implementation can skip hooks entirely (direct driver calls), adding `MongoPlugin` when budgets or linting for Mongo is needed.

**Verification / markers.** The SQL runtime verifies contract hashes against a `_prisma_next_marker` table. Mongo would use a marker collection — but who creates it without a migration runner? See [Mongo Overview § verification](../Mongo%20Overview.md#what-we-dont-know-yet).

---

## Cross-cutting: Codecs

Codecs sit at the boundary between the runtime and the driver, encoding values going into queries and decoding values coming back from results. They serve three functions:

1. **encode** — convert a JS value to wire format for document fields in commands
2. **decode** — convert wire format to JS value for result documents
3. **type-level mapping** — declare TypeScript types for database types in `contract.d.ts` (via `CodecTypes`)

**M2 finding: most Mongo codecs are identity functions.** The `mongodb` Node.js driver already handles BSON ↔ JS conversion for built-in types (`ObjectId`, `Date`, `Int32`/`Int64`, `Decimal128`, `Binary`). Of the five base codecs implemented (`objectId`, `string`, `int32`, `boolean`, `date`), only `objectId` does real work (normalizing `ObjectId` to hex string and back). The other four pass values through unchanged.

Despite this, the codec abstraction earns its keep as an **extension point**:
- Fields whose persisted structure differs from their runtime structure (e.g., a JS class that persists as a specific document structure)
- New BSON types introduced by MongoDB in the future
- Extension types the driver doesn't know about (e.g., a `GeoPoint` class serialized as `{ lat, lng }`, or an Atlas Vector Search embedding type)

These can be added transparently as target codecs without modifying the core — the same pattern as SQL extensions.

The codec abstraction (`MongoCodec` interface, `mongoCodec()` factory, `MongoCodecRegistry`) lives in the family core (`packages/2-mongo-family/1-core/`). Concrete codecs live in the target adapter (`packages/3-mongo-target/2-mongo-adapter/`). This separation follows the architectural rule: family defines abstractions, target provides concretions.

### Resolved questions

**ObjectId representation**: Normalized to `string` (hex). The `objectId@1` codec decodes `ObjectId` to hex string and encodes back. This keeps contract types JSON-friendly and avoids leaking the driver's `ObjectId` class into the contract type system.

**Base codecs**: `objectId`, `string`, `int32`, `boolean`, `date` — implemented in `packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts`.

### Remaining open questions

**What happens when MongoDB adds new types?** The codec + operations registry is how PN accommodates new types without core changes — same pattern as SQL extensions. `Decimal128` is a likely near-term addition.

---

## Cross-cutting: Operations

The operations registry gates which query operators are available per field type (e.g., a `boolean` field gets `equals` but not `gt`). It's also the extension point for new operators — Atlas Vector Search registering `$vectorSearch` for vector-typed fields, the same pattern as pgvector in SQL.

Mongo filter operators (`$eq`, `$gt`, `$in`, `$regex`, `$exists`, `$elemMatch`) map to similar concepts as SQL but include Mongo-specific additions (array operators, embedded document matching, `$type`).

Not needed until the query surface exposes rich `where` filters. The registry is a family-agnostic pattern with family-specific operators.
