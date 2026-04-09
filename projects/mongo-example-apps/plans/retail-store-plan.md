# Retail Store Example App

## Summary

Build a contract-first e-commerce data access layer using Prisma Next's MongoDB support, inspired by the [retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2) domain model. This is **not a literal port** — it's an equivalent application designed from the contract outward, the way a PN user would build it. The domain model (products, carts, orders, users, locations) stays the same; the data access layer is idiomatic PN.

The goal is to **prove real-world usage of Prisma Next** against a realistic e-commerce domain — embedded documents, referenced relations, update operators, vector search, change streams, aggregation, and schema migrations — all with full type safety. This is not a migration/upgrade-path validation (substituting PN for raw Mongo calls or Prisma ORM at existing call sites). We're building a greenfield PN application that happens to share a domain model with an existing MongoDB app.

**Spec:** `projects/mongo-example-apps/spec.md`

## Collaborators


| Role         | Person/Team      | Context                                    |
| ------------ | ---------------- | ------------------------------------------ |
| Maker        | Agent / Engineer | Drives execution                           |
| Reviewer     | Will             | Architectural review, framework gap triage |
| Collaborator | WS4 (Mongo) team | Framework features this plan depends on    |


---

## What we're building

A working e-commerce application, living at `examples/retail-store/`. It consists of:

1. **A PN contract** defining the domain model (PSL → `contract.json` + `contract.d.ts`) with embedded value objects via the PSL `type` keyword
2. **A Next.js App Router application** with a UI and API routes — a representative e-commerce experience (browse products, manage cart, place orders, view order history)
3. **A typed data access layer** — the API routes use the PN ORM, pipeline builder, and runtime for all database operations
4. **Schema migrations** generated from the contract via `prisma-next migration plan` and applied via `prisma-next migration apply`
5. **Integration tests** proving each PN capability against `mongodb-memory-server`
6. **Seed data** for demonstrations and tests

The app should function broadly like the original — a user can browse products, add them to a cart, check out, and view orders. The API routes don't need to be identical to the original, but they should be a representative sample of real-world usage patterns. The UI can be simplified.

### What we're NOT building

- **The chatbot integration** — validates Dataworkz, not PN
- **Generic CRUD helpers** — the original's `findDocuments`/`insertDocument`/`updateDocument` are the anti-pattern PN replaces

---

## Base branch

**`tml-2220-m1-family-migration-spi-vertical-slice-single-index-e2e`** (merging to main soon).

This branch provides a comprehensive Mongo framework stack including: PSL interpreter with `type` keyword for value objects, ORM CRUD (`create`/`update`/`delete`/`upsert`), polymorphism (`@@discriminator`/`@@base`/`.variant()`), pipeline builder (`@prisma-next/mongo-pipeline-builder`), schema migration planner + runner, and the updated `mongo-demo` example as a template.

### Previous work

An initial implementation of M1–M2 was built on `tml-2185-port-retail-store-v2-e-commerce-app-to-prisma-next-mongodb` (branched from the earlier `tml-2187-mongo-psl-interpreter-3-11`). That implementation used flattened scalar fields as a stopgap for embedded documents, lacked ORM writes, and followed an older `db.ts` pattern. This plan supersedes it — **start fresh from the new base branch**.

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


| Collection  | Purpose                 | Key PN patterns                                                                                                   |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `products`  | Product catalog         | Embedded value objects (price, image), vector embedding field, text search index                                  |
| `users`     | Customer accounts       | Embedded value objects (address), referenced by carts and orders                                                  |
| `carts`     | Shopping carts          | Embedded cart items (value objects), reference to user (1:1), update operators (`$push`, `$pull`, `$set`), upsert |
| `orders`    | Customer orders         | Embedded line items and status history (value objects), reference to user (N:1), update operators (`$push`)       |
| `locations` | Store locations         | Simple read-only collection                                                                                       |
| `invoices`  | Digital receipts        | Embedded line items, linked to order                                                                              |
| `events`    | Behavioral event stream | High-volume inserts, aggregation pipelines, change streams                                                        |


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

