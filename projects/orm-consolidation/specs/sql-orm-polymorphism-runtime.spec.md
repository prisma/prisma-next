# Summary

SQL ORM runtime support for polymorphic queries and writes — STI and MTI query compilation, discriminator-aware result mapping, variant-aware writes, and the refactoring needed to make the mapping layer model-first instead of table-first. This is the follow-up to TML-2205, which delivered contract authoring, type-level polymorphism, Mongo runtime, and the `.variant()` API stub.

# Description

TML-2205 established the polymorphism foundation:

- PSL `@@discriminator` / `@@base` authoring in both families
- Discriminated union types (`InferRootRow` / `VariantRow`) in both ORMs
- `.variant()` API with type narrowing and discriminator WHERE filter injection on the SQL Collection
- `variantName` tracked in `CollectionState`
- Mongo ORM functionally complete

The SQL `.variant()` currently only injects a WHERE clause. It does not change projection, result mapping, or writes. There is no STI column merging in projections, no MTI JOINs, no discriminator-aware row mapping, and no variant-aware `create()`.

Additionally, the current row mapping architecture is table-first: `dispatchCollectionRows` passes a `tableName` to `mapStorageRowToModelFields`, which reverse-looks up the model via `findModelNameForTable`. This 1:1 table→model assumption breaks with STI (multiple models share a table). The mapping layer needs to become model-first — the `Collection` already knows its `modelName`; that should flow through to mapping directly.

## Grounding example

Given the canonical ADR 173 schema — `Task` base with `Bug` (STI, same table) and `Feature` (MTI, different table):

```prisma
model Task {
  id         Int    @id @default(autoincrement())
  title      String
  type       String
  assigneeId Int?
  @@discriminator(type)
}

model Bug {
  severity String
  @@base(Task, "bug")
}

model Feature {
  priority Int
  @@base(Task, "feature")
  @@map("features")
}
```

After this work, the SQL ORM supports:

```typescript
// Query base — returns discriminated union, LEFT JOINs MTI tables
const tasks = await db.tasks.all();
// SQL: SELECT tasks.*, features.priority FROM tasks LEFT JOIN features ON tasks.id = features.id

// Query STI variant — single-table with discriminator filter
const bugs = await db.tasks.variant('Bug').all();
// SQL: SELECT * FROM tasks WHERE type = 'bug'

// Query MTI variant — INNER JOIN with discriminator filter
const features = await db.tasks.variant('Feature').all();
// SQL: SELECT tasks.*, features.priority FROM tasks JOIN features ON tasks.id = features.id WHERE tasks.type = 'feature'

// Write through variant — discriminator auto-injected
await db.tasks.variant('Bug').create({ title: 'Crash', severity: 'critical' });
// SQL: INSERT INTO tasks (title, type, severity) VALUES ('Crash', 'bug', 'critical')

await db.tasks.variant('Feature').create({ title: 'Dark mode', priority: 1 });
// SQL: INSERT INTO tasks (title, type) VALUES ('Dark mode', 'feature') RETURNING id
//      INSERT INTO features (id, priority) VALUES ($1, 1)
```

# Requirements

## Functional Requirements

### FR-1: Polymorphism strategy resolution

The ORM derives STI vs MTI per variant from storage mappings (not labels). A `PolymorphismInfo` structure is computed once per base model on first access and cached per contract:

- Compare each variant's `storage.table` to the base model's `storage.table`
- Same table → STI; different table → MTI
- Mixed STI + MTI on the same base is supported (each variant is independently categorized)
- Includes the discriminator field name, its storage column, and a map of variant name → discriminator value + storage table

### FR-2: STI query compilation

- **Projection**: SELECT all columns from the shared table. Variant-specific columns for non-matching variants will be NULL in the result set; the mapping phase strips them.
- **Filtering**: `.variant('Bug')` adds `WHERE type = 'bug'` (already implemented by TML-2205; no change needed).
- **Base query**: No additional JOINs needed for STI variants — all columns are on the base table.

### FR-3: MTI query compilation

- **Base query**: LEFT JOIN each MTI variant table on the shared primary key. Project all base table columns plus each MTI variant's non-PK columns.
- **Variant query**: INNER JOIN the variant table on the shared primary key. Project base columns + variant non-PK columns. WHERE on discriminator value.
- **No column aliasing needed**: MTI variant tables contain only the shared PK + variant-specific columns. Since we only project variant non-PK columns from the JOINed table, there's no column name overlap with the base table.

### FR-4: Result mapping (model-first)

Refactor the dispatch/mapping path to be model-first:

