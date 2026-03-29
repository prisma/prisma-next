# Mongo Execution Pipeline

The runtime execution pipeline takes a query plan and runs it against MongoDB, returning typed results. This document covers the three core components of that pipeline and two cross-cutting concerns.

It does NOT cover the query surfaces that produce plans (the basic query builder or the ORM client) — those are upstream consumers of this pipeline.

## Components

The pipeline has three components. Each is family-specific — the Mongo versions are independent of their SQL equivalents (see [design question #3](design-questions.md#3-execution-plan-generalization)).

| Component | Role | SQL equivalent |
|---|---|---|
| **MongoQueryPlan** | Describes a database operation: what collection, what operation, what filter/document/pipeline | `ExecutionPlan` (SQL string + params) |
| **MongoRuntimeCore** | Orchestrates execution: validates the plan, runs plugin hooks, calls the driver, wraps results | `RuntimeCoreImpl` |
| **MongoDriver** | Talks to MongoDB: dispatches commands to the `mongodb` Node.js driver, returns results as `AsyncIterable` | `Queryable` (sends SQL to Postgres) |

Data flows top-down:

```
MongoQueryPlan { command, meta }
  │
  ▼
MongoRuntimeCore
  validates plan, runs beforeExecute hooks
  │
  ▼
MongoDriver
  dispatches command to mongodb driver
  returns AsyncIterable<Document>
  │
  ▼
MongoRuntimeCore
  decodes via codecs, runs onRow / afterExecute hooks
  wraps in AsyncIterableResult<Row>
```

A **query plan** is the complete description of a database operation — everything the driver needs to execute it. In SQL, this is an SQL string + parameters, and there's a lowering step from the ORM's internal representation (`SqlQueryPlan`) to the wire format (`ExecutionPlan`). In Mongo, queries are already structured objects — the command IS the wire format, so there's no lowering step and a single plan type.

What's shared across families: `PlanMeta` (operation name, model, lane, target, storageHash), the plugin lifecycle pattern (`beforeExecute → onRow → afterExecute`), and `AsyncIterableResult<Row>`.

---

## MongoQueryPlan

**Status: speculative shape, needs validation against real queries**

A query plan pairs a command (what to do) with metadata (context for plugins and telemetry):

```typescript
interface MongoQueryPlan<Row = unknown> {
  readonly command: MongoCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;  // phantom type for result type extraction
}
```

The command carries everything the driver needs:

```typescript
interface MongoCommand {
  readonly collection: string;
  readonly operation: 'find' | 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'aggregate';
  readonly filter?: Document;
  readonly update?: Document;
  readonly document?: Document;
  readonly documents?: Document[];
  readonly pipeline?: Document[];
  readonly options?: {
    readonly projection?: Document;
    readonly sort?: Document;
    readonly limit?: number;
    readonly skip?: number;
  };
}
```

### Open questions

**Does `PlanMeta` work as-is?** Several `PlanMeta` fields assume SQL:
- `paramDescriptors` — positional parameter metadata (`$1`, `$2`). Mongo values are inline in the filter. Empty array, or split `PlanMeta` into shared + family-specific?
- `refs.tables` / `refs.columns` — maps to collections/fields, but the naming assumes SQL. Semantic mismatch or cosmetic?
- `projection` / `projectionTypes` — Mongo projection is `{ field: 1 }` inclusion/exclusion, not SQL column aliases. Compatible or different concept?

**Should `MongoCommand` be a discriminated union?** The shape above uses a string `operation` with optional properties. A union type (`FindCommand`, `InsertCommand`, etc.) where each variant has exactly the fields it needs is more precise but more verbose.

**What about mutations that return data?** `insertOne` returns `{ insertedId }`, `updateOne` returns `{ matchedCount, modifiedCount }`, `findOneAndUpdate` returns the document. The `Row` phantom type needs to handle both document results and mutation acknowledgments. Does the plan distinguish these, or does the driver normalize returns?

---

## MongoDriver

**Status: straightforward wrapping of the `mongodb` Node.js driver**

The driver wraps `MongoClient` and dispatches commands:

```typescript
interface MongoDriverInterface {
  execute<Row = Record<string, unknown>>(command: MongoCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}
```

Dispatch is a switch on `command.operation`:
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

## MongoRuntimeCore

**Status: pattern is well-understood, implementation is new**

The runtime core orchestrates execution with the same lifecycle as the SQL runtime:

1. Validate the plan (target match, storage hash match)
2. Run `beforeExecute` plugin hooks
3. Call the driver
4. Yield rows/documents, running `onRow` hooks and decoding via codecs
5. Run `afterExecute` hooks with timing/count metadata

It wraps the driver's `AsyncIterable<Document>` in `AsyncIterableResult<Row>` (already family-agnostic).

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

The codec abstraction (`MongoCodec` interface, `mongoCodec()` factory, `MongoCodecRegistry`) lives in the family core (`2-mongo/1-core/`). Concrete codecs live in the target adapter (`3-targets/6-adapters/mongo/`). This separation follows the architectural rule: family defines abstractions, target provides concretions.

### Resolved questions

**ObjectId representation**: Normalized to `string` (hex). The `objectId@1` codec decodes `ObjectId` to hex string and encodes back. This keeps contract types JSON-friendly and avoids leaking the driver's `ObjectId` class into the contract type system.

**Base codecs**: `objectId`, `string`, `int32`, `boolean`, `date` — implemented in `3-targets/6-adapters/mongo/src/core/codecs.ts`.

### Remaining open questions

**What happens when MongoDB adds new types?** The codec + operations registry is how PN accommodates new types without core changes — same pattern as SQL extensions. `Decimal128` is a likely near-term addition.

---

## Cross-cutting: Operations

The operations registry gates which query operators are available per field type (e.g., a `boolean` field gets `equals` but not `gt`). It's also the extension point for new operators — Atlas Vector Search registering `$vectorSearch` for vector-typed fields, the same pattern as pgvector in SQL.

Mongo filter operators (`$eq`, `$gt`, `$in`, `$regex`, `$exists`, `$elemMatch`) map to similar concepts as SQL but include Mongo-specific additions (array operators, embedded document matching, `$type`).

Not needed until the query surface exposes rich `where` filters. The registry is a family-agnostic pattern with family-specific operators.
