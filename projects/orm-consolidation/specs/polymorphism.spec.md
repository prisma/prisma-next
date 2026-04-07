# Summary

End-to-end polymorphism in both SQL and Mongo ORM clients — from contract authoring (PSL and TS), through emission and validation, to ORM queries and mutations with discriminated union return types and variant-specific narrowing — following [ADR 173](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md). Both STI (single-table inheritance) and MTI (multi-table inheritance) are supported for SQL; Mongo uses single-collection polymorphism exclusively.

# Description

The contract schema already has structural slots for `discriminator`, `variants`, and `base` on models ([ADR 173](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)). Domain validation (`validateDiscriminators`, `validateVariantsAndBases`) enforces bidirectional consistency. The emitter passes these properties through to both `contract.json` (canonicalization) and `contract.d.ts` (literal metadata on model types). The Mongo ORM already has type-level polymorphism: `InferRootRow`/`VariantRow` produces discriminated union types, and type tests verify that narrowing on the discriminator field correctly excludes variant-specific fields.

What's missing:

1. **Contract authoring.** Neither the SQL nor Mongo PSL interpreters handle polymorphism. The TS authoring APIs have no polymorphism surface. The only polymorphic contracts are hand-crafted JSON fixtures.

2. **SQL ORM types.** The SQL `DefaultModelRow` maps `model.fields` directly to JS types — no discriminated union for polymorphic roots. No `InferRootRow`/`VariantRow` equivalent.

3. **SQL ORM runtime.** No discriminator filtering, no cross-table JOINs for MTI variants, no variant-aware result mapping.

4. **Variant narrowing API.** Neither ORM has a `.variant('Bug')` method to get a variant-typed collection with auto-injected discriminator filter.

5. **Integration tests.** No tests exercise the full authoring → emit → query path with emitter-produced polymorphic contracts.

## Grounding example

A user writes this PSL schema — a polymorphic `Task` with `Bug` and `Feature` variants:

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

Key points:
- `@@discriminator(type)` on the base model names the discriminator field.
- `@@base(Task, "bug")` on a variant names the base model and the discriminator value for this variant.
- `@@variants` is not needed on the base — the interpreter derives variants from `@@base` declarations and validates bidirectional consistency.
- Variant models list only their additional fields. Base fields (id, title, type, assigneeId) are inherited through the `base` reference.
- `Bug` has no `@@map`, so it shares Task's table (STI). `Feature` has `@@map("features")`, giving it a separate table (MTI). The persistence strategy is emergent from storage mappings, as ADR 173 requires.

The authoring layer emits this contract:

```json
{
  "roots": { "tasks": "Task" },
  "models": {
    "Task": {
      "fields": {
        "id": { "nullable": false, "type": { "kind": "scalar", "codecId": "pg/int4@1" } },
        "title": { "nullable": false, "type": { "kind": "scalar", "codecId": "pg/text@1" } },
        "type": { "nullable": false, "type": { "kind": "scalar", "codecId": "pg/text@1" } },
        "assigneeId": { "nullable": true, "type": { "kind": "scalar", "codecId": "pg/int4@1" } }
      },
      "discriminator": { "field": "type" },
      "variants": {
        "Bug": { "value": "bug" },
        "Feature": { "value": "feature" }
      },
      "relations": {},
      "storage": {
        "table": "tasks",
        "fields": {
          "id": { "column": "id" },
          "title": { "column": "title" },
          "type": { "column": "type" },
          "assigneeId": { "column": "assignee_id" }
        }
      }
    },
    "Bug": {
      "base": "Task",
      "fields": {
        "severity": { "nullable": false, "type": { "kind": "scalar", "codecId": "pg/text@1" } }
      },
      "relations": {},
      "storage": {
        "table": "tasks",
        "fields": { "severity": { "column": "severity" } }
      }
    },
    "Feature": {
      "base": "Task",
      "fields": {
        "priority": { "nullable": false, "type": { "kind": "scalar", "codecId": "pg/int4@1" } }
      },
      "relations": {},
      "storage": {
        "table": "features",
        "fields": { "priority": { "column": "priority" } }
      }
    }
  }
}
```

The ORM then provides:

