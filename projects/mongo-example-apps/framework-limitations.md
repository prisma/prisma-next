# Framework Limitations — Retail Store Example

Framework gaps surfaced by the retail store example app. Each entry is a signal that the framework needs work — the example app is designed to expose these, not paper over them.

**Source:** Consolidated from [reviews/code-review.md](reviews/code-review.md) (round 1/2 review) and [reviews/pr-327/code-review.md](reviews/pr-327/code-review.md) (PR #327 review).

---

## Type ergonomics

These are the highest-impact issues. They force type casts at nearly every boundary between the ORM and application code.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-01 | **Scalar codec output types are not assignable to `string`/`number`** | ORM results for string fields (name, brand, code, currency) are codec wrapper types, not `string`. Every ORM-to-UI boundary requires `as string`. | ~15 `as string` casts in UI components, ~15 `String()` calls in seed | Open |
| FL-02 | **`_id` codec output type is not assignable to `string`** | ORM returns `_id` as `CodecTypes['mongo/objectId@1']['output']`. Every ID handoff between data access functions requires `as string` or `String()`. | ~30 casts across tests, data layer, and seed | Open |
| FL-03 | **Timestamp codec output type incompatible with `Date` or `string`** | The `mongo/dateTime@1` codec output type is neither `Date` nor `string`, forcing `as unknown as string` double casts — the most aggressive form of type assertion. | 1 double cast in order detail page | Open |

**Root cause:** The codec type map resolves scalar codec IDs (`mongo/string@1`, `mongo/objectId@1`, `mongo/dateTime@1`) to opaque wrapper types instead of their underlying TypeScript primitives. The runtime values *are* the expected primitives — the types just don't reflect that.

**Framework action:** Codec output types for simple scalars should resolve to types assignable to their JS primitives (`string`, `number`, `boolean`, `Date`).

---

## Query capabilities

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-04 | **ORM lacks typed `$push`/`$pull`/`$inc` array update operators** | ORM `update()` only supports `$set` semantics. Array mutations require dropping to `mongoRaw` with untyped commands and manual `MongoParamRef` construction. This is the most exercised workaround in the app. | 3 data access functions use `mongoRaw`: cart add (`$push`), cart remove (`$pull`), order status update (`$push`) | Open |
| FL-05 | **Pipeline and raw query results are untyped** | `runtime.execute()` yields `unknown`. Pipeline builder `build()` produces a plan with no result type. Every pipeline/raw call site casts `row as T` with no compile-time or runtime verification. | `collectResults<T>()` helper centralizes the cast but provides no type safety | Open |
| FL-06 | **ObjectId filter requires manual `MongoParamRef` wrapping** | Filtering by ObjectId-typed fields requires `MongoFieldFilter.of('userId', '$eq', new MongoParamRef(userId, { codecId: 'mongo/objectId@1' }))` instead of a simpler `where({ userId })`. | `objectIdEq()` helper in `object-id-filter.ts` reduces boilerplate | Open |
| FL-07 | **No `$vectorSearch` stage in pipeline builder** | The pipeline builder doesn't expose a `vectorSearch()` stage. Implementing vector search requires raw aggregate with fully untyped commands. Atlas-specific, so likely needs an extension pack. | `findSimilarProducts()` is a stub; would need raw aggregate | Open |
| FL-08 | **1:N back-relation loading not available or not tested** | `include()` only tested for N:1 relations (cart→user, order→user, invoice→order). Loading a user's carts or orders via `include()` from the user side has not been demonstrated. | N/A — only N:1 direction used | Open |

---

## Schema & migration

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-09 | **Migration planner creates separate collections for polymorphic variants** | Variant models without `@@map` get their own collection creation operations (e.g., `collection.addToCartEvent.create`). Polymorphic variants share the base model's collection — these operations are incorrect and would create unnecessary empty collections if applied. | Migration artifacts committed as-is; incorrect variant collection ops would need manual removal before applying | Open |
| FL-10 | **Variant collection validators are incomplete** | The generated validators for variant collections include only variant-specific fields (e.g., `searchEvent` validator has only `query`) and miss all base model fields (`_id`, `userId`, `sessionId`, `timestamp`, `type`). Structurally wrong even if variant collections were intentional. | N/A — consequence of FL-09 | Open |
| FL-11 | **`$jsonSchema` validator drops `Float` fields** | The JSON schema derivation doesn't recognize the `Float` scalar type. Fields typed as `Float` are silently omitted from validators. E.g., `Price` validator has `required: ["currency"]` but no `amount`. `InvoiceLineItem` drops `unitPrice` and `lineTotal`. | Validators are weaker than intended — Float fields are not validated | Open |
| FL-12 | **Embedded models via `owner` not supported end-to-end** | The contract schema and emitter accept `owner`, and the TS contract builder supports it, but PSL has no `@@owner` attribute and the ORM has no embedded entity CRUD handling. Can't demonstrate embedded entities (as distinct from value objects) in PSL-authored apps. | N/A — feature not usable from PSL | Open |

---

## Missing capabilities

| ID | Issue | Impact | Status |
|---|---|---|---|
| FL-13 | **TypeScript DSL contract authoring not available for Mongo** | The spec requires authoring contracts in both PSL and TS DSL. Only PSL is available for Mongo contracts. Can't validate that both surfaces produce equivalent output. | Open |
| FL-14 | **Change stream support not available** | Can't demonstrate real-time order status updates or event processing via change streams. The spec lists this as a requirement (with the caveat that it requires a replica set). | Open |
| FL-15 | **Atlas Search (`$search`) requires extension pack not yet built** | Product search uses `$regex` as a fallback. Atlas Search would provide relevance-scored full-text search but requires an extension pack. | Open |

---

## Addressed by this branch

These were previously open limitations that have been resolved in the current branch.

| ID | Issue | Resolution |
|---|---|---|
| ~~FL-A1~~ | **`@@index`/`@@textIndex`/`@unique` not supported in Mongo PSL** | Now supported — the retail store schema uses text indexes with weights, compound, hashed, TTL, sparse, and collation-aware indexes. All flow through to migration operations. |
| ~~FL-A2~~ | **Polymorphism not demonstrated** | Now demonstrated — `Event` model with `@@discriminator(type)` and 3 variants (`ViewProductEvent`, `SearchEvent`, `AddToCartEvent`). Tests cover variant creation, base queries, discriminator filtering. |
| ~~FL-A3~~ | **Migration planner only handles index create/drop** | Now generates collection creation operations with `$jsonSchema` validators and index creation with full options (unique, sparse, TTL, collation, weights, hashed). Partially addressed — variant collection handling is incorrect (FL-09). |
| ~~FL-A4~~ | **ORM mutations didn't encode values through codec registry** | Fixed — ORM now attaches `codecId` from contract fields to `MongoParamRef`; adapter encodes via codec registry. ObjectId fields are properly encoded to BSON ObjectIds. |
| ~~FL-A5~~ | **Nullable value object fields produced incorrect `$jsonSchema` validators** | Fixed — nullable VOs now produce `oneOf: [{ bsonType: "null" }, { bsonType: "object", ... }]`. |
| ~~FL-A6~~ | **Adapter crashed on optional `codec.encode`** | Fixed — guard added before invocation. |

---

## App-level gaps (not framework)

| ID | Issue | Note |
|---|---|---|
| AG-01 | **Polymorphic events not surfaced in UI** | The data layer and tests fully exercise polymorphism, but no user-facing page displays or creates typed events. Could add an analytics/event log page. |
| AG-02 | **Fabricated image URLs** | Product images use `/images/products/...` paths that don't exist. Products render with broken images. |
| AG-03 | **README domain model diagram out of date** | Says `Events ─── EventMetadata (embedded)` but schema now uses polymorphic variants. `EventMetadata` type no longer exists. |