- Thread `modelName` through the query plan metadata (or alongside the plan) instead of reverse-looking up via `findModelNameForTable`
- For polymorphic base queries (no `.variant()`): inspect each row's discriminator column value → look up variant in `PolymorphismInfo.variantsByValue` → merge base + variant column→field maps → produce the domain-level row object. Strip columns that don't belong to the resolved variant (they'll be NULL for STI, absent for MTI).
- For variant queries (`.variant('Bug')` was called): the variant model is known at compile time. Use the merged base + variant column→field map directly.

### FR-5: STI write compilation

- `create()` through a variant collection produces a single INSERT into the shared table
- Auto-inject the discriminator column with the variant's discriminator value
- Input includes base fields + variant fields; discriminator is excluded from user-facing input (auto-injected)

### FR-6: MTI write compilation

- `create()` through an MTI variant produces two sequential INSERTs:
  1. INSERT into base table (base fields + discriminator value) → RETURNING shared PK
  2. INSERT into variant table (variant fields + shared PK from step 1)
- Transactions are not required initially — if the base INSERT succeeds but the variant INSERT fails, the orphan base row is a correctable state. Transaction wrapping can be added as a hardening step later.
- For autoincrement PKs, the base INSERT must use RETURNING to get the generated PK for the variant INSERT.

### FR-7: Writes require `.variant()` on polymorphic models

- `create()` on a polymorphic base collection (without `.variant()`) is a type error
- This is enforced via the type system: `CreateInput` for a polymorphic base model resolves to `never` (or the `create` method is omitted from the type)
- For reads, querying the base without `.variant()` remains valid and returns the discriminated union

## Non-Functional Requirements

- **No breaking changes**: All existing non-polymorphic queries, types, and tests continue to work unchanged. `InferRootRow` falls through to `DefaultModelRow` for non-polymorphic models (already the case).
- **Immutable chaining preserved**: All new paths return new Collection instances.
- **Cached strategy resolution**: `PolymorphismInfo` is computed once per (contract, modelName) and cached.

## Non-goals

- **Transaction wrapping for MTI writes**: Deferred. Sequential INSERTs are sufficient for the initial implementation.
- **SQL TS authoring DSL polymorphism**: Tracked separately in TML-2228.
- **Mongo ORM changes**: Already delivered in TML-2205.
- **PSL authoring changes**: Already delivered in TML-2205.
- **Demo app updates**: Can be done incrementally after runtime support lands.
- **Discriminator-aware `.where()` type narrowing**: Filtering on the discriminator field with a literal value doesn't automatically narrow the return type. Future enhancement.
- **Multi-level polymorphism**: Variants with their own sub-variants. Not designed yet.

# Acceptance Criteria

### Strategy resolution

- [ ] `PolymorphismInfo` correctly classifies Bug as STI (same table as Task) and Feature as MTI (different table)
- [ ] `PolymorphismInfo` is cached per (contract, modelName) — second access returns cached value
- [ ] Non-polymorphic models produce no `PolymorphismInfo` (or a `{ kind: 'none' }` equivalent)

### STI reads

- [ ] Querying the base includes all STI variant columns in the SELECT projection
- [ ] `.variant('Bug').all()` adds WHERE on discriminator column
- [ ] Result mapping inspects discriminator value to determine variant shape
- [ ] Variant-specific columns for non-matching variants are stripped from the result
- [ ] Each row in a base query result matches its variant's field shape (base fields + correct variant fields + literal discriminator)

### MTI reads

- [ ] Base query LEFT JOINs each MTI variant table on shared PK
- [ ] Base query projects MTI variant non-PK columns from the JOINed table
- [ ] `.variant('Feature').all()` uses INNER JOIN instead of LEFT JOIN
- [ ] MTI variant rows include base fields + variant fields with correct values from both tables

### Result mapping refactor

- [ ] `modelName` flows through the dispatch/mapping path without `findModelNameForTable` reverse lookup
- [ ] Polymorphic row mapping merges base + variant column→field maps based on discriminator value

### STI writes

- [ ] `.variant('Bug').create({ title, severity })` produces INSERT with discriminator value auto-injected
- [ ] User input does not include the discriminator field (auto-injected by the ORM)
- [ ] The INSERT targets the shared table with base + variant columns

### MTI writes

- [ ] `.variant('Feature').create({ title, priority })` produces two INSERTs: base table then variant table
- [ ] Base INSERT uses RETURNING to obtain the shared PK for the variant INSERT
- [ ] Variant INSERT uses the returned PK

### Type safety

- [ ] `create()` on a polymorphic base collection (no `.variant()`) is a type error
- [ ] `.variant()` narrows `CreateInput` to base + variant fields, excluding discriminator
- [ ] All existing non-polymorphic tests pass unchanged

### Integration

- [ ] Integration tests against Postgres with STI schema: seed, query base, query variant, create through variant, round-trip verification
- [ ] Integration tests against Postgres with MTI schema: seed, query base (LEFT JOIN), query variant (INNER JOIN), create through variant (two INSERTs), round-trip verification
- [ ] Integration tests against Postgres with mixed STI + MTI schema

# Other Considerations

## Risk

- **`findModelNameForTable` callers**: The refactor to model-first mapping requires auditing all callers of `findModelNameForTable` in the dispatch and mapping paths. Some callers in the include/stitch logic also use table→model reverse lookup.
- **MTI LEFT JOIN count**: A base model with many MTI variants produces a query with many LEFT JOINs. Acceptable for typical schemas (2-5 variants) but could become a concern at scale.
- **Autoincrement PK for MTI writes**: The base INSERT must RETURNING the PK. The `returning` capability is already gated in the ORM. Targets without RETURNING (rare for Postgres) would not support MTI writes.

## Coordination

- **Alexey (SQL ORM owner)**: Changes touch `query-plan-select.ts`, `collection-dispatch.ts`, `collection-runtime.ts`, `collection-contract.ts`, `collection.ts`, and `types.ts`. Coordinate timing to avoid conflicts.

# References

- [ADR 173 — Polymorphism via discriminator and variants](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [Parent spec (TML-2205)](polymorphism.spec.md) — full polymorphism spec covering all families
- [Parent plan (TML-2205)](../plans/phase-1.75b-polymorphism-plan.md) — milestones M3 + M4 are this ticket's scope
- **Linear:** [TML-2227](https://linear.app/prisma-company/issue/TML-2227)

# Open Questions

None — design decisions resolved in discussion. Implementation details (exact AST node construction for JOINs, query plan meta field naming) are execution-time decisions.
