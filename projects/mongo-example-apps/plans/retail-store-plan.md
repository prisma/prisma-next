# Retail Store Port

## Summary

Port the [retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2) e-commerce platform from raw MongoDB driver calls to Prisma Next's MongoDB support. The app exercises embedded documents, referenced relations, multiple index types, update operators, vector search, change streams, and aggregation pipelines across a realistic e-commerce domain (products, orders, customers, carts, inventory, recommendations, CEP events). Success means every data access path uses the PN ORM with full type safety, and at least one schema migration and one data migration run through the PN migration graph.

**Spec:** `projects/mongo-example-apps/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent / Engineer | Drives execution |
| Reviewer | Will | Architectural review, framework gap triage |
| Collaborator | WS4 (Mongo) team | Framework features this plan depends on |

## Source Repo Analysis

The retail-store-v2 is a **Next.js App Router** JavaScript app using the **native `mongodb` driver** (no Mongoose). Key characteristics:

- **10 collections**: `products`, `carts`, `orders`, `users`, `locations`, `invoices`, `sessions`, `events_ingest`, `session_signals`, `next_best_actions`
- **Embedded documents**: cart `products[]` (with nested `price`, `image`), order `products[]` and `status_history[]`, event `tags` and `metadata`, user `lastRecommendations[]`
- **Referenced relations**: `carts.user` → `users._id`, `orders.user` → `users._id` (no `$lookup` in original — uses denormalization)
- **Indexes**: `carts` has `user_1` unique index; Atlas Search text index on products; vector embeddings on products (`vai_text_embedding`)
- **Update operators**: `$push` (order status, cart items), `$pull` (cart item removal), `$set` (clear cart, embeddings, NBA redeemed), `$setOnInsert` (cart upsert)
- **Change streams**: DB-level `watch()` with `$match` filter, SSE bridge to client
- **Aggregation**: `$search` (text), `$sample`, generic aggregate endpoint, analytics pipelines with `$group`/`$unwind`/`$sort`
- **No `$lookup`**: original app uses denormalization everywhere — the port will add `$lookup` via PN `include()` where appropriate

## Milestones

### Milestone 1: Project scaffold and contract authoring

Set up the example app as a workspace package, analyze the source data model in detail, and author the contract in both PSL and TypeScript DSL. The contract is the foundation — everything else depends on it.

**Validates:** dual authoring surface parity, Mongo contract support for embedded documents, referenced relations, value objects, polymorphism.

**Tasks:**

- [ ] Create `examples/retail-store/` with `package.json` (workspace deps on PN packages), `tsconfig.json`, `biome.jsonc`, `vitest.config.ts` — following the `mongo-demo` example structure
- [ ] Clone/download the retail-store-v2 source and analyze the full data model: document every collection's fields, embedded documents, cross-collection references, and index requirements
- [ ] Author the PSL contract (`schema.psl`) covering all collections: `products`, `carts`, `orders`, `users`, `locations`, `invoices`, `sessions`, `events_ingest`, `session_signals`, `next_best_actions`
  - Model embedded documents: order line items (value objects with `price`, `image`), `status_history` entries, cart items, event `tags`/`metadata`, user `lastRecommendations`
  - Model referenced relations: `carts` → `users` (1:1 via `user` field), `orders` → `users` (N:1)
  - Model vector embedding field on `products` (`vai_text_embedding`)
- [ ] Author the TypeScript DSL contract producing equivalent `contract.json`
- [ ] Write a parity test: emit `contract.json` from both PSL and TS DSL, assert structural equivalence
- [ ] Generate `contract.json` and `contract.d.ts` via the emitter; commit artifacts

### Milestone 2: Schema migrations

The contract produces schema migrations that create MongoDB collections with the correct indexes and validators. The migration runner applies them against `mongodb-memory-server`.

**Validates:** Mongo schema migration generation, index creation (unique, compound, text, vector), JSON Schema validators, migration runner against real MongoDB.

**Tasks:**

- [ ] Generate schema migrations from the contract for all collections
- [ ] Verify migration creates the `user_1` unique index on `carts`
- [ ] Verify migration creates a text search index on `products` (fields: `name`, `articleType`, `subCategory`, `brand`)
- [ ] Verify migration creates a vector search index on `products` for `vai_text_embedding`
- [ ] Verify migration creates collection options where needed (e.g. `changeStreamPreAndPostImages: { enabled: true }` on `users`, `orders`)
- [ ] Write integration test: apply migrations against `mongodb-memory-server`, assert collections and indexes exist with correct configuration
- [ ] Write integration test: apply migrations idempotently (run twice, assert no errors)

### Milestone 3: Core ORM — CRUD operations

Replace the raw MongoDB driver calls for basic CRUD operations with PN ORM queries. This covers the data access layer for products, users, locations, invoices, and sessions — the simpler collections without update operator complexity.

**Validates:** `findMany`, `findFirst`, `create`, `update`, `delete` via ORM; embedded document inlining; type safety.

**Tasks:**

- [ ] Create the PN database client (`db.ts`) following the `mongo-demo` pattern: `mongodb-memory-server` for tests, real connection for optional integration
- [ ] Port `products` queries: `findMany` with projection, `findFirst` by ID, `$sample` aggregation for random products
- [ ] Port `users` queries: `findMany` (login list), `findFirst` by ID
- [ ] Port `locations` queries: `findMany` (store list), `findFirst` by ID
- [ ] Port `invoices` queries: `findFirst` by `_id`
- [ ] Port `sessions` queries: `create` (insert session doc)
- [ ] Write integration tests for each collection's CRUD operations against `mongodb-memory-server`
- [ ] Verify embedded documents (`products.price`, `products.image`) appear inline in query results without separate `include`
- [ ] Verify all query results are fully typed — add negative type tests (e.g. accessing non-existent field causes compile error)

### Milestone 4: Relations and `$lookup`

Add relation loading via the PN ORM's `include()` method for the referenced relations the original app handles via denormalization.

**Validates:** `$lookup` aggregation pipeline generation, `include()` API, relation type inference.

**Tasks:**

- [ ] Port `carts` → `users` relation: load cart with `include({ user: true })`, verify the user document is joined via `$lookup`
- [ ] Port `orders` → `users` relation: load orders with `include({ user: true })`
- [ ] Write integration tests: create user + cart + orders, query with `include`, assert joined documents are present and correctly typed
- [ ] Verify the ORM infers the correct return type when `include` is used vs. omitted

### Milestone 5: Update operators

Port the cart and order mutation logic that uses Mongo-native update operators through the PN mutation surface.

**Validates:** `$push`, `$pull`, `$set`, `$setOnInsert` through the PN mutation API; upsert support.

**Tasks:**

- [ ] Port cart `fillCart` operation: upsert with `$setOnInsert` (new cart) and `$push` (add product to `products` array)
- [ ] Port cart `updateCartProducts`: `$push` to add item, `$pull` to remove item by `products._id`
- [ ] Port cart `clearCart`: `$set` to reset `products` to empty array
- [ ] Port order `updateOrderStatus`: `$push` to append to `status_history` array
- [ ] Port product embedding update: `$set` on `vai_text_embedding` field
- [ ] Port NBA redemption: `$set` on `redeemed` field
- [ ] Write integration tests for each update operator pattern against `mongodb-memory-server`

### Milestone 6: Vector search

Port product recommendation queries to use the PN vector search extension pack.

**Validates:** PN vector search extension pack against a real use case; vector index integration; embedding field querying.

**Blocks on:** PN Mongo vector search extension pack implementation.

**Tasks:**

- [ ] Add the PN vector search extension pack dependency
- [ ] Port product similarity search: query `products` by `vai_text_embedding` vector similarity
- [ ] Port personalized recommendations: vector search producing results with `vectorSearchScore`
- [ ] Write integration test: seed products with embedding vectors, run vector similarity query, assert results ordered by relevance (requires Atlas or a test double for vector search)

### Milestone 7: Change streams

Port the SSE/change stream infrastructure to use the PN runtime's streaming interface.

**Validates:** PN change stream subscription API; `AsyncIterable<Row>` interface; filter-based watching.

**Blocks on:** PN change stream implementation.

**Tasks:**

- [ ] Port the `getChangeStream` utility: subscribe to collection changes via PN runtime, filtered by collection and document key
- [ ] Port user recommendation updates: watch `users` collection for changes to `lastRecommendations`
- [ ] Port order status updates: watch `orders` collection for status changes
- [ ] Write integration test: insert/update documents, assert change events are received through the PN streaming interface (requires replica set — `mongodb-memory-server` with `--replSet`)

### Milestone 8: Data migration and CEP events

Port the CEP event ingestion and demonstrate a data migration through the PN migration graph.

**Validates:** PN data migration system for Mongo; high-volume insert patterns; event/time-series document handling.

**Tasks:**

- [ ] Port `events_ingest` writes: create events with `tags` and `metadata` through the ORM
- [ ] Port `session_signals` and `next_best_actions` CRUD operations
- [ ] Port analytics aggregation pipelines (`$match`, `$group`, `$unwind`, `$sort`) through the PN query surface
- [ ] Design and implement one data migration: e.g. rename `session_signals` field, restructure `events_ingest.tags` shape, or consolidate `next_best_actions` schema — run through the PN migration graph
- [ ] Write integration test: apply the data migration, verify documents are transformed correctly

### Milestone 9: Close-out

Verify all acceptance criteria, document gaps found, and clean up.

**Tasks:**

- [ ] Run full test suite against `mongodb-memory-server` — all tests pass
- [ ] Run typecheck — no errors
- [ ] Verify all acceptance criteria from the spec are met (checklist below)
- [ ] Document any framework gaps discovered during the port (file as issues or note in project artifacts)
- [ ] Write a brief README for `examples/retail-store/` explaining how to run the example

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Contract authored in both PSL and TS DSL | Integration (parity) | M1 | Assert equivalent `contract.json` output |
| Both surfaces produce equivalent `contract.json` | Integration (parity) | M1 | Structural comparison test |
| Contract emits valid `contract.json` and `contract.d.ts` | Integration | M1 | Emitter success + typecheck |
| Schema migrations create correct collections, indexes, validators | Integration | M2 | Apply against mongodb-memory-server, assert indexes |
| Migration runner applies against real MongoDB | Integration | M2 | mongodb-memory-server test |
| All CRUD operations use PN ORM | Integration | M3 | Per-collection CRUD tests |
| Embedded documents inline in results | Integration | M3 | Assert nested fields present without `include` |
| Referenced relations load via `$lookup` / `include` | Integration | M4 | Create related docs, query with include |
| Query results fully typed | Compile-time | M3, M4 | Negative type tests + typecheck |
| Mongo-native update operators via PN mutation | Integration | M5 | `$push`, `$pull`, `$set` tests |
| Vector search via PN extension pack | Integration | M6 | Requires Atlas or test double |
| Data migration via PN migration graph | Integration | M8 | Apply migration, verify transformation |
| Change stream via PN runtime | Integration | M7 | Requires replica set configuration |
| Runs against mongodb-memory-server in CI | CI | M9 | Full suite green |
| Demonstrates 3+ distinct MongoDB idioms | Manual | M9 | Checklist: embedded docs, relations, update ops, vector search, change streams, aggregation |

## Open Items

- **Aggregation pipeline builder**: The analytics queries in `constants.js` use complex pipelines (`$group`, `$unwind`, `$sort`). If the PN aggregation pipeline builder isn't ready, these block on the framework. Do not use raw pipelines.
- **Upsert support**: Cart operations use `findOneAndUpdate` with `upsert: true` and `$setOnInsert`. The PN mutation surface needs to support this pattern.
- **Atlas Search vs. vector search**: The original app uses `$search` (Atlas Full-Text Search) for product text search, separate from vector search. The port needs either the PN text search extension or to model this as a different query type.
- **SSE/streaming bridge**: The original app bridges MongoDB change streams to HTTP SSE. The port replaces the MongoDB side; the SSE bridge is app-level code that stays as-is.
- **`$sample` aggregation**: Random product selection uses `$sample`. This may require the aggregation pipeline builder.
- **Generic data APIs**: The original app has generic `findDocuments`/`insertDocument`/`updateDocument` helpers. The port replaces these with typed, collection-specific ORM calls — a deliberate narrowing.
