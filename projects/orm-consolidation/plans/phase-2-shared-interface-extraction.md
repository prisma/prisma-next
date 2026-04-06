# Phase 2: Shared Interface Extraction — Execution Plan

## Summary

Extract the shared `Collection` base class, `CollectionState`, `InferModelRow`, and include interface from the two concrete implementations (SQL and Mongo) into the framework layer. Both SQL and Mongo Collections extend the shared base. The abstraction is discovered from the overlap, not predicted.

**Spec:** [projects/orm-consolidation/spec.md](../spec.md)

**Linear:** [TML-2213](https://linear.app/prisma-company/issue/TML-2213)

**Prerequisite:** [Phase 1](phase-1-mongo-collection-spike.md) complete — Mongo Collection is working independently.

## Collaborators

| Role         | Person | Context                                              |
| ------------ | ------ | ---------------------------------------------------- |
| Maker        | Will   | Drives execution                                     |
| Collaborator | Alexey | SQL ORM owner — extraction changes SQL Collection    |

## Key references

- SQL `Collection`: `packages/3-extensions/sql-orm-client/src/collection.ts`
- Mongo `MongoCollection`: `packages/2-mongo-family/4-orm/src/` (after Phase 1)
- ADR 175 shared/family-specific table: [ADR 175 § What's shared vs family-specific](../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

## Milestones

### Milestone 1: Extract `CollectionState` and chaining base

Extract the family-agnostic state bag and the immutable chaining machinery into the framework layer.

**Tasks:**

- **1.1** Define `CollectionState` in the framework — the abstract state bag shared by both families. This contains: filter expressions (generic type parameter), include descriptors (generic type parameter), orderBy specs, selectedFields, limit, offset. The type is parameterized over the family-specific expression types: `CollectionState<TFilterExpr, TIncludeExpr>`.
- **1.2** Extract `Collection<TContract, ModelName>` abstract base class to the framework layer. The base owns:
  - Constructor (contract, modelName, state).
  - Immutable clone pattern (`#clone`, `#createSelf` using `this.constructor`).
  - Chaining methods (`.where()`, `.select()`, `.include()`, `.orderBy()`, `.take()`, `.skip()`).
  - Terminal methods (`.all()`, `.first()`) that delegate to an abstract `compile(state)` method.
  - The `where` method accepts a callback with a family-specific accessor type (abstract `createModelAccessor()` method).
- **1.3** Update SQL `Collection` to extend the shared base. Override `compile()` to produce `SqlQueryPlan`. Override `createModelAccessor()` to produce SQL `ModelAccessor`.
- **1.4** Update Mongo `MongoCollection` to extend the shared base. Override `compile()` to produce `MongoReadPlan`. Override `createModelAccessor()` to produce `MongoModelAccessor`.
- **1.5** Verify all existing SQL ORM tests pass.
- **1.6** Verify all existing Mongo ORM tests pass.

### Milestone 2: Extract `InferModelRow` utility type

Both families have their own `InferModelRow` type. Extract a shared version to the framework.

**Tasks:**

- **2.1** Compare SQL and Mongo `InferModelRow` implementations. Identify structural overlap (both use `model.fields[f].codecId` → `CodecTypes[codecId]['output']` with nullable handling).
- **2.2** Define shared `InferModelRow<TContract, ModelName>` in the framework contract package. Parameterized over the contract type so both family contracts work.
- **2.3** Migrate SQL ORM to use the shared `InferModelRow`. Verify type inference is equivalent.
- **2.4** Migrate Mongo ORM to use the shared `InferModelRow`. Verify type inference is equivalent.
- **2.5** Write type tests confirming both families infer identical row types for equivalent contract definitions.

### Milestone 3: Extract shared include interface

The include interface has shared semantics (cardinality-aware coercion, refinement callbacks) with family-specific resolution mechanics.

**Tasks:**

- **3.1** Define shared include types in the framework: `IncludeDescriptor` (relation name, cardinality, optional refinement state), `IncludeResult` (cardinality-aware: to-one → `T | null`, to-many → `T[]`).
- **3.2** Implement shared `.include()` method on the base `Collection` class. The method builds a family-agnostic include descriptor and passes it to the family-specific compilation.
- **3.3** Implement include refinement on the shared interface: `include('relation', (collection) => collection.select(...).where(...))`. The refinement callback receives a nested Collection for the related model.
- **3.4** Update SQL include resolution to consume the shared include descriptor.
- **3.5** Update Mongo include resolution to consume the shared include descriptor.
- **3.6** Verify include behavior (single-level and, for SQL, nested) works for both families.

### Milestone 4: Verify custom collection subclasses

Ensure the custom collection subclass pattern works identically across both families.

**Tasks:**

- **4.1** Write a shared test that defines `class UserCollection extends Collection<C, 'User'>` with domain methods (`.admins()`, `.byEmail(email)`).
- **4.2** Verify the subclass works with SQL — chaining returns `UserCollection` instances, domain methods compose with built-in methods.
- **4.3** Verify the subclass works with Mongo — identical behavior.
- **4.4** Verify that `orm()` / `mongoOrm()` accept custom collection registries and return the custom types.

### Milestone 5: Client shape extraction

Extract the ORM client factory pattern (roots → Collection instances) into the framework.

**Tasks:**

- **5.1** Define shared `OrmClient<TContract>` type in the framework — maps root names to Collection instances.
- **5.2** Extract shared factory logic: iterate `contract.roots`, instantiate Collection per root, apply collection registry for custom subclasses.
- **5.3** Update SQL `orm()` to use the shared factory.
- **5.4** Update Mongo `mongoOrm()` to use the shared factory.
- **5.5** Verify both factories produce the correct client types and behavior.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone |
| --- | --- | --- |
| Shared `Collection` base in framework | Unit + Type | 1.2 |
| SQL Collection extends shared base, all tests pass | Regression | 1.5 |
| Mongo Collection extends shared base, all tests pass | Regression | 1.6 |
| Shared `InferModelRow` works for both families | Type test | 2.5 |
| Include cardinality coercion (to-one → `T \| null`, to-many → `T[]`) | Unit + Type | 3.6 |
| Include refinement callbacks work | Unit | 3.3 |
| Custom collection subclasses work for SQL | Unit | 4.2 |
| Custom collection subclasses work for Mongo | Unit | 4.3 |
| Shared ORM client factory | Unit | 5.5 |

## Open Items

1. **Where DSL generalization.** The base `Collection.where()` needs to accept a callback that receives a family-specific accessor. The accessor type is different per family (SQL produces `AnyWhereExpr`, Mongo produces `MongoFilterExpr`). Design options: (a) generic type parameter on Collection for the accessor, (b) abstract `createModelAccessor()` method, (c) intersection type with common operators. Recommendation: (b) abstract method — cleanest separation.

2. **Coordination timing with Alexey.** Phase 2 changes the SQL Collection's inheritance hierarchy. This should be sequenced when Alexey has a natural pause point. The extraction should be mechanical (no behavior change to SQL ORM), but merge conflicts are likely if timed poorly.

3. **Package placement.** Where does the shared `Collection` base class live? Options: (a) `packages/1-framework/4-lanes/orm/` (new package), (b) within `packages/1-framework/1-core/`. Recommendation: (a) new package at the lanes layer — the ORM is a lane, and the base class is the framework's contribution to that lane.

4. **Mutation interface.** Mutations are implemented on the Mongo Collection (Phase 1.5). The shared base will need abstract mutation compilation methods. Both SQL and Mongo now have `create`, `update`, `delete`, `upsert` surfaces to extract from.

5. **`CollectionState` filter type parameter.** SQL filters are `AnyWhereExpr[]`, Mongo filters are `MongoFilterExpr[]`. The shared `CollectionState` needs a type parameter for the filter expression type, or the filters must be stored as an opaque type. The type parameter approach is cleaner but adds a generic to every `Collection` signature.
