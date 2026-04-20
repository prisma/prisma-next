# Summary

Close the ergonomics gap in the Mongo ORM by making `where()` codec-aware, implementing the ADR 180 field accessor for typed mutation operators, and verifying 1:N back-relation loading. This eliminates the need for `mongoRaw` workarounds and manual `MongoParamRef` construction in the retail store example app.

# Description

The retail store example app exposed three framework limitations (FL-04, FL-06, FL-08) in the Mongo ORM that force users into low-level workarounds:

- **FL-06**: The ORM encodes values through codecs on writes (create/update) but not on reads (where). Users must manually construct `MongoParamRef` with the correct `codecId` for every filter. Most visible with ObjectId fields (string → BSON ObjectId), but affects any codec with a non-identity `encode`.
- **FL-04**: The ORM `update()` only supports `$set` semantics. Array mutations (`$push`, `$pull`) and numeric updates (`$inc`) require dropping to `mongoRaw` with untyped commands. ADR 180 specifies the field accessor pattern for these operations.
- **FL-08**: 1:N back-relation loading via `include()` (e.g., User → carts, User → orders) has not been tested. The implementation appears correct but lacks test coverage.

**Linear**: [TML-2246](https://linear.app/prisma-company/issue/TML-2246)

# Requirements

## Functional Requirements

### FL-06: Codec-aware `where()` overload

1. `where()` accepts a plain object `{ fieldName: value }` in addition to the existing `MongoFilterExpr`.
2. Each field-value pair is resolved to `$eq` semantics.
3. Values are encoded through codecs using the same `#wrapFieldValue` logic that mutations use — the field's `codecId` is looked up from the contract and attached to the `MongoParamRef`.
4. Multiple fields in a single object are AND'd together.
5. The plain-object `where()` is chainable with other `where()` calls (both object and `MongoFilterExpr` forms).
6. The type of the object maps each field to its codec input type (from the contract type maps).

### FL-04: ADR 180 field accessor for mutations

7. `update()` accepts a callback `(u) => FieldOperation[]` in addition to the existing plain-object (`$set`) form.
8. Top-level scalar fields are accessible as properties on the accessor proxy: `u.fieldName` returns an expression with mutation operators.
9. Nested value object fields are accessible via callable dot-path: `u("address.city")` returns an expression with mutation operators.
10. Dot-path strings are type-checked at compile time using recursive template literal types. Invalid paths produce type errors.
11. The expression returned by the accessor provides capability-gated mutation operators:
    - All targets: `.set(value)`, `.unset()`
    - Mongo: `.inc(value)`, `.mul(value)`, `.push(value)`, `.pull(match)`, `.addToSet(value)`, `.pop(end)`
12. Each operator produces a `FieldOperation` that is collected and compiled into a MongoDB update document (e.g., `{ $push: { "items": ... }, $inc: { "count": 1 } }`).
13. Values in field operations are encoded through codecs using `#wrapFieldValue`.
14. The callback form works with `update()`, `updateAll()`, `updateCount()`, and the `update` part of `upsert()`.

### FL-08: 1:N back-relation loading

15. `include()` works correctly for 1:N reference relations (e.g., User → carts, Order → invoices).
16. The `$lookup` stage is generated without `$unwind` for 1:N cardinality.
17. The return type for 1:N included relations is an array.

## Non-Functional Requirements

18. No new runtime dependencies.
19. Type-level dot-path resolution must not cause noticeable IDE slowdown for schemas with ≤ 3 levels of value object nesting.

## Non-goals

- **Query-side dot-path accessor** (`u("address.city").eq("NYC")` for filter expressions): ADR 180 describes this but it's a separate concern from mutations. The object-based `where()` overload covers the immediate need.
- **Extended comparison operators in object-based `where()`** (e.g., `{ price: { $gte: 10 } }`): `$eq`-only is consistent with the SQL family. Complex filters use the existing `MongoFilterExpr` chain.
- **`$vectorSearch` pipeline stage** (FL-07): Requires Atlas extension pack — separate project.
- **Change streams** (FL-14): Requires streaming subscription support.

# Acceptance Criteria

## FL-06: Codec-aware `where()`

- [ ] `where({ userId: "abc123" })` on a model with `userId: mongo/objectId@1` produces a filter with `MongoParamRef` carrying `codecId: 'mongo/objectId@1'`
- [ ] `where({ name: "Alice" })` on a string field produces a filter with `MongoParamRef` carrying `codecId: 'mongo/string@1'`
- [ ] `where({ userId: "abc", name: "Alice" })` produces an AND of two equality filters
- [ ] Object-based `where()` is chainable with `MongoFilterExpr`-based `where()`
- [ ] Type errors for invalid field names in the where object
- [ ] Type errors for wrong value types (e.g., number for a string field)

## FL-04: Field accessor mutations

- [ ] `update(u => [u.items.push(newItem)])` produces `{ $push: { "items": <encoded value> } }`
- [ ] `update(u => [u.count.inc(1)])` produces `{ $inc: { "count": 1 } }`
- [ ] `update(u => [u.name.set("Alice")])` produces `{ $set: { "name": <encoded value> } }`
- [ ] `update(u => [u.name.unset()])` produces `{ $unset: { "name": "" } }`
- [ ] `update(u => [u("address.city").set("NYC")])` produces `{ $set: { "address.city": <encoded value> } }`
- [ ] Multiple operations in a single callback are merged into the update document by operator key
- [ ] Values in field operations are encoded through codecs (codecId attached to MongoParamRef)
- [ ] Callback form works with `updateAll()`, `updateCount()`, and `upsert()`
- [ ] Type error for invalid dot-paths (e.g., `u("address.nonexistent")`)
- [ ] Type error for operator/value type mismatch (e.g., `.inc()` on a string field)

## FL-08: 1:N back-relation loading

- [ ] `include()` on a 1:N reference relation produces a `$lookup` without `$unwind`
- [ ] Return type for 1:N included relation is an array

## Retail store cleanup

- [ ] Retail store `mongoRaw` calls for cart add/remove and order status update are replaced with ORM `update()` calls using the field accessor
- [ ] `objectIdEq()` and `rawObjectIdFilter()` helpers are removed — replaced with object-based `where()`
- [ ] `object-id-filter.ts` is deleted

# Other Considerations

## Security

N/A — internal query builder changes, no auth or data sensitivity impact.

## Cost

N/A — no infrastructure changes.

## Observability

N/A — no new runtime surfaces.

## Data Protection

N/A — no change to data handling.

## Analytics

N/A.

# References

- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) — authoritative design for the field accessor pattern, mutation semantics, capability-gated operators, and backend translation
- [ADR 178 — Value objects in the contract](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) — value object definitions that the dot-path accessor navigates
- [Framework limitations](../framework-limitations.md) — FL-04, FL-06, FL-08 detailed descriptions and workarounds
- [Next steps](../../../docs/planning/mongo-target/next-steps.md) — Area 2 scope and sequencing
- [ORM collection implementation](../../../packages/2-mongo-family/5-query-builders/orm/src/collection.ts) — current `where()`, `update()`, `include()` implementation
- [Retail store workarounds](../../../examples/retail-store/src/data/object-id-filter.ts) — `objectIdEq()` helper that FL-06 eliminates

# Open Questions

None — all design decisions resolved during discussion:

1. **FL-04 API shape**: ADR 180 callback pattern with Proxy-based field accessor (resolved by existing ADR).
2. **FL-06 operator scope**: `$eq`-only, consistent with SQL. Complex filters use existing `MongoFilterExpr` chain.
3. **Dot-path scope**: Full callable dot-path accessor, not just top-level fields. This ticket is the natural home; value objects are landed and nothing blocks it.
