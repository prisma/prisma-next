# Mongo Execution Pipeline — Component Breakdown

What we need to build, what we know, and where the gaps are.

## Overview

The SQL execution flow is: ORM client → SqlQueryPlan → lower to ExecutionPlan → RuntimeCore → Queryable (driver) → database. The Mongo equivalent skips the lowering step (queries are already structured data) but needs its own versions of every component.

```
Mongo ORM client
  → builds MongoQueryPlan { command, meta }
    → MongoRuntimeCore.execute(plan)
      → MongoDriver.execute(plan.command)
        → dispatches to mongodb driver: collection.find() / insertOne() / etc.
        → yields AsyncIterable<Document>
      → wraps in AsyncIterableResult<Row>
```

### Why the pipeline is family-specific

Each family needs its own plan type, plugin interface, and runtime because plugins do useful work by inspecting the query payload — and the payload is family-specific. The SQL budgets plugin reads `plan.sql`, calls `driver.explain({ sql, params })`, and parses the SQL string. The SQL lints plugin pattern-matches on SQL AST node types (`DeleteAst`, `UpdateAst`, `SelectAst`). A Mongo linter would check `command.operation` and `command.filter` instead. Any attempt to generalize `ExecutionPlan` across families either forces every plugin to branch on family, strips the plan to useless metadata, or adds type complexity for no benefit.

