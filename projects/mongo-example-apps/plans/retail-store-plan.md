# Retail Store Example App

## Summary

Build a contract-first e-commerce data access layer using Prisma Next's MongoDB support, inspired by the [retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2) domain model. This is **not a literal port** — it's an equivalent application designed from the contract outward, the way a PN user would build it. The domain model (products, carts, orders, users, locations) stays the same; the data access layer is idiomatic PN.

The goal is to **prove real-world usage of Prisma Next** against a realistic e-commerce domain — embedded documents, referenced relations, update operators, vector search, change streams, aggregation, and schema migrations — all with full type safety. This is not a migration/upgrade-path validation (substituting PN for raw Mongo calls or Prisma ORM at existing call sites). We're building a greenfield PN application that happens to share a domain model with an existing MongoDB app.

**Spec:** `projects/mongo-example-apps/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent / Engineer | Drives execution |
| Reviewer | Will | Architectural review, framework gap triage |
| Collaborator | WS4 (Mongo) team | Framework features this plan depends on |

---

## What we're building

A working e-commerce application, living at `examples/retail-store/`. It consists of:

1. **A PN contract** defining the domain model (TypeScript DSL → `contract.json` + `contract.d.ts`)
2. **A Next.js App Router application** with a UI and API routes — a representative e-commerce experience (browse products, manage cart, place orders, view order history)
3. **A typed data access layer** — the API routes use the PN ORM and runtime for all database operations
4. **Integration tests** proving each PN capability against `mongodb-memory-server`
5. **Seed data** for demonstrations and tests

The app should function broadly like the original — a user can browse products, add them to a cart, check out, and view orders. The API routes don't need to be identical to the original, but they should be a representative sample of real-world usage patterns. The UI can be simplified.

### What we're NOT building

- **The chatbot integration** — validates Dataworkz, not PN
- **Generic CRUD helpers** — the original's `findDocuments`/`insertDocument`/`updateDocument` are the anti-pattern PN replaces

---

## Source Repo Analysis

The retail-store-v2 is a **Next.js App Router** JavaScript app using the **native `mongodb` driver** (no Mongoose). Key characteristics:

- **10 collections**: `products`, `carts`, `orders`, `users`, `locations`, `invoices`, `sessions`, `events_ingest`, `session_signals`, `next_best_actions`
- **Embedded documents**: cart `products[]` (with nested `price`, `image`), order `products[]` and `status_history[]`, event `tags` and `metadata`, user `lastRecommendations[]`
- **Referenced relations**: `carts.user` → `users._id`, `orders.user` → `users._id` (no `$lookup` in original — uses denormalization)
- **Indexes**: `carts` has `user_1` unique index; Atlas Search text index on products; vector embeddings on products (`vai_text_embedding`)
- **Update operators**: `$push` (order status, cart items), `$pull` (cart item removal), `$set` (clear cart, embeddings, NBA redeemed), `$setOnInsert` (cart upsert)
- **Change streams**: DB-level `watch()` with `$match` filter, SSE bridge to client
- **Aggregation**: `$search` (text), `$sample`, generic aggregate endpoint, analytics pipelines with `$group`/`$unwind`/`$sort`
- **No `$lookup`**: original app uses denormalization everywhere — our app will add `$lookup` via PN `include()` where appropriate

---

## Domain Model

### Overview

The original retail-store-v2 has 10 collections. We use the same core e-commerce domain but design the contract to showcase PN's strengths. We keep 7 collections that exercise distinct MongoDB patterns:

| Collection | Purpose | Key PN patterns |
|---|---|---|
| `products` | Product catalog | Embedded value objects (price, image), vector embedding field, text search index |
| `users` | Customer accounts | Embedded value objects (address), referenced by carts and orders |
| `carts` | Shopping carts | Embedded cart items (value objects), reference to user (1:1), update operators (`$push`, `$pull`, `$set`), upsert |
| `orders` | Customer orders | Embedded line items and status history (value objects), reference to user (N:1), update operators (`$push`) |
| `locations` | Store locations | Simple read-only collection |
| `invoices` | Digital receipts | Embedded line items, linked to order |
| `events` | Behavioral event stream | High-volume inserts, aggregation pipelines, change streams |

**Dropped from original:** `sessions` (trivial insert, no PN value), `session_signals` and `next_best_actions` (CEP microservice concern — their aggregation patterns are better demonstrated through `events`).

### Document Shapes

#### Product

```
products {
  _id: ObjectId
  name: string
  brand: string
  code: string
  description: string
  masterCategory: string
  subCategory: string
  articleType: string
  price: Price              // embedded value object
  image: Image              // embedded value object
  embedding: number[]       // vector embedding for similarity search
}