**Mapping to original:** Same fields. Renamed `vai_text_embedding` → `embedding` (clearer). `price` and `image` are embedded subdocuments in both — modeled as value objects via PSL `type` keyword.

**Indexes:**

- Text search index on `name`, `articleType`, `subCategory`, `brand`
- Vector search index on `embedding`

#### User

```
users {
  _id: ObjectId
  name: string
  email: string
  address: Address?         // embedded value object (optional)
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

- **Upsert cart** — `orm.carts.upsert()` with initial items
- **Add item** — `$push` to `items` array (via raw command, typed `$push` not yet on ORM)
- **Remove item** — `$pull` from `items` array by `productId` (via raw command)
- **Clear cart** — `orm.carts.where(...).update({ items: [] })`
- **Get cart** — `orm.carts.where({ userId }).all()` → first
- **Get cart with user** — `orm.carts.findMany({ where: { userId }, include: { user: true } })`

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

- **Create order** — `orm.orders.create({ ... })` with initial status entry
- **List user orders** — `orm.orders.findMany({ where: { userId } })`
- **Get order details** — `orm.orders.findMany({ where: { _id } })` → first
- **Get order with user** — `findMany` with `include: { user: true }`
- **Update order status** — `$push` to `statusHistory` array (via raw command)
- **Delete order** — `orm.orders.delete({ _id })`

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

- **Insert event** — `orm.events.create({ ... })`
- **Aggregate by type** — pipeline builder: `$match` → `$group` → `$unwind` → `$project` → `$sort`
- **Watch events** — change stream subscription for real-time processing

---

## Feature Coverage

Each feature we exercise maps to a PN capability we're validating:

### Tier 1: Core (ready now)


| Feature                 | MongoDB idiom                     | PN capability            | Original app equivalent        | Status       |
| ----------------------- | --------------------------------- | ------------------------ | ------------------------------ | ------------ |
| Contract definition     | —                                 | PSL + contract emitter   | (new — original has no schema) | Ready        |
| Embedded value objects  | Subdocuments in results           | PSL `type` keyword       | `price`, `image` on products   | Ready        |
| Product catalog queries | `find` with projection and filter | ORM `findMany`           | `getProducts`, `findDocuments` | Ready        |
| User lookup             | `find` by `_id`                   | ORM `findMany` + `where` | `getUsers`                     | Ready        |
| Cart → User relation    | `$lookup`                         | ORM `include()`          | (new — original denormalizes)  | Ready        |
| Order → User relation   | `$lookup`                         | ORM `include()`          | (new — original denormalizes)  | Ready        |
| Location listing        | `find({})`                        | ORM `findMany`           | `getStoreLocations`            | Ready        |
| Create order            | `insertOne`                       | ORM `create`             | `createOrder`                  | Ready        |
| Delete order            | `deleteOne`                       | ORM `delete`             | `deleteOrder`                  | Ready        |
| Insert event            | `insertOne`                       | ORM `create`             | `events/route.js`              | Ready        |
| Cart upsert             | `findOneAndUpdate` + upsert       | ORM `upsert`             | `fillCart`                     | Ready        |
| Clear cart              | `updateOne` with `$set`           | ORM `update`             | `clearCart`                    | Ready        |
| Schema migrations       | `createIndex`                     | Migration planner/runner | —                              | Ready        |
| Event aggregation       | `$group`/`$unwind`/`$sort`        | Pipeline builder         | `aggregate`                    | Ready        |


### Tier 2: Needs raw commands (ORM doesn't have typed array operators yet)


| Feature             | MongoDB idiom                                 | PN surface                      | Original app equivalent       |
| ------------------- | --------------------------------------------- | ------------------------------- | ----------------------------- |
| Add to cart         | `$push` to embedded array                     | Raw `updateOne` with `$push`    | `updateCartProducts` (add)    |
| Remove from cart    | `$pull` from embedded array                   | Raw `updateOne` with `$pull`    | `updateCartProducts` (remove) |
| Update order status | `$push` to `statusHistory`                    | Raw `updateOne` with `$push`    | `updateOrderStatus`           |


### Tier 3: Still blocked


| Feature             | MongoDB idiom                       | PN capability                         | Blocks on                                      |
| ------------------- | ----------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Product text search | `$search` stage                     | Atlas Search extension pack           | Extension pack not built                       |
| Product similarity  | `$vectorSearch`                     | Pipeline builder has `$vectorSearch`  | Atlas-only (needs Atlas cluster for testing)    |
| Event change stream | `db.watch()`                        | Runtime streaming interface           | Change stream support not built                |
| Data migration      | `updateMany` with field transform   | Data migration runner                 | Data migration runner not built                |


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
├── prisma-next.config.ts            # PN config: family, target, adapter, driver, contract provider
├── prisma/
│   └── contract.prisma              # PSL schema (source of truth for data model)
├── migrations/                      # generated by `prisma-next migration plan`
│   └── <timestamp>_migration/
│       ├── migration.json
│       └── ops.json
├── src/
│   ├── contract.json                # generated by `prisma-next contract emit`
│   ├── contract.d.ts                # generated
│   ├── db.ts                        # database factory (createClient: uri, dbName → orm + pipeline)
│   ├── data/                        # data access layer (all PN ORM/pipeline calls live here)
│   │   ├── products.ts
│   │   ├── users.ts
│   │   ├── carts.ts
│   │   ├── orders.ts
│   │   ├── locations.ts
│   │   ├── invoices.ts
│   │   └── events.ts
│   └── seed.ts                      # seed data for tests and demos
├── scripts/
│   └── seed.ts                      # standalone seed script with .env support
├── app/                             # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                     # product catalog / landing page
│   ├── cart/
│   │   └── page.tsx
│   ├── orders/
│   │   └── page.tsx
│   ├── orders/[id]/
│   │   └── page.tsx
│   └── api/                         # API routes — representative sample
│       ├── products/route.ts
│       ├── cart/route.ts
│       ├── orders/route.ts
│       └── ...
└── test/
    ├── crud-lifecycle.test.ts       # full CRUD + upsert + embedded docs
    ├── relations.test.ts            # cross-collection $lookup tests
    ├── aggregation.test.ts          # pipeline builder tests
    └── setup.ts                     # shared MongoMemoryReplSet setup
```

