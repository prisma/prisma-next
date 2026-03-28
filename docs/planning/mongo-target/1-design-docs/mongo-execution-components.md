# Mongo Execution Pipeline — Component Breakdown

What we need to build, what we know, and where the gaps are. This is a companion to [execution-architecture.md](execution-architecture.md), which explains *why* the pipeline is family-specific. This doc focuses on the concrete components for the Mongo family.

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

In the SQL family, row types flow through the query builder:

1. The contract's `contract.d.ts` declares models with typed columns (e.g., `id: number`, `email: string`).
2. The ORM client / SQL DSL creates `ColumnBuilder` objects carrying the JS type as a generic.
3. When you call `.select({ id: columns.id, email: columns.email })`, the `Row` generic is inferred from the projection: `{ id: number, email: string }`.
4. The plan carries `_row?: Row` as a phantom type for `ResultType<typeof plan>` extraction.

### How Mongo differs

For Mongo, the row type IS the document shape:
- A `findMany` on `users` returns the full document type (all fields, including embedded documents).
- A projection (`{ name: 1, email: 1 }`) narrows the type to those fields.
- Embedded documents are part of the type — `user.profile.social.twitter` is a nested path.
- There's no "join" — the document is self-contained.

This is conceptually simpler than SQL (no join algebra), but the type plumbing still needs to:
- Map contract field definitions to TypeScript types
- Support projection narrowing (only return requested fields)
- Handle embedded document nesting
- Handle arrays of embedded documents

### Open questions

**Where do the TypeScript types come from?** In SQL, they come from `contract.d.ts` (emitted by the emitter). For the PoC, we're hand-crafting `contract.d.ts`. What does the Mongo type map look like? SQL uses `CodecTypes` — a type map from codec IDs to `{ input: T, output: U }`. Does Mongo need the same, or is it simpler because BSON types map more directly to JS types?

**How does the ORM client infer the return type?** When you call `db.users.findMany()`, how does the ORM know the return type is `User[]`? In SQL, the `Collection` class is generic over the model type. Presumably the Mongo ORM client follows the same pattern — but the model type includes embedded documents, which SQL models don't have.

---

## 5. Codecs

**Status: probably needed, but may be simpler than SQL**

### What SQL codecs do

Codecs have two runtime functions:
- **encode** — convert a JS value to wire format for query parameters (e.g., `Date` → ISO string for `timestamptz`)
- **decode** — convert wire format to JS value for result rows (e.g., ISO string → `Date`)

They also have a type-level function: mapping database types to TypeScript types in `contract.d.ts` (via `CodecTypes`).

### How Mongo differs

The `mongodb` Node.js driver already handles most BSON ↔ JS conversion:
- `ObjectId` → `ObjectId` (driver's class)
- `Date` → `Date`
- `Int32` / `Int64` → `number` / `Long`
- `Decimal128` → `Decimal128` (driver's class)
- `Binary` → `Binary` (driver's class)

The driver does the work that SQL codecs do at the `encode`/`decode` level.

### Open questions

**Can the PoC skip codecs entirely?** If the driver handles BSON conversion, and the PoC uses basic types (string, number, boolean, Date, ObjectId), codecs may not be needed initially. The contract can declare types directly as JS types.

**Where do codecs become necessary?** Likely:
- `ObjectId` — does PN want to normalize this to `string` for consistency, or preserve the driver's `ObjectId` class?
- `Decimal128` — SQL has the same problem; the codec converts to a JS-friendly representation.
- Custom types / extension packs — when pgvector has a `Vector` type with a codec, the Mongo equivalent (Atlas Vector Search) would need similar treatment. Deferred.

**Does the codec registry shape work for Mongo?** The SQL codec registry maps `typeId` (e.g., `pg/int4@1`) to encode/decode functions. A Mongo registry would map `typeId` (e.g., `mongo/objectId@1`) to the same shape. The registry interface is probably reusable; the codecs themselves are family-specific.

---

## 6. Operations

**Status: deferred — not needed for the initial PoC**

### What SQL operations do

The operations registry gates which query operators are available per field type. Codecs declare semantic traits (`equality`, `order`, `numeric`, `textual`, `boolean`), and operators are gated by traits. A `bool` field gets `equals` but not `gt`; a `number` field gets both.

### How Mongo differs

Mongo filter operators (`$eq`, `$gt`, `$lt`, `$in`, `$regex`, `$exists`, `$elemMatch`) map to similar concepts but have Mongo-specific additions (array operators, embedded document matching, `$type`). The gating question is the same: which operators are valid for which field types?

### Deferral rationale

The initial PoC builds hardcoded queries (step 1) then basic `findMany` through the ORM (step 3). Operator gating is only needed when the ORM exposes rich `where` filters — that's step 4+. Start with ungated filters and add the operations registry when the query surface demands it.

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