Price {                      // value object (no identity)
  amount: number
  currency: string
}

Image {                      // value object
  url: string
}
```

**Mapping to original:** Same fields. Renamed `vai_text_embedding` → `embedding` (clearer). `price` and `image` are embedded subdocuments in both — we model them as value objects (once ADR 178 ships) or embedded models (owner pattern as stopgap).

**Indexes:**
- Text search index on `name`, `articleType`, `subCategory`, `brand`
- Vector search index on `embedding`

#### User

```
users {
  _id: ObjectId
  name: string
  email: string
  address: Address          // embedded value object
}

Address {                    // value object
  streetAndNumber: string
  city: string
  postalCode: string
  country: string
}
```

**Mapping to original:** The original `users` collection has minimal visible fields (the routes just `find({})` and `find({_id})`). We add an embedded `address` (inspired by the shipping address logic in `createOrder`) to exercise embedded value objects on users. The original's `lastRecommendations` array is dropped — recommendation state belongs in the vector search results, not denormalized on the user.

#### Cart

```
carts {
  _id: ObjectId
  userId: ObjectId           // reference to users (1:1)
  items: CartItem[]          // embedded array of value objects
}

CartItem {                   // value object
  productId: ObjectId
  name: string
  brand: string
  amount: number
  price: Price               // nested value object
  image: Image               // nested value object
}
```

**Mapping to original:** Same structure. The original's `user` field is renamed `userId` for clarity. Cart items are denormalized product snapshots (same pattern — this is intentional denormalization for cart display). The `code` and `description` fields from the original cart items are dropped (not needed for cart display).

**Indexes:**
- Unique index on `userId` (1:1 relationship enforcement)

**Data access patterns:**
- **Upsert cart** — `findOneAndUpdate` with `$setOnInsert` + `$push` (create if not exists, add items)
- **Add item** — `$push` to `items` array
- **Remove item** — `$pull` from `items` array by `productId`
- **Clear cart** — `$set` `items` to `[]`
- **Get cart** — `findFirst` by `userId`
- **Get cart with user** — `findFirst` with `include({ user: true })` (demonstrates `$lookup`)

#### Order

```
orders {
  _id: ObjectId
  userId: ObjectId            // reference to users (N:1)
  items: OrderLineItem[]      // embedded array of value objects (snapshot at order time)
  shippingAddress: string
  type: string                // "home" | "bopis"
  statusHistory: StatusEntry[] // embedded array of value objects
}

OrderLineItem {               // value object (identical to CartItem shape)
  productId: ObjectId
  name: string
  brand: string
  amount: number
  price: Price
  image: Image
}

StatusEntry {                 // value object
  status: string
  timestamp: Date
}
```

**Mapping to original:** Same structure. `products` → `items` and `status_history` → `statusHistory` for TS naming conventions. The `user` ObjectId field → `userId`.

**Data access patterns:**
- **Create order** — insert with initial status entry
- **List user orders** — `findMany` by `userId`, sorted by `_id` descending
- **Get order details** — `findFirst` by `_id`
- **Get order with user** — `findFirst` with `include({ user: true })` (demonstrates `$lookup`)
- **Update order status** — `$push` to `statusHistory` array
- **Delete order** — `deleteOne` by `_id`

#### Location

```
locations {
  _id: ObjectId
  name: string
  streetAndNumber: string
  city: string
  postalCode: string
  country: string
}
```

**Mapping to original:** Same purpose, field names aligned with our `Address` value object. Simple read-only collection.

#### Invoice

```
invoices {
  _id: ObjectId
  orderId: ObjectId           // reference to orders
  items: InvoiceLineItem[]    // embedded array
  subtotal: number
  tax: number
  total: number
  issuedAt: Date
}