What IS shared: the plugin lifecycle pattern (`beforeExecute → onRow → afterExecute`), the metadata (`PlanMeta`), and `AsyncIterableResult<Row>`. See [design question #3](design-questions.md#3-execution-plan-generalization) for the full resolution.

---

## 1. MongoQueryPlan

**Status: speculative shape exists, needs validation against real queries**

The query plan is what the ORM client produces and the runtime consumes. It replaces `ExecutionPlan` (which has `sql: string`).

### What we know

The command carries all the information the driver needs to execute:

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

interface MongoQueryPlan<Row = unknown> {
  readonly command: MongoCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}
```

There's no serialization step — unlike SQL where the AST is lowered to a string, the Mongo command IS the structured query the driver consumes.

### Open questions

**Does `PlanMeta` work as-is?** The current `PlanMeta` has SQL-specific fields:
- `paramDescriptors` — positional parameter metadata (`$1`, `$2`). Mongo doesn't have parameterized queries; values are inline in the filter object. Can this be an empty array, or should `PlanMeta` be split into shared + family-specific?
- `refs.tables` / `refs.columns` — maps to collections/fields, but the naming assumes SQL. Semantic mismatch or just cosmetic?
- `projection` / `projectionTypes` — could work for Mongo field projection, but the semantics differ (Mongo projection is `{ field: 1 }` inclusion/exclusion, not SQL column aliases).

**What about mutations that return data?** `insertOne` returns `{ insertedId }`, `updateOne` returns `{ matchedCount, modifiedCount }`, `findOneAndUpdate` returns the document. The `Row` type parameter needs to handle both document results and mutation acknowledgments. Does the plan need to distinguish these, or does the driver normalize the return type?

**Should `MongoCommand` be a discriminated union?** The current shape uses a string `operation` field with optional properties. An alternative is a union type where each operation has exactly the fields it needs (e.g., `FindCommand` has `filter` + `options`, `InsertCommand` has `document`). The union is more precise but more verbose.

---

## 2. MongoDriver

**Status: straightforward wrapping of the `mongodb` Node.js driver**

### What we know

The driver wraps `MongoClient` from the `mongodb` package. It dispatches based on `command.operation`:

```typescript
interface MongoDriverInterface {
  execute<Row = Record<string, unknown>>(command: MongoCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}
```

The dispatch is a switch:
- `find` → `collection.find(filter, options)` → returns a cursor (already `AsyncIterable`)
- `insertOne` → `collection.insertOne(document)` → wrap result in single-element iterable
- `aggregate` → `collection.aggregate(pipeline)` → returns a cursor
- etc.

The `mongodb` driver's `FindCursor` is already an `AsyncIterable`, so streaming works naturally. `mongodb-memory-server` provides a real `mongod` for tests.

### Open questions

**Connection management.** `MongoClient` has its own connection pool. The adapter wraps it, but: who owns the `MongoClient` lifecycle? The adapter? A factory function? How does this parallel the SQL adapter's connection management?

**Session/transaction support.** The `mongodb` driver uses explicit `ClientSession` objects for transactions (`client.startSession()`, `session.withTransaction()`). The driver interface needs to accept an optional session parameter, or transactions need to flow through a different mechanism. Not needed for step 1, but the interface shouldn't prevent it.

**`explain()` support.** The SQL budgets plugin calls `driver.explain()` to get query plan estimates. MongoDB has `cursor.explain()` and `collection.find(filter).explain()`. Should the driver expose an `explain()` method from the start, or defer until the budgets plugin is ported?

---

## 3. MongoRuntimeCore

**Status: pattern is well-understood, implementation is new**

### What we know

The runtime core follows the same lifecycle as the SQL runtime:

1. Validate the plan (target, hash match)
2. Run `beforeExecute` plugin hooks
3. Call the driver
4. Yield rows, running `onRow` hooks
5. Run `afterExecute` hooks with timing/count metadata

It wraps the driver's `AsyncIterable<Document>` in `AsyncIterableResult<Row>` (which is already family-agnostic).

### Open questions

**How much code is duplicated from the SQL runtime?** Looking at `RuntimeCoreImpl`, the lifecycle orchestration (~100 lines) is identical regardless of family. The only family-specific parts are:
- What's passed to the driver (`{ sql, params }` vs. `MongoCommand`)
- Plan validation logic
- Codec encoding/decoding of params and results

Options:
1. **Copy and adapt** — duplicate the lifecycle code into `MongoRuntimeCore`, change the types. Simple, follows "spike then extract." Downside: bug fixes in one runtime don't propagate.
2. **Extract a generic lifecycle runner** — parameterize the lifecycle over plan type and driver interface. This is the "extract" step, done early. Risk: premature abstraction.
3. **Start with option 1, extract later** — consistent with the "spike then extract" approach.

**Plugin interface.** The PoC plan says to skip the plugin pipeline initially and add it trivially later. This is reasonable — the plugin lifecycle is well-understood and the interface is small. Start with direct driver calls, no hooks. Add `MongoPlugin` when we need budgets or linting for Mongo.

**Verification / markers.** The SQL runtime verifies contract hashes against a `_prisma_next_marker` table. Mongo doesn't have tables — it would use a marker collection. Not needed for the initial PoC (tests use known-good contracts), but worth noting for later.

---

## 4. Row type inference

**Status: significant gap — this is the hardest type-level problem**

### How SQL does it

In the SQL family, row types are derived from the contract's codec type map:

1. The contract's `contract.d.ts` declares a `CodecTypes` map (`'pg/int4@1' → { output: number }`, `'pg/text@1' → { output: string }`, etc.). Models list fields with `codecId` references into this map.
2. The type system resolves a field's TypeScript type by looking up its `codecId` in `CodecTypes`. A column with `codecId: 'pg/int4@1'` has output type `number`.
3. When you call `.select({ id: columns.id, email: columns.email })`, the `Row` generic is inferred from the selected columns' resolved types: `{ id: number, email: string }`.
4. The plan carries `_row?: Row` as a phantom type for `ResultType<typeof plan>` extraction.

### How Mongo differs

The default case is simpler than SQL: a `findMany` on `users` returns the full document type (including embedded documents), and there are no joins. But the return type is NOT always the document shape:

- **Projection** — `collection.find(filter, { projection: { name: 1, email: 1 } })` returns only those fields. The return type is a subset of the document type.
- **Aggregation pipelines** — `$project`, `$group`, `$addFields` can produce completely new shapes. A `$group` might return `{ _id: "$status", count: { $sum: 1 } }` — a shape that doesn't correspond to any model in the contract.
- **ORM-level select** — if the ORM client supports field selection (analogous to SQL's `.select()`), the return type narrows to the selected fields.
- **`findOneAndUpdate` / `findOneAndDelete`** — return the document (before or after modification), which is the full document type.
- **Mutation acknowledgments** — `insertOne` returns `{ insertedId }`, `updateOne` returns `{ matchedCount, modifiedCount }`. These are not document types at all.

This means the row type inference problem is as hard as SQL. The plan's projection information needs to inform the return type, and aggregation pipelines can produce arbitrary shapes that need their own type inference.

The type plumbing needs to:
- Map contract field definitions to TypeScript types (including embedded document nesting and arrays of embedded documents)
- Support projection narrowing (only return requested fields)
- Handle mutation acknowledgment types (not document-shaped)
- Eventually handle aggregation pipeline output types (arbitrary shapes)

### Open questions

**Where do the TypeScript types come from?** In SQL, they come from `contract.d.ts` (emitted by the emitter). For the PoC, we're hand-crafting `contract.d.ts`. What does the Mongo type map look like? SQL uses `CodecTypes` — a type map from codec IDs to `{ input: T, output: U }`. Does Mongo need the same pattern?

**How does the ORM client infer the return type?** When you call `db.users.findMany()`, how does the ORM know the return type is `User[]`? In SQL, the `Collection` class is generic over the model type. Presumably the Mongo ORM client follows the same pattern — but the model type includes embedded documents, which SQL models don't have.

**How does projection narrowing work at the type level?** When you call `db.users.findMany({ projection: { name: 1, email: 1 } })`, the return type should be `Pick<User, 'name' | 'email'>[]` (plus `_id`). The ORM client needs to infer this from the projection argument — similar to how the SQL DSL infers row type from `.select()`.

**What about aggregation pipeline return types?** Pipelines can produce arbitrary shapes. A type-safe pipeline builder would need to track the shape through each stage (`$match` preserves it, `$project` narrows it, `$group` replaces it). This is the hardest type-level problem and is deferred — the raw pipeline escape hatch returns `unknown` or a user-supplied type parameter.

---

## 5. Codecs

**Status: needed — the `mongodb` driver handles base BSON types, but codecs serve a broader role**

### What codecs do (all families)

Codecs serve three functions:
1. **encode** — convert a JS value to wire format for query parameters / document fields
2. **decode** — convert wire format to JS value for result rows / documents
3. **type-level mapping** — declare the TypeScript types that correspond to database types in `contract.d.ts` (via `CodecTypes`)

The codec system is also the extension point for user-defined and extension-defined types. An extension author who adds Atlas Vector Search needs a codec for vector embeddings. An application author who stores a custom `GeoPoint` class as `{ lat: number, lng: number }` in a document field needs a codec to rehydrate it on read and serialize it on write. This is the same architecture as SQL's pgvector codec — the base driver handles native types, but the codec registry is where custom serialization lives.

### BSON base layer

The `mongodb` Node.js driver handles BSON ↔ JS conversion for built-in types:
- `ObjectId` → `ObjectId` (driver's class)
- `Date` → `Date`
- `Int32` / `Int64` → `number` / `Long`
- `Decimal128` → `Decimal128` (driver's class)
- `Binary` → `Binary` (driver's class)

This means Mongo codecs don't need to reimplement base type conversion — the driver is the base layer. PN codecs layer on top for cases where the driver's default conversion isn't what the application wants (e.g., normalizing `ObjectId` to `string`), and for custom/extension types that the driver doesn't know about.

### Open questions

**What base codecs does the PoC need?** At minimum:
- `ObjectId` — does PN want to normalize this to `string` for consistency, or preserve the driver's `ObjectId` class? This is a design decision that affects every Mongo contract.
- `Decimal128` — SQL has the same problem; the codec converts to a JS-friendly representation.

**Does the codec registry shape work for Mongo?** The SQL codec registry maps `typeId` (e.g., `pg/int4@1`) to encode/decode functions. A Mongo registry would map `typeId` (e.g., `mongo/objectId@1`) to the same shape. The registry interface is probably reusable; the codecs themselves are family-specific.

**What happens when MongoDB adds new types?** MongoDB periodically adds new BSON types and operators. The codec + operations registry is how PN accommodates this without core changes — a new codec and new operations are registered, just like a SQL extension. This is the same pattern regardless of family.

---

## 6. Operations

**Status: deferred from steps 1–3, but the architecture is the same as SQL**

### What operations do (all families)

The operations registry gates which query operators are available per field type. Codecs declare semantic traits (`equality`, `order`, `numeric`, `textual`, `boolean`), and operators are gated by traits. A `bool` field gets `equals` but not `gt`; a `number` field gets both.

This is also the extension point for new operators. In SQL, pgvector registers a `cosineDistance` operator gated to `vector`-trait fields. The Mongo equivalent: an Atlas Vector Search extension registers a `$vectorSearch` operator gated to vector-typed fields. When MongoDB itself adds new types or operators (which it does periodically — e.g., `$vectorSearch` was added in MongoDB 7.0), the operations registry is how they're surfaced through the ORM without core changes.

### How Mongo differs

Mongo filter operators (`$eq`, `$gt`, `$lt`, `$in`, `$regex`, `$exists`, `$elemMatch`) map to similar concepts but have Mongo-specific additions (array operators, embedded document matching, `$type`). The gating question is the same: which operators are valid for which field types?

### Deferral rationale

The initial PoC builds hardcoded queries (step 1) then basic `findMany` through the ORM (step 3). Operator gating is only needed when the ORM exposes rich `where` filters — that's step 4+. Start with ungated filters and add the operations registry when the query surface demands it. But the architecture is already established — the operations registry is a family-agnostic pattern with family-specific operators.

---

## 7. Deferred components

These are needed eventually but explicitly out of scope for the initial vertical slice (steps 1–3):

| Component | Why deferred | When needed |
|---|---|---|
| Plugin pipeline | Well-understood pattern, trivial to add | When budgets/linting for Mongo is wanted |
| Verification / markers | Tests use known contracts | When running against uncontrolled databases |
| Transactions / sessions | Needs session plumbing through the driver | When ORM supports transactions (step 4+) |
| Aggregation pipeline dispatch | The driver's `collection.aggregate()` works | When the pipeline lane is built |
| `explain()` support | Mongo's explain API exists but no consumer yet | When budgets plugin is ported |

---

## Component dependency graph for the PoC

Step 1 (minimal executable slice) needs:

```
MongoQueryPlan (type)
  ↓
MongoDriver (wraps mongodb driver, dispatches commands)
  ↓
MongoRuntimeCore (lifecycle: validate → execute → yield rows)
  ↓
AsyncIterableResult<Row> (already exists, family-agnostic)
```

Step 2 (contract types) adds:

```
MongoContract (extends ContractBase, adds collections/embedded docs)
  ↓
contract.json + contract.d.ts (hand-crafted)
```

Step 3 (ORM client) adds:

```
MongoContract types
  ↓
Mongo ORM client (reads contract, builds MongoQueryPlan)
  ↓
MongoQueryPlan → MongoRuntimeCore → MongoDriver → MongoDB
```