The data access layer (`src/data/`) is the boundary where PN is used — API routes call into it, never touching the MongoDB driver directly. The contract is authored in PSL (`prisma/contract.prisma`) and emitted via `prisma-next contract emit`. Tests use `mongodb-memory-server`.

**Key patterns from the updated `mongo-demo`:**

- `prisma-next.config.ts` includes `driver: mongoDriver` (from `@prisma-next/driver-mongo/control`) and `db: { connection: ... }`
- `db.ts` creates a `pipeline` via `mongoPipeline<Contract>({ contractJson })` alongside the ORM
- `validateMongoContract` imports from `@prisma-next/mongo-contract` (not `mongo-core`)
- `createMongoRuntime` no longer takes `loweringContext`

---

## Milestones

The original plan had 8 milestones, most blocked on missing framework features. With the new base branch, the first 5 milestones (through aggregation) are fully unblocked and can be consolidated.

### Milestone 1: Scaffold + Contract + Migrations

Set up the workspace package, author the full contract with embedded value objects, and generate the initial schema migration.

**Framework dependencies:** All available on the base branch.

**Tasks:**

- [ ] Create `examples/retail-store/` with `package.json`, `tsconfig.json`, `biome.jsonc`, `vitest.config.ts` — following the updated `mongo-demo` structure (including `@prisma-next/mongo-pipeline-builder`, `@prisma-next/mongo-query-ast`, `@prisma-next/mongo-contract`)
- [ ] Write `prisma-next.config.ts` with `driver: mongoDriver`, `db: { connection }`, and `mongoContract()` provider
- [ ] Write `prisma/contract.prisma` using the PSL `type` keyword for all embedded value objects:
  - `type Price { amount Float; currency String }`
  - `type Image { url String }`
  - `type Address { streetAndNumber String; city String; postalCode String; country String }`
  - `type CartItem { productId ObjectId; name String; brand String; amount Int; price Price; image Image }`
  - `type OrderLineItem { productId ObjectId; name String; brand String; amount Int; price Price; image Image }`
  - `type StatusEntry { status String; timestamp DateTime }`
  - `type InvoiceLineItem { name String; amount Int; unitPrice Float; lineTotal Float }`
  - `type EventMetadata { productId String?; subCategory String?; brand String?; query String?; exitMethod String? }`
  - 7 models with proper relations, using these embedded types