InvoiceLineItem {             // value object
  name: string
  amount: number
  unitPrice: number
  lineTotal: number
}
```

**Mapping to original:** The original's invoice structure isn't visible from routes (only `findFirst` by `_id`). We define a reasonable invoice shape that demonstrates embedded line items and a reference to orders.

#### Event

```
events {
  _id: ObjectId
  userId: string
  sessionId: string
  type: string                // "heartbeat" | "view-product" | "add-to-cart" | "search" | "exit-risk"
  timestamp: Date
  metadata: EventMetadata     // embedded value object (polymorphic by type)
}

EventMetadata {               // value object
  productId?: string
  subCategory?: string
  brand?: string
  query?: string
  exitMethod?: string
}
```

**Mapping to original:** Consolidates the original's `events_ingest`, `session_signals`, and `next_best_actions` into a single `events` collection. The aggregation patterns (group by type, compute percentages, sort) are preserved as queries against this collection. This simplification still exercises the same MongoDB features (high-volume inserts, aggregation pipelines, change streams) without the microservice complexity.

**Data access patterns:**
- **Insert event** — high-volume `insertOne`
- **Aggregate by type** — `$match` → `$group` → `$group` → `$unwind` → `$project` → `$sort` (same pipeline shape as the original)
- **Watch events** — change stream subscription for real-time processing

---

## Feature Coverage

Each feature we exercise maps to a PN capability we're validating:

### Tier 1: Core (can start now or soon)

| Feature | MongoDB idiom | PN capability | Original app equivalent |
|---|---|---|---|
| Contract definition | — | Contract IR + emitter | (new — original has no schema) |
| Product catalog queries | `find` with projection and filter | ORM `findMany` | `getProducts`, `findDocuments` |
| User lookup | `find` by `_id` | ORM `findFirst` | `getUsers` |
| Cart → User relation | `$lookup` | ORM `include()` | (new — original denormalizes) |
| Order → User relation | `$lookup` | ORM `include()` | (new — original denormalizes) |
| Embedded documents | Subdocuments in results | Value objects / owner pattern | `price`, `image` on products |
| Location listing | `find({})` | ORM `findMany` | `getStoreLocations` |

### Tier 2: Mutations (requires ORM write surface + update operators)

| Feature | MongoDB idiom | PN capability | Original app equivalent |
|---|---|---|---|
| Create order | `insertOne` | ORM `create` | `createOrder` |
| Cart upsert | `findOneAndUpdate` + `$setOnInsert` + `$push` | ORM `upsert` | `fillCart` |
| Add to cart | `$push` | Typed `$push` operator | `updateCartProducts` (add) |
| Remove from cart | `$pull` | Typed `$pull` operator | `updateCartProducts` (remove) |
| Clear cart | `$set` to `[]` | Typed `$set` operator | `clearCart` |
| Update order status | `$push` to array | Typed `$push` operator | `updateOrderStatus` |
| Delete order | `deleteOne` | ORM `delete` | `deleteOrder` |
| Insert event | `insertOne` | ORM `create` | `events/route.js` |

### Tier 3: Advanced (requires framework features not yet built)

| Feature | MongoDB idiom | PN capability | Blocks on |
|---|---|---|---|
| Schema migrations | `createIndex`, `createCollection` | Migration runner | Mongo migration planner |
| Product text search | `$search` stage | Atlas Search extension pack | Extension pack |
| Product similarity | `$vectorSearch` | Vector search extension pack | Extension pack |
| Event aggregation | `$group`/`$unwind`/`$sort` pipeline | Aggregation pipeline builder | Pipeline builder |
| Event change stream | `db.watch()` | Runtime streaming interface | Change stream support |
| Data migration | `updateMany` with field transform | Migration graph | Data migration runner |
| Random products | `$sample` | Aggregation pipeline builder | Pipeline builder |

---

## Architecture

A Next.js App Router application with a clear separation between the UI, API routes, and data access layer:

```
examples/retail-store/
├── package.json
├── next.config.js
├── tsconfig.json
├── biome.jsonc
├── vitest.config.ts
├── scripts/
│   └── generate-contract.ts      # ContractIR → emit → contract.json + contract.d.ts
├── src/
│   ├── contract.json             # generated
│   ├── contract.d.ts             # generated
│   ├── db.ts                     # database factory (createDb: uri, dbName → orm instance)
│   ├── data/                     # data access layer (all PN ORM calls live here)
│   │   ├── products.ts
│   │   ├── users.ts
│   │   ├── carts.ts
│   │   ├── orders.ts
│   │   ├── locations.ts
│   │   ├── invoices.ts
│   │   └── events.ts
│   └── seed.ts                   # seed data for tests and demos
├── app/                          # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                  # product catalog / landing page
│   ├── cart/
│   │   └── page.tsx
│   ├── orders/
│   │   └── page.tsx
│   ├── orders/[id]/
│   │   └── page.tsx
│   └── api/                      # API routes — representative sample
│       ├── products/route.ts
│       ├── cart/route.ts
│       ├── orders/route.ts
│       └── ...
└── test/
    ├── products.test.ts
    ├── users.test.ts
    ├── carts.test.ts
    ├── orders.test.ts
    ├── relations.test.ts         # cross-collection $lookup tests
    └── setup.ts                  # shared MongoMemoryReplSet setup