```typescript
// Query base — returns discriminated union
const tasks = await db.tasks.all();
// tasks: ({ id: number; title: string; type: 'bug'; assigneeId: number | null; severity: string }
//       | { id: number; title: string; type: 'feature'; assigneeId: number | null; priority: number })[]

// Narrow in TypeScript
for (const task of tasks) {
  if (task.type === 'bug') {
    console.log(task.severity);  // narrowed to Bug
  }
}

// Query specific variant — narrowed type + auto-injected discriminator filter
const bugs = await db.tasks.variant('Bug').all();
// bugs: { id: number; title: string; type: 'bug'; assigneeId: number | null; severity: string }[]

// Writes through variant — discriminator value included in input type
await db.tasks.variant('Bug').create({ title: 'Crash', severity: 'critical', assigneeId: null });
// For STI: INSERT INTO tasks (title, type, severity, assignee_id) VALUES ('Crash', 'bug', 'critical', NULL)

// Writes through base — discriminator value required in input
await db.tasks.create({ title: 'Something', type: 'bug', severity: 'critical', assigneeId: null });
```

## Variant collections and roots

Variants are **not** aggregate roots ([ADR 174](../../../docs/architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)). They are accessed through the base model's collection via `.variant('VariantName')`. This returns a narrowed collection with:

1. **Auto-injected discriminator filter.** For reads, a `WHERE type = 'bug'` (SQL) or `{$match: {type: 'bug'}}` (Mongo) is prepended to the query. For writes, the discriminator value is auto-injected into the insert document.
2. **Narrowed return type.** The collection's result type is the variant's full row type (base fields + variant fields, with the discriminator field typed as a literal), not the base's discriminated union.
3. **Narrowed input type for writes.** `CreateInput` includes base + variant fields. The discriminator field is auto-injected and not part of the user-facing input type.

## SQL persistence strategies (STI and MTI)

The persistence strategy is emergent from storage mappings — the ORM derives the query strategy, the contract doesn't label it ([ADR 173](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)):

- **STI** (single-table inheritance): A variant's `storage.table` matches the base model's table. The ORM queries one table, filtering by discriminator value. Variant-specific columns are on the shared table.
- **MTI** (multi-table inheritance): A variant's `storage.table` differs from the base's. The ORM JOINs the base table with the variant table on the shared primary key.

### Query compilation

**Querying the base (all variants):**

```sql
-- STI variant columns are on the base table; MTI variant columns require a LEFT JOIN
SELECT tasks.id, tasks.title, tasks.type, tasks.assignee_id,
       tasks.severity,           -- STI (Bug, same table)
       features.priority          -- MTI (Feature, different table)
FROM tasks
LEFT JOIN features ON features.id = tasks.id
```

**Querying a specific STI variant (Bug):**

```sql
SELECT id, title, type, assignee_id, severity
FROM tasks
WHERE type = 'bug'
```

**Querying a specific MTI variant (Feature):**

```sql
SELECT tasks.id, tasks.title, tasks.type, tasks.assignee_id, features.priority
FROM tasks
JOIN features ON features.id = tasks.id
WHERE tasks.type = 'feature'
```

### Result mapping

The result mapper uses the discriminator value to determine which variant to assemble:
- For STI rows: all columns come from the shared table. Variant-specific columns for other variants are NULL and excluded from the result.
- For MTI rows: base columns come from the base table, variant columns from the JOINed table.

### Write compilation

**Insert through a variant collection:**
- STI: single `INSERT INTO tasks (...)` with all base + variant columns plus the discriminator value.
- MTI: two `INSERT` statements — one into the base table (base fields + discriminator), one into the variant table (variant-specific fields + shared PK). These should be wrapped in a transaction.

**Insert through the base collection:** the user provides the discriminator value and all fields for the matching variant. The ORM determines STI vs MTI from storage and compiles accordingly.

## Mongo polymorphism

Mongo polymorphism is always single-collection (analogous to SQL STI). All variants share the base's collection. The Mongo ORM already has:
- `InferRootRow`/`VariantRow` type-level discriminated unions
- Type tests verifying narrowing

What needs to be added:
- `.variant('Bug')` method on `MongoCollection` — injects `$match` filter, narrows return type
- Discriminator value auto-injection on `create()` through variant collections

## PSL syntax design

### `@@discriminator(fieldName)`

Model-level attribute on the base model. Names the discriminator field. The field must exist on the model.

```prisma
model Task {
  type String
  @@discriminator(type)
}
```

### `@@base(BaseModel, "discriminatorValue")`

Model-level attribute on variant models. Names the base model and the discriminator value for this variant.

```prisma
model Bug {
  severity String
  @@base(Task, "bug")
}
```

The interpreter:
1. Collects all `@@base` declarations to build the `variants` map on the base model.
2. Validates bidirectional consistency (every `@@base` target has a matching `@@discriminator`).
3. Resolves variant storage: if no `@@map` on the variant, it inherits the base's table/collection (STI/single-collection). If `@@map` is present, the variant has its own table (MTI — SQL only).

### Why no `@@variants` on the base