- [ ] Run `prisma-next contract emit`, commit `contract.json` + `contract.d.ts`
- [ ] Run `prisma-next migration plan`, commit the initial migration (creates collections + indexes)
- [ ] Write `src/db.ts` database factory with ORM + pipeline builder (following updated `mongo-demo` pattern)
- [ ] Write `src/seed.ts` and `scripts/seed.ts` with realistic seed data for all 7 collections

### Milestone 2: CRUD + Relations + Embedded Documents

Build the full data access layer with reads, writes, and relation loading. This consolidates the old M2 (reads), M3 (writes), and the non-blocked parts of M4 (upsert, $set).

**Framework dependencies:** ORM `findMany` + `include()` + `create` + `update` + `delete` + `upsert` — all available.

**Tasks:**

- [ ] Implement product queries: `findProducts()`, `findProductById(id)`
- [ ] Implement user queries: `findUsers()`, `findUserById(id)` — verify embedded `address` appears inline
- [ ] Implement location queries: `findLocations()`
- [ ] Implement invoice queries: `findInvoiceById(id)`, `findInvoiceWithOrder(id)` — verify embedded `items` inline + `include({ order: true })`
- [ ] Implement cart queries: `getCartByUserId(userId)`, `getCartWithUser(userId)` — verify embedded `items` inline + `include({ user: true })`
- [ ] Implement order queries: `getUserOrders(userId)`, `getOrderById(id)`, `getOrderWithUser(id)` — verify embedded `items` + `statusHistory` inline + `include({ user: true })`
- [ ] Implement event queries: `findEventsByUser(userId)` — verify embedded `metadata` inline
- [ ] Implement `createOrder(order)` — `orm.orders.create(...)` with initial status entry and embedded line items
- [ ] Implement `deleteOrder(id)` — `orm.orders.delete(...)`
- [ ] Implement `createEvent(event)` — `orm.events.create(...)`
- [ ] Implement `upsertCart(userId, items)` — `orm.carts.upsert(...)`
- [ ] Implement `clearCart(userId)` — `orm.carts.where(...).update({ items: [] })`
- [ ] Write integration tests covering: reads, creates, deletes, upsert, relation loading ($lookup), embedded documents inline in results
- [ ] Write seed test to verify `seed()` populates all collections and data is queryable via ORM

### Milestone 3: Array update operators (raw commands)

Implement cart add/remove and order status updates using `$push`/`$pull` via raw commands. The ORM does not yet have typed array update operators, so these use the runtime's raw command surface — still PN framework code.

**Framework dependencies:** Raw command execution via runtime (available). Typed `$push`/`$pull` on ORM (not available — tracked as a framework gap).

**Tasks:**

