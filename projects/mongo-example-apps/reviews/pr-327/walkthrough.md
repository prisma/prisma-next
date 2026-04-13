# Walkthrough

## Sources

- PR: [#327](https://github.com/prisma/prisma-next/pull/327)
- Specs: [projects/mongo-example-apps/spec.md](../../spec.md), [projects/mongo-example-apps/specs/retail-store-round-2.spec.md](../../specs/retail-store-round-2.spec.md)
- Commit range: `origin/main...HEAD` (43 commits, 91 files, ~12.8k lines)

## Intent

Build a working interactive e-commerce application — the "retail store" — that validates Prisma Next's MongoDB support against a real-world data model. The app exercises embedded value objects, referenced relations, polymorphic types, array update operators, aggregation pipelines, multi-field search, pagination, schema indexes, and migration artifacts. Along the way, fix the framework bugs discovered during development.

## The story

1. **Define the domain in PSL** — A contract with 7 models, 3 polymorphic variants, and 8 embedded value object types establishes the retail domain: products, users, carts, orders, invoices, locations, and events. The PSL contract uses `@@discriminator`/`@@base` for polymorphic events, `@@textIndex` with weights, compound/hashed/TTL/sparse/collation-aware indexes, and `@unique` for email.

2. **Build a typed data access layer** — One module per collection under `src/data/` wraps all database operations in typed functions that accept a `Db` handle and return typed results. ORM CRUD for standard operations, `mongoRaw` for array update operators (`$push`/`$pull`), pipeline builder for aggregation, and `$regex` for search. No raw MongoDB calls leak outside this layer.

3. **Make it interactive** — Cookie-based auth (signup creates a user, sets a `userId` cookie), product catalog with pagination and search, add-to-cart with live badge updates, checkout with home delivery vs. BOPIS (store location picker), order management with status progression. Built with Next.js App Router, Tailwind CSS v4, and shadcn-style UI components.

4. **Fix the framework to make it work** — Four framework bugs discovered during development were fixed in their proper packages: ORM codec attachment on mutations, adapter codec encoding via registry, nullable value object validator derivation, and optional codec.encode guard.

5. **Validate with tests** — 12 test files covering CRUD lifecycle, relations, polymorphism, aggregation, search, cart/order lifecycle, API-level flows, migration/indexes, and seeding. All tests run against `mongodb-memory-server`.

## Behavior changes & evidence

### Adds a complete e-commerce example app

Adds a Next.js retail store application under `examples/retail-store/` that demonstrates the full range of PN's MongoDB capabilities through an interactive storefront.

- **Why**: The existing examples (mongo-demo) cover basic CRUD. The project spec requires validation against a real-world data model with real complexity.
- **Implementation**:
  - [examples/retail-store/prisma/contract.prisma](examples/retail-store/prisma/contract.prisma) — PSL contract with 7 models, 3 variants, 8 value objects, 11 indexes
  - [examples/retail-store/src/data/](examples/retail-store/src/data/) — data access layer (carts, events, invoices, locations, orders, products, users)
  - [examples/retail-store/src/db.ts](examples/retail-store/src/db.ts) — db factory
  - [examples/retail-store/src/seed.ts](examples/retail-store/src/seed.ts) — seed data (24 products, 4 locations, users, orders, events)
  - [examples/retail-store/app/](examples/retail-store/app/) — Next.js pages and API routes
  - [examples/retail-store/src/components/](examples/retail-store/src/components/) — navbar, cart provider, add-to-cart, UI primitives
  - [examples/retail-store/middleware.ts](examples/retail-store/middleware.ts) — auth middleware
- **Tests**:
  - [examples/retail-store/test/crud-lifecycle.test.ts](examples/retail-store/test/crud-lifecycle.test.ts) — CRUD operations per collection
  - [examples/retail-store/test/relations.test.ts](examples/retail-store/test/relations.test.ts) — $lookup via include()
  - [examples/retail-store/test/update-operators.test.ts](examples/retail-store/test/update-operators.test.ts) — $push/$pull for carts and orders
  - [examples/retail-store/test/aggregation.test.ts](examples/retail-store/test/aggregation.test.ts) — event aggregation, random product sampling
  - [examples/retail-store/test/polymorphism.test.ts](examples/retail-store/test/polymorphism.test.ts) — variant creation, discriminator filtering, base queries
  - [examples/retail-store/test/search.test.ts](examples/retail-store/test/search.test.ts) — multi-field $regex search, pagination
  - [examples/retail-store/test/cart-lifecycle.test.ts](examples/retail-store/test/cart-lifecycle.test.ts) — cart add/remove/clear/upsert
  - [examples/retail-store/test/order-lifecycle.test.ts](examples/retail-store/test/order-lifecycle.test.ts) — order create/status/delete
  - [examples/retail-store/test/api-flows.test.ts](examples/retail-store/test/api-flows.test.ts) — order ownership, checkout flow, status progression
  - [examples/retail-store/test/seed.test.ts](examples/retail-store/test/seed.test.ts) — seed data integrity
  - [examples/retail-store/test/migration.test.ts](examples/retail-store/test/migration.test.ts) — contract index definitions, index creation on real MongoDB

### ORM mutations now encode values through the codec registry

**Before**: `MongoParamRef` instances created by the ORM carried no codec information. The adapter passed `MongoParamRef.value` to the wire as-is. String-typed ObjectId fields were sent as plain strings, causing type mismatches when MongoDB expected BSON ObjectIds.

**After**: The ORM's `#toDocument()` and `#toSetFields()` methods look up each field's `codecId` from the contract and attach it to the `MongoParamRef`. The adapter's `resolveValue()` checks for `codecId` and calls `codec.encode()` before sending to the wire. This ensures ObjectId fields are properly encoded to BSON ObjectIds without manual wrapping.

- **Why**: Without codec encoding, ORM mutations that write to `ObjectId`-typed foreign key fields (e.g., `cart.userId`, `order.userId`) would write plain strings instead of BSON ObjectIds, breaking `$lookup` joins and index usage.
- **Implementation**:
  - [packages/2-mongo-family/5-query-builders/orm/src/collection.ts](packages/2-mongo-family/5-query-builders/orm/src/collection.ts) — `#wrapFieldValue()`, `#wrapValueObject()`, `#modelFields()` methods; updated `#toDocument()` and `#toSetFields()`
  - [packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts](packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts) — codec lookup and encode in `resolveValue()`
  - [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts](packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts) — adapter accepts codec registry, passes to resolveDocument/resolveValue
- **Tests**:
  - [packages/2-mongo-family/5-query-builders/orm/test/collection.test.ts](packages/2-mongo-family/5-query-builders/orm/test/collection.test.ts) — "attaches codecId from contract fields to MongoParamRef", "attaches objectId codecId"
  - [packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts](packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts) — codec encode with/without registry, nested objects/arrays
  - [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — "MongoAdapter with codec registry" suite

### Nullable value object fields produce correct $jsonSchema validators

**Before**: A nullable value object field like `address Address?` produced a required-object validator, rejecting `null` values. Documents with `address: null` would fail schema validation.

**After**: Nullable value object fields produce `oneOf: [{ bsonType: "null" }, { bsonType: "object", ... }]` and are excluded from the `required` array.

- **Why**: The retail store's `User` model has `address Address?` (users can sign up without an address). Without this fix, inserting a user with `address: null` would fail the validator.
- **Implementation**:
  - [packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts](packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts) — nullable check in `fieldToBsonSchema()`
- **Tests**:
  - [packages/2-mongo-family/2-authoring/contract-psl/test/interpreter.test.ts](packages/2-mongo-family/2-authoring/contract-psl/test/interpreter.test.ts) — "handles nullable value object fields with oneOf null or object"

### Schema indexes are authored in PSL and flow through to migration operations

Adds `@@index`, `@@textIndex`, and `@unique` support to the retail store's PSL contract. The contract produces index definitions that the migration planner converts to `createIndex` operations with the correct options (unique, sparse, TTL expiry, collation, text weights, hashed type, compound sort directions).

- **Why**: Real MongoDB applications need indexes for query performance. The retail store's indexes are representative of production usage: text search with relevance weights, TTL expiry for analytics events, case-insensitive location lookup, and foreign key indexes for $lookup joins.
- **Implementation**:
  - [examples/retail-store/prisma/contract.prisma](examples/retail-store/prisma/contract.prisma) — 11 index definitions across 7 collections
  - [examples/retail-store/migrations/20260413T0314_migration/ops.json](examples/retail-store/migrations/20260413T0314_migration/ops.json) — generated index operations
- **Tests**:
  - [examples/retail-store/test/migration.test.ts](examples/retail-store/test/migration.test.ts) — validates contract index structure and creates indexes on real MongoDB

### Polymorphic events via @@discriminator/@@base

Adds a polymorphic `Event` collection with three variant models (`ViewProductEvent`, `SearchEvent`, `AddToCartEvent`) using `@@discriminator(type)` and `@@base(Event, "...")`. The ORM's `variant()` method auto-injects discriminator values on create and discriminator filters on query.

- **Why**: Polymorphism is a common MongoDB pattern. The Event model is a natural fit: all events share base fields (userId, sessionId, timestamp) but each type has different metadata fields.
- **Implementation**:
  - [examples/retail-store/prisma/contract.prisma](examples/retail-store/prisma/contract.prisma) — lines 120–151
  - [examples/retail-store/src/data/events.ts](examples/retail-store/src/data/events.ts) — typed create/query functions per variant
- **Tests**:
  - [examples/retail-store/test/polymorphism.test.ts](examples/retail-store/test/polymorphism.test.ts) — variant creation, base queries, discriminator filtering, variant field access

## Compatibility / migration / risk

- **Framework package changes are backward-compatible**: The ORM and adapter changes add optional behavior (codec encoding) that only activates when `MongoParamRef` carries a `codecId`. Existing code that constructs bare `MongoParamRef(value)` is unaffected.
- **`createMongoAdapter()` signature change**: Now accepts an optional `MongoCodecRegistry` parameter. Existing callers that pass no arguments get a default registry with all built-in codecs. This is non-breaking.
- **Migration planner bug (F01)**: The generated `ops.json` includes incorrect collection creation operations for polymorphic variant models. If applied as-is, it would create 3 empty collections (`addToCartEvent`, `searchEvent`, `viewProductEvent`) that serve no purpose. The base `events` collection and its indexes are correct.

## Follow-ups / open questions

- **Migration planner variant handling (F01–F02)**: The planner needs to recognize `@@base` models and suppress collection creation for them. Their fields should be validated as part of the base model's validator, not independently.
- **Float field in $jsonSchema (F03)**: The validator derivation silently drops Float-typed fields. Should map to `bsonType: "double"`.
- **Codec output type ergonomics (F04–F05)**: The most pervasive friction in the app — every `_id` access and many string field accesses require `String()` casts. The type system knows these are `mongo/string@1` and `mongo/objectId@1` — it should resolve to `string` in the ORM output type.
- **Typed array update operators (F07)**: The most frequently exercised workaround. ORM `update()` only supports `$set`; `$push`/`$pull`/`$inc` require raw commands.
- **Pipeline output types (F06)**: Pipeline builder results are untyped. No mechanism to propagate types through aggregation stages.

## Non-goals / intentionally out of scope

- **Predictive maintenance app**: The second app in the project spec. Tracked separately.
- **Atlas-specific features**: Vector search, Atlas Search, change streams. Stubs exist for vector search but require Atlas credentials.
- **Real authentication**: The login stub fabricates users and sets a plain-text cookie. No OAuth, JWT, or session management.
- **Full UI port**: The UI is functional but simplified. No Redux, no chatbot, no guided tours, no real-time SSE.