```

The data access layer (`src/data/`) is the boundary where PN is used — API routes call into it, never touching the MongoDB driver directly. `scripts/generate-contract.ts` defines the `ContractIR` and emits artifacts. Tests use `mongodb-memory-server`.

---

## Milestones

### Milestone 1: Scaffold + Contract

Set up the workspace package and author the contract.

**Framework dependencies:** None — ContractIR + emitter already work.

**Tasks:**
- [ ] Create `examples/retail-store/` with `package.json`, `tsconfig.json`, `biome.jsonc`, `vitest.config.ts`
- [ ] Write `scripts/generate-contract.ts` defining the full ContractIR (all 7 collections, all embedded documents, all relations)
- [ ] Run the emitter, commit `contract.json` + `contract.d.ts`
- [ ] Write `src/db.ts` database factory
- [ ] Write `src/seed.ts` with realistic seed data for all collections

**Open question:** Value objects (ADR 178) vs. owner pattern for embedded documents. If value objects aren't shipped yet, use the owner pattern as the existing demo does. Update the contract when value objects ship.

### Milestone 2: Read operations + relations

Build the read-side data access layer — the part that works today.

**Framework dependencies:** ORM `findMany` + `include()` (implemented).

**Tasks:**
- [ ] Implement product queries: `findProducts` (with filters), `findProductById`
- [ ] Implement user queries: `findUsers`, `findUserById`
- [ ] Implement location queries: `findLocations`
- [ ] Implement invoice queries: `findInvoiceById`
- [ ] Implement cart query: `getCartByUserId`
- [ ] Implement order queries: `getUserOrders` (sorted), `getOrderById`
- [ ] Implement relation loading: cart with user (`include`), order with user (`include`)
- [ ] Write integration tests for all read operations
- [ ] Write type safety tests (compile-time: accessing non-existent fields causes errors)
- [ ] Verify embedded documents (price, image, address, cart items, status history) appear inline without `include`

### Milestone 3: Write operations

Add mutations to the data access layer.

**Framework dependencies:** ORM `create` / `update` / `delete` methods (not yet implemented — currently only runtime-level commands exist).

**Decision point:** If ORM-level writes don't ship soon, we can implement this milestone using runtime-level commands (`insertOne`, `updateOne`, `deleteOne`) and upgrade to ORM methods later. The spec says "use PN ORM" but runtime commands are still PN framework code.

**Tasks:**
- [ ] Implement `createOrder` — insert order document with initial status entry
- [ ] Implement `deleteOrder` — delete by `_id`
- [ ] Implement `insertEvent` — insert event document
- [ ] Write integration tests for create/delete operations

### Milestone 4: Update operators

Implement the cart and order mutations that use Mongo-native update operators.

**Framework dependencies:** Typed `$push`, `$pull`, `$set` through the PN mutation surface (ADR 180 — designed, not built). Upsert support.

**Tasks:**
- [ ] Implement `upsertCart` — `findOneAndUpdate` with `$setOnInsert` + `$push`
- [ ] Implement `addToCart` — `$push` to `items` array
- [ ] Implement `removeFromCart` — `$pull` from `items` by `productId`
- [ ] Implement `clearCart` — `$set` `items` to `[]`
- [ ] Implement `updateOrderStatus` — `$push` to `statusHistory`
- [ ] Write integration tests for each update operator pattern

### Milestone 5: Schema migrations

Generate and apply schema migrations from the contract.

**Framework dependencies:** Mongo migration planner (designed, not built).

**Tasks:**
- [ ] Generate schema migrations from the contract
- [ ] Verify unique index on `carts.userId`
- [ ] Verify text search index on `products`
- [ ] Verify vector search index on `products.embedding`
- [ ] Write integration test: apply migrations against `mongodb-memory-server`, assert indexes exist
- [ ] Write integration test: idempotent migration (apply twice, no errors)

### Milestone 6: Vector search

Add product recommendation queries using vector similarity.

**Framework dependencies:** Vector search extension pack (planned for April — not built).

**Test infrastructure:** Requires a real Atlas cluster (vector search is Atlas-only). An Atlas cluster is available for optional integration tests.

**Tasks:**
- [ ] Add vector search extension pack dependency
- [ ] Implement `findSimilarProducts` — vector similarity query on `embedding`
- [ ] Write integration test: seed products with embeddings, query by vector, assert results ordered by relevance

### Milestone 7: Aggregation + change streams

Add event analytics and real-time event watching.

**Framework dependencies:** Aggregation pipeline builder (not built — raw pipeline passthrough exists). Change stream support (not built).

**Tasks:**
- [ ] Implement `aggregateEventsByType` — `$match`/`$group`/`$unwind`/`$project`/`$sort` pipeline
- [ ] Implement event change stream subscription
- [ ] Write integration tests for aggregation results
- [ ] Write integration test for change stream (insert event, assert change received)

**Fallback:** If the pipeline builder doesn't ship, use the raw aggregate passthrough (it works today). The change stream has no fallback — it blocks on framework support.

### Milestone 8: Data migration + close-out

Demonstrate a data migration and verify all acceptance criteria.

**Framework dependencies:** Data migration runner (ADR 176 — designed, not built).

**Tasks:**
- [ ] Design and implement one data migration (e.g., rename a field, restructure event metadata shape)
- [ ] Write integration test: apply migration, verify documents transformed
- [ ] Run full test suite — all tests pass
- [ ] Run typecheck — no errors
- [ ] Verify all acceptance criteria from the spec
- [ ] Document any framework gaps discovered
- [ ] Write README for `examples/retail-store/`

---

## Mapping to Original App

This section documents how each original retail-store-v2 API route maps to our design:

| Original route | Original operation | Our equivalent | Notes |
|---|---|---|---|
| `getProducts` | `find` with brand/category filters, projection | `findProducts(filters)` | Same query, typed filters |
| `search` | `$search` aggregation pipeline | `searchProducts(query)` | Blocks on Atlas Search extension |
| `getProductId` | `find({_id})` | `findProductById(id)` | Direct mapping |
| `getUsers` | `find({})` | `findUsers()` | Direct mapping |
| `getCart` | `find({user: ObjectId})` | `getCartByUserId(userId)` | Direct mapping |
| `fillCart` | `$sample` + `findOneAndUpdate` with upsert, `$setOnInsert`, `$push` | `upsertCart(userId, items)` | Split: random product selection is separate from cart upsert |
| `updateCartProducts` | `$push` (add) or `$pull` (remove) via `findOneAndUpdate` | `addToCart(userId, item)` / `removeFromCart(userId, productId)` | Split into explicit add/remove |
| `clearCart` | `updateOne` with `$set: {products: []}` | `clearCart(userId)` | Direct mapping |
| `createOrder` | `insertOne` with constructed document | `createOrder(order)` | Direct mapping |
| `getOrders` | `find({user}).sort({_id: -1})` | `getUserOrders(userId)` | Direct mapping |
| `getOrderDetails` | `find({_id})` | `getOrderById(orderId)` | Direct mapping |
| `updateOrderStatus` | `updateOne` with `$push: {status_history}` | `updateOrderStatus(orderId, entry)` | Direct mapping |
| `deleteOrder` | `deleteOne({_id})` | `deleteOrder(orderId)` | Direct mapping |
| `getStoreLocations` | `find({})` | `findLocations()` | Direct mapping |
| `findDocuments` (invoices) | Generic `find` | `findInvoiceById(id)` | Typed, not generic |
| `insertDocument` (sessions) | Generic `insertOne` | Dropped | No PN value in a trivial insert |
| `events` | `insertOne` to `events_ingest` | `insertEvent(event)` | Direct mapping |
| `aggregate` | Generic aggregate endpoint | `aggregateEventsByType(userId)` | Typed, specific pipelines |
| `sse` | `db.watch()` + SSE bridge | Change stream subscription (no SSE) | PN side only; SSE is app-level |
| `updateDocument` (NBA redeem) | Generic `updateOne` with `$set` | Dropped (consolidated into events) | |
| `findDocuments` (signals, NBAs) | Generic `find` | Dropped (consolidated into events) | |
| `getAssistantResponse` | Chatbot integration | Dropped | Out of scope (validates Dataworkz) |
| `getInvoiceUrl` | URL generation | Dropped | App-level concern |

---

## Framework Gaps (Known Blockers)

These are framework features this example needs that aren't built yet. Each gap should be filed as a blocking issue for the WS4 team as we encounter it.

| Gap | Blocks milestone | ADR/Design doc | Priority |
|---|---|---|---|
| ORM `create`/`update`/`delete` | M3 | — | High |
| Typed `$push`/`$pull`/`$set` operators | M4 | ADR 180 | High |
| Upsert support | M4 | — | High |
| Value objects in contract | M1 (contract accuracy) | ADR 178 | Medium (owner pattern is stopgap) |
| Mongo migration planner | M5 | Design doc exists | Medium |
| Vector search extension pack | M6 | — | Medium |
| Aggregation pipeline builder | M7 | — | Medium (raw passthrough is fallback) |
| Change stream support | M7 | ADR 124 | Medium |
| Data migration runner | M8 | ADR 176 | Low (last milestone) |
| PSL for Mongo contracts | — | — | Deferred (not needed for this example) |

---

## Test Coverage

| Acceptance Criterion | Test Type | Milestone |
|---|---|---|
| Contract emits valid `contract.json` and `contract.d.ts` | Build | M1 |
| All read operations return typed results | Integration + compile-time | M2 |
| Embedded documents inline in results | Integration | M2 |
| `$lookup` relations load via `include()` | Integration | M2 |
| Type errors on non-existent fields | Compile-time (negative) | M2 |
| Create/delete operations work | Integration | M3 |
| `$push`/`$pull`/`$set` update operators work | Integration | M4 |
| Cart upsert works | Integration | M4 |
| Schema migrations create correct indexes | Integration | M5 |
| Vector search returns similarity-ordered results | Integration | M6 |
| Aggregation pipeline produces correct analytics | Integration | M7 |
| Change stream receives insert events | Integration | M7 |
| Data migration transforms documents correctly | Integration | M8 |
| Full suite passes against `mongodb-memory-server` | CI | M8 |