- [ ] Implement `addToCart(userId, item)` — raw `updateOne` with `$push: { items: item }`
- [ ] Implement `removeFromCart(userId, productId)` — raw `updateOne` with `$pull: { items: { productId } }`
- [ ] Implement `updateOrderStatus(orderId, entry)` — raw `updateOne` with `$push: { statusHistory: entry }`
- [ ] Write integration tests for each update operator pattern
- [ ] Document that these will migrate to ORM `$push`/`$pull` when the typed array operator surface ships

### Milestone 4: Aggregation pipelines

Add event analytics using the pipeline builder.

**Framework dependencies:** `@prisma-next/mongo-pipeline-builder` (available).

**Tasks:**

- [ ] Implement `aggregateEventsByType(userId)` — pipeline builder: `$match` → `$group` → `$unwind` → `$project` → `$sort`
- [ ] Implement `getRandomProducts(count)` — pipeline builder with `$sample` stage
- [ ] Write integration tests for aggregation results

### Milestone 5: Vector search (optional — Atlas required)

Add product similarity queries using the pipeline builder's `$vectorSearch` stage.

**Framework dependencies:** Pipeline builder has `$vectorSearch` stage support (available). Atlas cluster required for testing.

**Tasks:**

- [ ] Add `embedding` field to the Product model in the PSL schema (if not already included in M1)
- [ ] Implement `findSimilarProducts(embedding, limit)` — pipeline builder with `$vectorSearch` stage
- [ ] Write optional integration test (requires Atlas): seed products with embeddings, query by vector, assert results ordered by relevance
- [ ] Document Atlas cluster requirement for this feature

### Milestone 6: Close-out

Verify all acceptance criteria, document gaps, and finalize.

**Tasks:**

- [ ] Run full test suite — all tests pass
- [ ] Run typecheck — no errors
- [ ] Verify all testable acceptance criteria from the spec
- [ ] Document framework gaps discovered (with tickets if appropriate):
  - Typed `$push`/`$pull` array operators on ORM
  - Change stream support
  - Atlas Search extension pack
  - Data migration runner
- [ ] Write README for `examples/retail-store/`
- [ ] Verify migrations apply cleanly against `mongodb-memory-server`

---

## Mapping to Original App

This section documents how each original retail-store-v2 API route maps to our design:


| Original route                  | Original operation                                                  | Our equivalent                                                  | Notes                                                        |
| ------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `getProducts`                   | `find` with brand/category filters, projection                      | `findProducts(filters)`                                         | Same query, typed filters                                    |
| `search`                        | `$search` aggregation pipeline                                      | `searchProducts(query)`                                         | Blocks on Atlas Search extension                             |
| `getProductId`                  | `find({_id})`                                                       | `findProductById(id)`                                           | Direct mapping                                               |
| `getUsers`                      | `find({})`                                                          | `findUsers()`                                                   | Direct mapping                                               |
| `getCart`                       | `find({user: ObjectId})`                                            | `getCartByUserId(userId)`                                       | Direct mapping                                               |
| `fillCart`                      | `$sample` + `findOneAndUpdate` with upsert, `$setOnInsert`, `$push` | `upsertCart(userId, items)`                                     | Split: random product selection is separate from cart upsert |
| `updateCartProducts`            | `$push` (add) or `$pull` (remove) via `findOneAndUpdate`            | `addToCart(userId, item)` / `removeFromCart(userId, productId)` | Split into explicit add/remove                               |
| `clearCart`                     | `updateOne` with `$set: {products: []}`                             | `clearCart(userId)`                                             | Direct mapping                                               |
| `createOrder`                   | `insertOne` with constructed document                               | `createOrder(order)`                                            | Direct mapping                                               |
| `getOrders`                     | `find({user}).sort({_id: -1})`                                      | `getUserOrders(userId)`                                         | Direct mapping                                               |
| `getOrderDetails`               | `find({_id})`                                                       | `getOrderById(orderId)`                                         | Direct mapping                                               |
| `updateOrderStatus`             | `updateOne` with `$push: {status_history}`                          | `updateOrderStatus(orderId, entry)`                             | Direct mapping                                               |
| `deleteOrder`                   | `deleteOne({_id})`                                                  | `deleteOrder(orderId)`                                          | Direct mapping                                               |
| `getStoreLocations`             | `find({})`                                                          | `findLocations()`                                               | Direct mapping                                               |
| `findDocuments` (invoices)      | Generic `find`                                                      | `findInvoiceById(id)`                                           | Typed, not generic                                           |
| `insertDocument` (sessions)     | Generic `insertOne`                                                 | Dropped                                                         | No PN value in a trivial insert                              |
| `events`                        | `insertOne` to `events_ingest`                                      | `createEvent(event)`                                            | Direct mapping                                               |
| `aggregate`                     | Generic aggregate endpoint                                          | `aggregateEventsByType(userId)`                                 | Typed, specific pipelines                                    |
| `sse`                           | `db.watch()` + SSE bridge                                           | Deferred                                                        | Change stream support not yet built                          |
| `updateDocument` (NBA redeem)   | Generic `updateOne` with `$set`                                     | Dropped (consolidated into events)                              |                                                              |
| `findDocuments` (signals, NBAs) | Generic `find`                                                      | Dropped (consolidated into events)                              |                                                              |
| `getAssistantResponse`          | Chatbot integration                                                 | Dropped                                                         | Out of scope (validates Dataworkz)                           |
| `getInvoiceUrl`                 | URL generation                                                      | Dropped                                                         | App-level concern                                            |