`@@variants` would be redundant — the interpreter can derive the variants map from `@@base` declarations. Redundant PSL attributes create consistency risks. The contract *does* have `variants` on the base model (for bidirectional traversal), but this is an emitter concern — the emitter writes both sides from the interpreter's resolved data.

## Discriminator value encoding

Discriminator values in `contract.json` are encoded/decoded through the discriminator field's codec via `encodeJson`/`decodeJson` ([ADR 184](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md)). The framework `Codec` base interface with these methods has landed (Phase 1.6). For common discriminator types (string, int), `encodeJson`/`decodeJson` are identity functions.

# Requirements

## Functional Requirements

### Contract authoring

1. **PSL — discriminator declaration.** `@@discriminator(fieldName)` on a model names the discriminator field. The field must exist on the model. Emits `discriminator: { field: "fieldName" }` on the model.

2. **PSL — variant declaration.** `@@base(BaseModel, "value")` on a variant model names the base model and discriminator value. The interpreter resolves the full `variants` map on the base model from all `@@base` declarations. Emits `base: "BaseModel"` on the variant and `variants: { "VariantModel": { "value": "value" } }` on the base.

3. **PSL — variant field inheritance.** Variant models list only their additional fields. The interpreter resolves the variant's full field set as base fields + variant fields. The emitter writes thin variant fields to the contract (variant-only, as ADR 173 specifies).

4. **PSL — variant storage.** If a variant has `@@map("tableName")`, it gets its own table (MTI). If no `@@map`, it inherits the base's table (STI). For Mongo, variants always inherit the base's collection.

5. **PSL — both families.** Both SQL and Mongo PSL interpreters support `@@discriminator` and `@@base`. SQL supports both STI and MTI. Mongo supports single-collection only.

6. **PSL — validation diagnostics.** The interpreter emits diagnostics for: `@@discriminator` without any matching `@@base` declarations; `@@base` targeting a model without `@@discriminator`; `@@base` targeting a non-existent model; discriminator field not found on the model; a model with both `@@discriminator` and `@@base`.

### SQL ORM

7. **Discriminated union return types.** Querying a polymorphic root via the SQL ORM returns a discriminated union type, matching the Mongo ORM's existing `InferRootRow`/`VariantRow` behavior. The discriminator field is typed with literal values from the variants map.

8. **STI query compilation.** For STI variants (same table as base), the ORM includes variant-specific columns in SELECT and uses discriminator WHERE filters. Variant-specific columns for non-matching variants are NULL and excluded from typed results.

9. **MTI query compilation.** For MTI variants (different table from base), the ORM LEFT JOINs the variant table when querying the base, and INNER JOINs when querying a specific variant. Variant columns come from the joined table.

10. **STI write compilation.** Inserts through an STI variant collection produce a single INSERT into the shared table with base + variant columns and the discriminator value.

11. **MTI write compilation.** Inserts through an MTI variant collection produce two INSERTs (base table + variant table) in a transaction. The shared primary key links the two rows.

12. **Result mapping.** The result mapper inspects the discriminator value to determine the variant, then maps columns from the appropriate storage locations (base table columns + variant table columns for MTI, all from shared table for STI).

### Mongo ORM

13. **Variant narrowing API.** `.variant('Bug')` on `MongoCollection` returns a new collection with the discriminator filter injected and the return type narrowed to the variant's row type.

14. **Variant writes.** `create()` through a variant collection auto-injects the discriminator value into the insert document. The `CreateInput` type includes base + variant fields, excluding the discriminator.

### Shared

15. **`.variant()` method.** Both SQL and Mongo collections expose `.variant(variantName)` that:
    - Injects the discriminator filter (WHERE clause for SQL, $match for Mongo)
    - Narrows the return type to the variant's full row (base + variant fields, literal discriminator)
    - Narrows `CreateInput` to include base + variant fields, excluding the discriminator
    - Chains with all existing collection methods (`.where()`, `.select()`, `.include()`, etc.)

## Non-Functional Requirements

- **Immutable chaining preserved.** `.variant()` returns a new collection instance, consistent with the existing immutable-clone pattern.
- **Type safety.** `.variant()` only accepts variant names that exist on the polymorphic model. Passing a non-variant name is a type error.
- **No backward compatibility concerns.** This is additive — no existing APIs change.

## Non-goals

- **Discriminator-aware `.where()` type narrowing.** Filtering on the discriminator field with a literal value doesn't narrow the return type. This is a future type-level enhancement.
- **Variant-level root accessors.** Variants are not in `roots`. No `db.bugs` accessor — use `db.tasks.variant('Bug')`.
- **Multi-level polymorphism.** A variant having its own sub-variants with a different discriminator is not yet designed.
- **Polymorphic value objects.** ADR 173 describes polymorphic value objects using the same mechanism. This is deferred to Phase 1.75c (value objects).
- **Concrete table inheritance.** A third SQL strategy where each variant has its own table with ALL fields (no shared base table). Not in scope.

