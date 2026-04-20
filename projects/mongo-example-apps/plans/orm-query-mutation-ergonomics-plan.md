# ORM Query & Mutation Ergonomics Plan

## Summary

Implement codec-aware `where()` filtering, ADR 180 field accessor mutations, and 1:N back-relation test coverage in the Mongo ORM. Success means the retail store example app compiles without `mongoRaw` workarounds or manual `MongoParamRef`/`MongoFieldFilter` construction for common operations.

**Spec:** [specs/orm-query-mutation-ergonomics.spec.md](../specs/orm-query-mutation-ergonomics.spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |

## Milestones

### Milestone 1: 1:N back-relation loading (FL-08)

Verify that `include()` works for 1:N reference relations and add test coverage. Lowest risk — validates existing implementation.

**Tasks:**

- [ ] Add a 1:N reference relation to the ORM test fixture (e.g., `User.tasks` → `Task` via `assigneeId`)
- [ ] Add unit tests: `include()` on 1:N reference relation produces `$lookup` without `$unwind`
- [ ] Add unit tests: return type for 1:N included relation is an array (type-level test)
- [ ] Verify with retail store contract: `User.carts`, `User.orders`, `Order.invoices` all work with `include()`

### Milestone 2: Codec-aware `where()` (FL-06)

Add a plain-object `where()` overload that encodes filter values through codecs automatically. Establishes the codec-encoding pattern that FL-04 also uses.

**Tasks:**

- [ ] Write unit tests for object-based `where()`: ObjectId field, string field, multi-field AND, chaining with `MongoFilterExpr`
- [ ] Write type-level tests: invalid field names error, wrong value types error
- [ ] Add `where()` overload accepting `MongoWhereFilter<TContract, ModelName>` to the `MongoCollection` interface
- [ ] Implement object-to-filter compilation in `MongoCollectionImpl`: iterate fields, look up `codecId` from contract, wrap with `#wrapFieldValue`, build `MongoFieldFilter.eq`, AND if multiple
- [ ] Verify all tests pass

### Milestone 3: ADR 180 field accessor for mutations (FL-04)

Implement the Proxy-based field accessor with property access for top-level fields and callable dot-path for nested value object traversal. Capability-gated mutation operators.

**Tasks:**

- [ ] Define the `FieldOperation` type: `{ operator, field, value }` representing a single update operation
- [ ] Define the `FieldExpression` interface with mutation operators: `set()`, `unset()`, `inc()`, `mul()`, `push()`, `pull()`, `addToSet()`, `pop()`
- [ ] Define recursive template literal types for dot-path validation: `DotPath<TContract, ModelName>` and `ResolveDotPathType<TContract, ModelName, Path>`
- [ ] Define the `FieldAccessor` type: top-level fields as properties returning `FieldExpression`, callable with dot-path string for nested value object fields
- [ ] Write unit tests for field operation compilation: individual operators (`$set`, `$push`, `$pull`, `$inc`, `$unset`, `$addToSet`, `$pop`, `$mul`) produce correct update documents
- [ ] Write unit tests for multi-operation merging: multiple operations in one callback are grouped by operator key
- [ ] Write unit tests for codec encoding in field operations: values carry correct `codecId`
- [ ] Write unit tests for dot-path operations: `u("address.city").set("NYC")` produces `{ $set: { "address.city": ... } }`
- [ ] Write type-level tests: invalid dot-paths error, operator/value type mismatch errors
- [ ] Implement `createFieldAccessor()`: Proxy-based factory that returns the accessor
- [ ] Implement field operation → update document compilation: group `FieldOperation[]` by operator, merge into `{ $set: {...}, $push: {...}, ... }`, encode values through `#wrapFieldValue`
- [ ] Add `update()` callback overload to `MongoCollection` interface and `MongoCollectionImpl`
- [ ] Extend `updateAll()`, `updateCount()` to accept the callback form
- [ ] Extend `upsert()` to accept the callback form for the `update` part
- [ ] Add value objects to the ORM test fixture contract to support dot-path tests
- [ ] Verify all tests pass

### Milestone 4: Retail store cleanup

Replace workarounds in the retail store with the new ORM features. This is the end-to-end proof.

**Tasks:**

- [ ] Replace `objectIdEq()` / `rawObjectIdFilter()` calls with object-based `where()` in all data access functions
- [ ] Delete `src/data/object-id-filter.ts`
- [ ] Replace `mongoRaw` in `addToCart()` with `update(u => [u.items.push(item)])`
- [ ] Replace `mongoRaw` in `removeFromCart()` with `update(u => [u.items.pull({ productId })])`
- [ ] Replace `mongoRaw` in `updateOrderStatus()` with `update(u => [u.statusHistory.push(entry)])`
- [ ] Remove `execute-raw.ts` imports/functions that are no longer needed
- [ ] Verify retail store compiles and tests pass

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `where({ userId })` with ObjectId codec produces correct filter | Unit | M2 | |
| `where({ name })` with string codec produces correct filter | Unit | M2 | |
| Multi-field `where()` produces AND | Unit | M2 | |
| Object `where()` chainable with `MongoFilterExpr` `where()` | Unit | M2 | |
| Type error for invalid field names in where object | Type test | M2 | `@ts-expect-error` |
| Type error for wrong value types in where object | Type test | M2 | `@ts-expect-error` |
| `u.items.push(item)` → `{ $push: { "items": ... } }` | Unit | M3 | |
| `u.count.inc(1)` → `{ $inc: { "count": 1 } }` | Unit | M3 | |
| `u.name.set("Alice")` → `{ $set: { "name": ... } }` | Unit | M3 | |
| `u.name.unset()` → `{ $unset: { "name": "" } }` | Unit | M3 | |
| `u("address.city").set("NYC")` → `{ $set: { "address.city": ... } }` | Unit | M3 | |
| Multiple operations merged by operator key | Unit | M3 | |
| Values in operations encoded through codecs | Unit | M3 | |
| Callback works with `updateAll()`, `updateCount()`, `upsert()` | Unit | M3 | |
| Type error for invalid dot-path | Type test | M3 | `@ts-expect-error` |
| Type error for operator/value mismatch | Type test | M3 | `@ts-expect-error` |
| `include()` on 1:N reference relation: `$lookup` without `$unwind` | Unit | M1 | |
| 1:N included relation return type is array | Type test | M1 | |
| Retail store `mongoRaw` calls replaced | Integration | M4 | Existing retail store tests pass |
| `objectIdEq()` helpers removed | Integration | M4 | File deleted, no import errors |

## Open Items

- The ORM test fixture needs value objects added (M3) and a 1:N reference back-relation added (M1). Both are test fixture changes, not contract schema changes.
- `execute-raw.ts` may still be needed for pipeline/raw queries outside the scope of this ticket. Only remove functions that are no longer referenced after the cleanup.