---

## Framework Gaps (Remaining)

Compared to the original plan, most gaps are now closed. These remain:


| Gap                                    | Impact                                          | Status                                                                       |
| -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| ~~ORM `create`/`update`/`delete`~~     | ~~M3~~                                          | **Shipped** on base branch                                                   |
| Typed `$push`/`$pull` array operators  | M3 uses raw commands instead of ORM operators   | Not on ORM; raw commands work as workaround                                  |
| ~~Upsert support~~                     | ~~M4~~                                          | **Shipped** on base branch                                                   |
| ~~Value objects in contract~~          | ~~M1~~                                          | **Shipped** — PSL `type` keyword                                             |
| ~~Mongo migration planner~~            | ~~M5~~                                          | **Shipped** on base branch                                                   |
| ~~Aggregation pipeline builder~~       | ~~M7~~                                          | **Shipped** — `@prisma-next/mongo-pipeline-builder`                          |
| Vector search extension pack           | M5 uses pipeline builder `$vectorSearch` stage  | Stage exists in pipeline builder; no dedicated extension pack for Mongo       |
| Atlas Search extension pack            | Product text search not implementable            | Not built                                                                    |
| Change stream support                  | Event change stream deferred                    | Not built (no evidence on base branch)                                       |
| Data migration runner                  | Data migration deferred                         | Schema migration runner exists; data migration runner unclear                |


---

## Test Coverage


| Acceptance Criterion                                     | Test Type                  | Milestone |
| -------------------------------------------------------- | -------------------------- | --------- |
| Contract emits valid `contract.json` and `contract.d.ts` | Build                      | M1        |
| Schema migrations create correct indexes                 | Integration                | M1        |
| Embedded value objects inline in results                 | Integration                | M2        |
| `$lookup` relations load via `include()`                 | Integration                | M2        |
| All CRUD operations work via ORM                         | Integration                | M2        |
| Cart upsert works                                        | Integration                | M2        |
| `$push`/`$pull` array update operators work              | Integration                | M3        |
| Aggregation pipeline produces correct analytics          | Integration                | M4        |
| `$sample` returns random documents                       | Integration                | M4        |
| Vector search returns similarity-ordered results         | Integration (Atlas-only)   | M5        |
| Full suite passes against `mongodb-memory-server`        | CI                         | M6        |


