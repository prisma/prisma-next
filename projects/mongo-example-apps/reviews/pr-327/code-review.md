# Code Review

**Branch:** `tml-2185-port-retail-store-v2-e-commerce-app-to-prisma-next-mongodb`
**Base:** `origin/main`
**PR:** [#327](https://github.com/prisma/prisma-next/pull/327)
**Specs:** [projects/mongo-example-apps/spec.md](../../spec.md), [projects/mongo-example-apps/specs/retail-store-round-2.spec.md](../../specs/retail-store-round-2.spec.md)

---

## Acceptance criteria status

### Project spec (spec.md) — Retail Store portion

| Criterion | Status | Evidence |
|---|---|---|
| PN contract authored in PSL | DONE | [prisma/contract.prisma](../../../../examples/retail-store/prisma/contract.prisma) |
| Contract emits valid contract.json + contract.d.ts | DONE | [src/contract.json](../../../../examples/retail-store/src/contract.json), [src/contract.d.ts](../../../../examples/retail-store/src/contract.d.ts) |
| Schema migrations create collections, indexes, validators | DONE (with caveats — see F01) | [migrations/20260413T0314_migration/](../../../../examples/retail-store/migrations/20260413T0314_migration/) |
| All CRUD via PN ORM | DONE | [src/data/](../../../../examples/retail-store/src/data/) |
| Embedded documents inline in results | DONE | Value objects (Price, Image, Address, CartItem, etc.) returned inline |
| Referenced relations via $lookup include() | DONE | [test/relations.test.ts](../../../../examples/retail-store/test/relations.test.ts) |
| Query results fully typed | PARTIAL — `as string` casts needed for _id fields, `as T` for pipeline results | See F04, F05 |
| At least one mutation uses $push/$pull | DONE | Cart add/remove, order status update |
| Vector search works via extension pack | STUB | `findSimilarProducts` defined but requires Atlas; not tested |
| At least one data migration runs | NO | Migration planner generates schema-only operations |
| Change stream subscription | NO | Not supported in framework |
| Runs against mongodb-memory-server | DONE | [test/setup.ts](../../../../examples/retail-store/test/setup.ts) |
| Demonstrates ≥3 MongoDB idioms | DONE | Embedded docs, referenced relations, polymorphism, update operators, aggregation, search, indexes |

### Round 2 spec (retail-store-round-2.spec.md)

| Criterion | Status | Evidence |
|---|---|---|
| Login stub with signup/logout | DONE | [app/login/page.tsx](../../../../examples/retail-store/app/login/page.tsx), [app/api/auth/](../../../../examples/retail-store/app/api/auth/) |
| Navbar displays user name + logout | DONE | [src/components/navbar.tsx](../../../../examples/retail-store/src/components/navbar.tsx) |
| Product catalog with pagination | DONE | [app/page.tsx](../../../../examples/retail-store/app/page.tsx) with skip/take |
| Product search | DONE | [app/api/products/route.ts](../../../../examples/retail-store/app/api/products/route.ts) with $regex |
| Add to cart | DONE | [src/components/add-to-cart-button.tsx](../../../../examples/retail-store/src/components/add-to-cart-button.tsx) |
| Cart page with remove/clear | DONE | [app/cart/page.tsx](../../../../examples/retail-store/app/cart/page.tsx) |
| Navbar cart count | DONE | [src/components/cart-badge.tsx](../../../../examples/retail-store/src/components/cart-badge.tsx) |
| Checkout with home/BOPIS | DONE | [app/checkout/page.tsx](../../../../examples/retail-store/app/checkout/page.tsx) |
| Orders page + detail | DONE | [app/orders/page.tsx](../../../../examples/retail-store/app/orders/page.tsx), [app/orders/\[id\]/page.tsx](../../../../examples/retail-store/app/orders/[id]/page.tsx) |
| Order status progression | DONE | [app/orders/\[id\]/order-status-buttons.tsx](../../../../examples/retail-store/app/orders/[id]/order-status-buttons.tsx) |
| BOPIS location picker | DONE | Fetches from /api/locations in checkout |
| UI component library | DONE | shadcn-style components under [src/components/ui/](../../../../examples/retail-store/src/components/ui/) |
| Existing tests pass | DONE | All test files exercise mongodb-memory-server |

---

## Findings

### FRAMEWORK LIMITATIONS

These are gaps in the Prisma Next framework surfaced by this example app. Each one is a signal that the framework needs work.

| ID | Finding | Description | Location |
|---|---|---|---|
| F01 | **Migration planner creates separate collections for polymorphic variants** | The planner generates `collection.addToCartEvent.create`, `collection.searchEvent.create`, `collection.viewProductEvent.create` as separate collection operations. Variant models share the base model's collection — they should not get their own. This produces incorrect migration artifacts that would create unnecessary empty collections if applied. | [ops.json L1–47, L509–551, L626–675](../../../../examples/retail-store/migrations/20260413T0314_migration/ops.json) |
| F02 | **Variant collection validators are incomplete** | The validators for variant collections (e.g., `searchEvent`) include only variant-specific fields (e.g., `query`) and miss all base model fields (`_id`, `userId`, `sessionId`, `timestamp`, `type`). Even if variant collections were intentional, the validators would be structurally wrong. | [ops.json L529–541](../../../../examples/retail-store/migrations/20260413T0314_migration/ops.json) |
| F03 | **$jsonSchema validator drops `Float` fields** | The `Price` value object validator includes `currency` but not `amount`. The `InvoiceLineItem` validator includes `amount` and `name` but drops `unitPrice`, `lineTotal`. The JSON schema derivation doesn't recognize the `Float` scalar type, so fields typed as `Float` are silently omitted from validators. | [ops.json L105–115](../../../../examples/retail-store/migrations/20260413T0314_migration/ops.json) — `Price` validator has `required: ["currency"]` |
| F04 | **`_id` field returns opaque type requiring String() casts** | ORM query results return `_id` as an opaque codec output type, not `string`. Code must cast via `String(entity._id)` or `entity._id as string` throughout the data layer and seed script. This is pervasive across the entire app. | [src/seed.ts](../../../../examples/retail-store/src/seed.ts), [src/data/orders.ts](../../../../examples/retail-store/src/data/orders.ts), [test/api-flows.test.ts](../../../../examples/retail-store/test/api-flows.test.ts) |
| F05 | **ORM string fields return opaque codec output type** | Fields like `name`, `brand`, `code` return codec output types rather than `string`, forcing `String(p0.name)` casts in the seed. The contract types know these are `mongo/string@1` codec fields, but the ORM's output type resolution doesn't simplify codec types to their JS primitives. | [src/seed.ts L152–175](../../../../examples/retail-store/src/seed.ts) |
| F06 | **Pipeline and raw query results are untyped** | The pipeline builder and `runtime.execute()` return untyped async iterables. The `collectResults<T>()` helper casts `row as T` at the boundary. The framework has no mechanism to propagate result types through aggregation stages or raw commands. | [src/data/execute-raw.ts L11–14](../../../../examples/retail-store/src/data/execute-raw.ts) |
| F07 | **ORM lacks typed $push/$pull array update operators** | The ORM's `update()` method only supports `$set` semantics. Array update operators (`$push`, `$pull`, `$inc`) require dropping to `mongoRaw` with untyped commands and manual `MongoParamRef` wrapping. This is the most exercised workaround in the app (cart add/remove, order status update). | [src/data/carts.ts L43–63](../../../../examples/retail-store/src/data/carts.ts), [src/data/orders.ts](../../../../examples/retail-store/src/data/orders.ts) |
| F08 | **ObjectId filter requires MongoParamRef wrapping** | Filtering by ObjectId-typed fields requires constructing `MongoFieldFilter.of('userId', '$eq', new MongoParamRef(userId, { codecId: 'mongo/objectId@1' }))` instead of a simpler `where({ userId })`. The helper `objectIdEq()` in `object-id-filter.ts` exists to reduce this boilerplate. | [src/data/object-id-filter.ts](../../../../examples/retail-store/src/data/object-id-filter.ts) |
| F09 | **No $vectorSearch stage in pipeline builder** | `findSimilarProducts` in `products.ts` is a stub that would need raw aggregate to implement `$vectorSearch`. The pipeline builder doesn't expose a `vectorSearch()` stage. Requires an extension pack not yet built. | [src/data/products.ts](../../../../examples/retail-store/src/data/products.ts) |
| F10 | **Embedded models via `owner` not supported in PSL** | The contract schema and emitter accept `owner`, but PSL has no `@@owner` attribute and the ORM has no embedded entity CRUD handling. Can't demonstrate embedded entities (as distinct from value objects) in PSL-authored apps. | — |
| F11 | **Polymorphism demonstrated but not demonstrated in the UI** | `@@discriminator`/`@@base` work correctly in the ORM (create with auto-injected discriminator, variant queries with discriminator filter). The data layer and tests fully exercise this. The UI doesn't surface event variants — events are only created/queried in tests and seed, not in user-facing pages. | [test/polymorphism.test.ts](../../../../examples/retail-store/test/polymorphism.test.ts), [src/data/events.ts](../../../../examples/retail-store/src/data/events.ts) |

### CODE QUALITY

| ID | Finding | Description | Location |
|---|---|---|---|
| C01 | **Fabricated image URLs** | Product images use URLs like `/images/products/her-oxf-001.jpg` but no such images exist in the project. The product cards and detail page render broken `<img>` tags. Consider using placeholder services or removing the `<img>` tag. | [src/seed.ts L145](../../../../examples/retail-store/src/seed.ts) |
| C02 | **Domain model README out of date** | The README says `Events ─── EventMetadata (embedded)` but the schema now uses polymorphic variants (ViewProductEvent, SearchEvent, AddToCartEvent). The `EventMetadata` type no longer exists. | [README.md L86](../../../../examples/retail-store/README.md) |
| C03 | **`String()` calls throughout seed for value-object-nested field access** | The seed script uses `String(p0.name)`, `String(p0.brand)`, `String(p0.code)` to convert codec output types to strings when constructing cart/order items. This is verbose and obscures intent. This is caused by F05 (framework limitation). | [src/seed.ts L147–175](../../../../examples/retail-store/src/seed.ts) |
| C04 | **`UNAUTHORIZED` response object may be shared across requests** | `const UNAUTHORIZED = NextResponse.json(...)` is defined at module scope in the order route. Next.js `Response` objects may not be safely reused across requests in some contexts (headers can be mutated). Consider creating fresh responses per request. | [app/api/orders/\[id\]/route.ts L11–12](../../../../examples/retail-store/app/api/orders/[id]/route.ts) |

### POSITIVE OBSERVATIONS

| ID | Observation | Detail |
|---|---|---|
| P01 | **Clean data access separation** | Each collection has its own module with typed functions. No raw MongoDB calls leak into routes or components. |
| P02 | **Framework fixes driven by example** | The branch includes 4 framework fixes discovered during development: ORM codec attachment, adapter codec encoding, nullable VO validators, optional codec.encode guard. Each fix has a corresponding test. |
| P03 | **Polymorphic events demonstrate real-world pattern** | The Event model with discriminator and 3 variants is the cleanest demonstration of PN's polymorphism support. Tests cover variant creation, base-collection queries, and discriminator-filtered queries. |
| P04 | **Index variety** | The PSL contract demonstrates text indexes with weights, compound indexes, hashed indexes, TTL indexes, sparse indexes, and collation-aware indexes — all in one schema. The migration test verifies each one. |
| P05 | **Test infrastructure** | The shared `setupTestDb()` helper creates isolated MongoMemoryReplSet instances per test suite, with proper cleanup. 12 test files cover the full data access surface. |
| P06 | **Interactive e-commerce loop** | Browse → search → add to cart → checkout → orders — each step exercises a distinct PN capability through the data access layer. |

---

## Summary

The branch delivers a substantial, working e-commerce example that validates PN's MongoDB support across embedded value objects, reference relations, polymorphism, array operators, pipelines, search, and schema indexes. The framework fixes (ORM codec attachment, adapter encoding, nullable validators) are well-scoped and tested.

The most significant framework limitations surfaced are:

1. **Migration planner bug with polymorphic variants** (F01–F02) — creates incorrect separate collections
2. **Float fields dropped from validators** (F03) — silent data loss in schema validation
3. **Opaque codec output types** (F04–F05) — forces String() casts everywhere
4. **No typed array update operators** (F07) — the most exercised workaround
5. **Untyped pipeline/raw results** (F06) — forces `as T` casts

These are genuine framework signals. The app is correctly structured to highlight them rather than paper over them.