# Acceptance Criteria

### Contract authoring

- [ ] PSL `@@discriminator(fieldName)` on a model emits `discriminator: { field }` in the contract
- [ ] PSL `@@base(BaseModel, "value")` emits `base` on the variant and `variants` on the base
- [ ] Variant PSL models list only additional fields; base fields are not repeated
- [ ] Variant without `@@map` inherits base's table/collection (STI / single-collection)
- [ ] Variant with `@@map("tableName")` gets its own table (MTI, SQL only)
- [ ] Diagnostics for: orphaned `@@discriminator`, orphaned `@@base`, missing discriminator field, `@@discriminator` + `@@base` on same model, `@@base` targeting non-existent model
- [ ] Both SQL and Mongo PSL interpreters support the syntax

### SQL ORM

- [ ] Querying a polymorphic SQL root returns a discriminated union type that narrows on the discriminator field
- [ ] STI: SELECT includes variant-specific columns from the shared table
- [ ] STI: WHERE filter on discriminator value when querying via `.variant()`
- [ ] MTI: LEFT JOIN variant tables when querying the base
- [ ] MTI: INNER JOIN variant table when querying a specific variant via `.variant()`
- [ ] MTI writes: two INSERTs (base + variant table) in a transaction
- [ ] STI writes: single INSERT with discriminator value
- [ ] Result mapper assembles correct variant shape from discriminator value

### Mongo ORM

- [ ] `.variant('Bug')` on MongoCollection injects discriminator `$match` filter
- [ ] `.variant('Bug')` narrows return type to variant's row type
- [ ] `create()` through variant collection auto-injects discriminator value
- [ ] Existing `InferRootRow`/`VariantRow` type tests continue to pass

### Shared

- [ ] `.variant()` chains with `.where()`, `.select()`, `.include()`, `.orderBy()`, `.take()`, `.skip()`
- [ ] `.variant()` only accepts valid variant names (type error for non-variants)
- [ ] Integration tests use emitter-produced contracts, not hand-crafted fixtures
- [ ] Both families tested against real databases with polymorphic contracts

### Demo apps

- [ ] SQL demo (`examples/prisma-next-demo`) adds a polymorphic model to `schema.prisma`, queries it via ORM with `.variant()`, and the response type threads through the app correctly
- [ ] Mongo demo (`examples/mongo-demo`) adds a polymorphic model to `contract.prisma`, queries it via ORM with `.variant()`, and the response type threads through the app correctly
- [ ] Both demos exercise PSL → emit → query → response type end-to-end (not hand-crafted contracts)

# Other Considerations

## Coordination

- **Alexey (SQL ORM):** Phase 1.75b changes the SQL Collection with variant narrowing and polymorphic query compilation. Requires coordination. The STI/MTI query compilation adds complexity to `compileSelect` and `buildStateWhere`.

## Risk

- **SQL `findModelNameForTable` assumes 1:1 table-to-model.** STI breaks this assumption (multiple models share a table). The existing code has a comment flagging this. Needs a polymorphism-aware model resolution path.
- **MTI transactional writes.** Multi-table inserts require transaction support. The SQL ORM's existing transaction infrastructure needs to cover this path.
- **MTI LEFT JOIN proliferation.** A base model with many MTI variants produces a query with many LEFT JOINs when querying the base. For most schemas this is acceptable, but it could become a performance concern with many variants.

# References

- [ADR 173 — Polymorphism via discriminator and variants](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — contract representation
- [ADR 172 — Contract domain-storage separation](../../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md) — domain vs storage levels
- [ADR 174 — Aggregate roots and relation strategies](../../../docs/architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — variants not in roots
- [ADR 175 — Shared ORM Collection interface](../../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md) — Collection API design
- [ADR 177 — Ownership replaces relation strategy](../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — `base` parallels `owner`
- [ADR 182 — Unified contract representation](../../../docs/architecture%20docs/adrs/ADR%20182%20-%20Unified%20contract%20representation.md) — `ContractModel` carries `discriminator?`, `variants?`, `base?`
- [ADR 184 — Codec-owned value serialization](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md) — discriminator value encoding
- **Linear:** [TML-2205](https://linear.app/prisma-company/issue/TML-2205)
- **Project plan:** [projects/orm-consolidation/plan.md](../plan.md) § Phase 1.75b

# Open Questions

None — all major design decisions resolved in the discussion above and in ADR 173. Implementation details (exact PSL attribute argument parsing, SQL AST node types for JOINs) are execution-time decisions.
