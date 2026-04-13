# System Design Review

**Branch:** `tml-2185-port-retail-store-v2-e-commerce-app-to-prisma-next-mongodb`
**Base:** `origin/main`
**PR:** [#327](https://github.com/prisma/prisma-next/pull/327)
**Specs:** [projects/mongo-example-apps/spec.md](../../spec.md), [projects/mongo-example-apps/specs/retail-store-round-2.spec.md](../../specs/retail-store-round-2.spec.md)

---

## Problem being solved

Validate that Prisma Next's MongoDB implementation handles a real-world data model — an interactive e-commerce platform with embedded value objects, referenced relations, polymorphic types, array update operators, aggregation pipelines, search, schema indexes, and migration artifacts. The retail store exercises more PN Mongo features in one app than any existing example.

## New guarantees / invariants

1. **PSL contract with embedded value objects**: 8 `type` definitions (Price, Image, Address, CartItem, OrderLineItem, StatusEntry, InvoiceLineItem, EventMetadata) produce `valueObject`-kind fields in the contract. The ORM wraps value object data in correctly-typed `MongoParamRef` entries with `codecId` at mutation time.

2. **Polymorphic event collection**: The `Event` base model with `@@discriminator(type)` and three variant models (`ViewProductEvent`, `SearchEvent`, `AddToCartEvent`) via `@@base` produce a single `events` collection. The ORM's `variant()` method injects discriminator filters on read and auto-injects discriminator values on create.

3. **ORM codec encoding**: Mutations now attach `codecId` from the contract's field definition to `MongoParamRef` instances, and the adapter encodes values through the codec registry before sending to the wire. This ensures ObjectId fields written as strings are properly encoded to BSON ObjectIds.

4. **Nullable value object validators**: The `$jsonSchema` validator derivation now handles nullable value object fields correctly, producing `oneOf: [{ bsonType: "null" }, { bsonType: "object", ... }]` instead of incorrectly requiring a non-null object.

5. **Schema indexes via PSL**: `@@index`, `@@textIndex`, `@@unique`, `@unique` in the PSL contract produce index definitions in `contract.json`, which flow through to migration operations.

## Subsystem fit

### Contract (PSL → contract.json → contract.d.ts)

The retail store uses a single `contract.prisma` file with 7 models, 3 polymorphic variants, and 8 value object types. The PSL interpreter produces the correct contract structure:

- Value objects → `type: { kind: "valueObject", name: "..." }` on model fields
- Polymorphic models → `discriminator`, `variants`, `base` on the correct models
- Indexes → `storage.collections.*.indexes` with the correct keys, options (unique, sparse, TTL, collation, weights, hashed)
- Validators → `$jsonSchema` validators derived from model field definitions

The emitted `contract.d.ts` carries fully-typed model definitions including value object nesting and polymorphic variant structure.

### ORM

The ORM handles:

- CRUD with value object fields (nested objects correctly wrapped)
- `include()` for N:1 reference relations (cart→user, order→user, invoice→order)
- `variant()` for polymorphic collection narrowing
- `skip()`/`take()` for pagination
- `where()` with `MongoFieldFilter` for filtering

The ORM does **not** handle:

- Typed `$push`/`$pull` array operators (uses `mongoRaw` instead)
- Embedded models via `owner` (value objects work; entities with identity don't)

### Runtime / Adapter

The adapter was extended to encode `MongoParamRef` values through the codec registry. This is a behavioral change: previously, all `MongoParamRef.value` was passed to the wire as-is. Now, if a `MongoParamRef` carries a `codecId`, the adapter looks up the codec and calls `encode()` before sending. This ensures that string-typed ObjectId fields are properly encoded as BSON ObjectIds.

### Migration

The planner generates collection creation operations with `$jsonSchema` validators and index creation operations from the contract. **However, there is a bug** — variant models without `@@map` get separate collection creation operations (e.g., `collection.addToCartEvent.create`, `collection.searchEvent.create`) instead of being recognized as part of the base model's collection. See F01 in code review.

## Boundary correctness

- All retail-store code lives under `examples/retail-store/` — no import into framework packages
- Framework fixes live in their proper packages: ORM changes in `packages/2-mongo-family/5-query-builders/orm/`, adapter changes in `packages/3-mongo-target/2-mongo-adapter/`, PSL validator derivation in `packages/2-mongo-family/2-authoring/contract-psl/`
- No new cross-layer or cross-domain imports introduced

## Design review

### Cookie-based auth (appropriate for demo scope)

The auth system uses a plain-text `userId` cookie set on signup, checked by Next.js middleware. This is explicitly scoped as a demo stub — no encryption, signing, or real session management. The middleware matcher correctly excludes `/login`, `/api/auth/*`, and static assets. All order routes verify ownership by comparing `order.userId` to the authenticated user.

### Cart management via raw commands

The cart add/remove operations use `mongoRaw` with `$push`/`$pull` because the ORM doesn't expose typed array update operators. This is a documented framework limitation. The `addToCart` function uses `upsert: true` with `$setOnInsert` to handle first-cart creation atomically.

### Data access layer separation

Each collection has its own module under `src/data/` with typed functions that accept `Db` and return typed results. API routes and pages compose these functions — no raw MongoDB calls leak into the UI layer. The `executeRaw()` and `collectResults<T>()` helpers in `execute-raw.ts` centralize the `for await` draining pattern for pipeline and raw results.

## Test strategy adequacy

The branch includes 12 test files:

| Test file | Coverage |
|---|---|
| `crud-lifecycle.test.ts` | Create, read, update, delete for products, users, carts, orders |
| `relations.test.ts` | `$lookup` via `include()` for cart→user, order→user, invoice→order |
| `update-operators.test.ts` | `$push`/`$pull` for cart items, `$push` for order status |
| `aggregation.test.ts` | Event type aggregation pipeline, random product sampling |
| `polymorphism.test.ts` | Variant creation, base-collection queries, discriminator filtering |
| `search.test.ts` | Multi-field `$regex` search, pagination with skip/take |
| `cart-lifecycle.test.ts` | Add, remove, clear, upsert cart operations |
| `order-lifecycle.test.ts` | Create order, status updates, get/delete operations |
| `api-flows.test.ts` | Order ownership verification, checkout flow, status progression |
| `seed.test.ts` | Seed data correctness (counts, structure) |
| `migration.test.ts` | Contract index definitions, index creation on real MongoDB |
| `setup.ts` | Shared test infrastructure with MongoMemoryReplSet |

All tests run against `mongodb-memory-server` — no external DB required. The coverage is strong for the data access layer. The gap is API route-level tests — the `api-flows.test.ts` tests the data access functions directly rather than making HTTP calls through the routes, so middleware/auth cookie behavior is not tested programmatically.

## Risk assessment

- **Migration planner produces incorrect operations for polymorphic models** — variant models get separate collection creation operations. This will fail or create unnecessary collections if applied. Low impact today (migration can be applied manually or the ops corrected), but the planner bug should be tracked.
- **No integration test verifying the migration operations apply successfully** — the `migration.test.ts` validates contract index definitions and manually creates indexes, but doesn't run the actual migration planner output against a database.
