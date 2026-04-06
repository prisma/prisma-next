# Summary

Implement value objects and embedded documents end-to-end — from contract authoring through emission, validation, type generation, ORM queries, and mutations — for both the Mongo and SQL families. Simplify the existing typed JSON column machinery so it shares the codec-dispatch infrastructure from [ADR 184](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md) instead of maintaining its own bespoke pipeline. Retain both value objects and typed JSON as separate mechanisms serving different purposes.

# Description

The contract has structural slots for value objects ([ADR 178](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)), union field types ([ADR 179](../../../docs/architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md)), and embedded document ownership ([ADR 177](../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)), but none of these are exercised end-to-end. No authoring path produces contracts with `valueObjects`, and the ORM clients have no runtime support for value object fields.

Meanwhile, typed JSON columns (`jsonb(schema)`) have their own parallel infrastructure — phantom `typeParams.schema` types, `schemaJson` in `typeParams`, JSON Schema → TypeScript type rendering in the emitter, per-adapter `parameterizedRenderers` — that doesn't share patterns with the rest of the system. This is a bespoke pipeline for a problem that codec dispatch should handle.

This spec covers three things:

1. **Value objects and embedded documents end-to-end.** From contract authoring (PSL + TS) through emission, validation, `contract.d.ts` type generation, ORM read queries (inlined in results, dot-path filtering), and ORM write mutations (nested create/update inputs).

2. **Typed JSON column simplification.** Replace the bespoke `typeParams.schemaJson` → `parameterizedRenderers` → JSON Schema type rendering pipeline with codec-dispatch. The `pg/jsonb@1` codec tells the emitter what TypeScript type to produce via a `renderType` method on its type-rendering interface, keyed by `codecId` — the same dispatch pattern as `encodeJson`/`decodeJson` from ADR 184. The codec owns all representations of its type's values, including the TypeScript type expression.

3. **Value object field type system extensions.** Two gaps prevent value objects from covering common JSON structures: scalar arrays (`string[]`) and dictionaries (`Record<string, T>`). These need to be closed for value objects to be a credible alternative to typed JSON for structured data.

## Two mechanisms, different purposes

Value objects and typed JSON columns are retained as separate concepts because they serve different cases:

| | Value objects | Typed JSON columns |
|---|---|---|
| **Contract representation** | Structured: named fields with `codecId`/`type`/`union` | Opaque: single `codecId` with `typeParams` |
| **Framework understanding** | Full — dot-path queries, migration diffing, type inference from field descriptors | None — the framework sees one column |
| **TypeScript types** | Derived from contract field descriptors | Derived from codec-owned type rendering (Standard Schema, or `JsonValue` fallback) |
| **Cross-family** | Same contract representation in SQL (JSONB) and Mongo (subdocument) | Per-target codec |
| **Use case** | Structured data the framework should understand: Address, GeoPoint, embedded Comment | Opaque data the framework shouldn't interpret: metadata bags, webhook payloads, config blobs |

The user models structured nested data as value objects. The user models truly opaque JSON as a typed JSON column. There is no overlap in purpose, only in storage mechanism (JSONB in SQL, subdocument/field in Mongo).

# Requirements

## Functional Requirements

### Value object field type system extensions

1. **Scalar arrays.** `many: true` works on scalar fields (`codecId`), not just value object references (`type`). A field `{ "codecId": "mongo/string@1", "many": true }` produces `string[]`. This applies uniformly to scalar, value object, and union fields.

2. **Dictionaries.** A new `dict` field type modifier enables string-keyed maps. `{ "codecId": "mongo/string@1", "dict": true }` produces `Record<string, string>`. `{ "type": "Config", "dict": true }` produces `Record<string, Config>`. The `dict` modifier composes with `nullable` (the whole map can be null) but not with `many` (a dict-of-arrays is `dict` + `many` on the *value* type — use a value object wrapper).

3. **Contract validation.** Value object references in fields are validated: the referenced name must exist in `valueObjects`. Recursive references are allowed (self-referencing value objects). `codecId`, `type`, `union`, and `dict` remain mutually exclusive as field type specifiers (with `dict` being a modifier that requires one of the type specifiers to be present).

### Contract authoring

4. **TS authoring — value objects.** The TS contract authoring surface provides helpers to define value objects and reference them from model fields. Value objects use the same field descriptor shape as model fields.

5. **PSL authoring — value objects.** The PSL interpreter supports value object declarations (syntax TBD — likely a `type` keyword distinct from `model`) and fields that reference value objects via `type`.

6. **TS/PSL authoring — embedded models.** Models with `owner` can be authored. The owned model declares its owning model; the framework infers the embed relationship.

### Contract emission

7. **Value objects in `contract.json`.** The emitter serializes the `valueObjects` section. Value object field descriptors use the same serialization as model field descriptors (including codec-owned JSON encoding from ADR 184 for defaults on value object fields).

8. **Value objects in `contract.d.ts`.** The emitter generates TypeScript types for value objects. Value object types are recursively expanded — an `Address` with a `GeoPoint` field produces the correct nested type. `many: true` produces array types. `dict: true` produces `Record<string, T>` types. Union fields produce union types.

### Contract validation

9. **Domain validation for value objects.** The framework's domain validator (`validateContractDomain`) validates: value object references resolve, no circular `owner` chains, discriminator/variant consistency for polymorphic value objects.

10. **SQL storage validation.** For SQL targets, the storage validator checks that value object fields map to JSON-compatible columns (JSONB/JSON). A value object field mapped to an `integer` column is a validation error.

### Typed JSON column simplification

11. **Codec-owned TypeScript type rendering.** Replace the `parameterizedRenderers` map with a codec-level type rendering interface, dispatched by `codecId`. The `pg/jsonb@1` codec provides a `renderType(typeParams, ctx): string` method that produces the TypeScript type expression. Codecs without this method fall back to `CodecTypes[codecId]['output']`. This eliminates the separate `TypeRenderEntry` infrastructure.

12. **Remove phantom `typeParams.schema`.** The phantom Standard Schema key on `typeParams` is a type-level hack that doesn't survive serialization. Type rendering should be driven by `typeParams.schemaJson` (the serialized JSON Schema payload) through the codec's `renderType` method. The type-level inference path from Standard Schema to output type is an authoring concern, not a contract concern.

13. **Untyped JSON columns.** `jsonb()` with no schema continues to work — the codec's `renderType` returns `JsonValue` when no `schemaJson` is present in `typeParams`. This is the escape hatch for genuinely opaque JSON.

### ORM — reads

14. **Value object fields are inlined in query results.** A value object field on a model is part of the model's row type. No `.include()` needed — the data is always present (it's physically stored in the same document/column).

15. **Dot-path filtering for value objects.** The ORM `where` DSL supports filtering on nested value object fields via dot-path notation: `.where(u => u.address.city.eq("Springfield"))`. In Mongo, this compiles to `{ "address.city": "Springfield" }`. In SQL, this compiles to JSONB path operators (`payload->'address'->>'city'`).

16. **Value object fields in `.select()`.** `.select()` can include/exclude value object fields as a whole. Selecting individual nested fields within a value object is deferred.

### ORM — writes

17. **Nested create inputs.** Creating a model with value object fields accepts the full nested structure inline: `db.users.create({ email: "...", address: { street: "...", city: "..." } })`. The ORM generates the correct nested input types from the contract.

18. **Nested update inputs.** Updating value object fields supports wholesale replacement. Dot-path partial updates (via [ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)) are deferred to the dot-path accessor project.

### ORM — both families

19. **Mongo.** Value objects stored as subdocuments. Dot-path filtering uses MongoDB's native dot notation. Inlining is natural — subdocuments are always returned with the parent.

20. **SQL.** Value objects stored as JSONB columns. Dot-path filtering uses JSONB path operators. Inlining is natural — the JSONB column is always read with the row. The codec (`pg/jsonb@1`) decodes the JSON blob; the framework expands it into the typed value object structure using the contract's field descriptors.

## Non-Functional Requirements

- **Cross-family consistency.** The same contract with value objects produces the same domain-level ORM API for both families. Only the storage layer differs.
- **Incremental adoption.** Value objects can be added to an existing contract without changing models that don't use them.
- **Type safety.** All value object operations — reads, writes, dot-path filtering — are fully typed in TypeScript, derived from the contract.

## Non-goals

- **Standard Schema as authoring input for value objects.** Converting Arktype schemas into value object definitions is a future ergonomic layer. Not in scope.
- **Dot-path partial updates.** Targeted mutation operators (`$set`, `$inc`, `$push` at nested paths) are deferred to the [dot-path accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) project.
- **Nested `.select()` within value objects.** Selecting individual fields within a value object (as opposed to the whole value object) is deferred.
- **Value object migration diffing.** Detecting structural changes within a value object for SQL migration planning (e.g., adding a field to an Address) is deferred. Value object changes in SQL are a column-level change (the JSONB column itself doesn't change schema).
- **Runtime validation of value object structure.** The contract describes the structure; runtime enforcement (rejecting writes with missing fields) is a separate concern. The codec decodes what the database returns.

# Acceptance Criteria

### Value object field type system

- [ ] `many: true` works on scalar fields (`codecId`) — produces array types in `contract.d.ts`
- [ ] `dict: true` works on scalar and value object fields — produces `Record<string, T>` types
- [ ] `many` and `dict` compose with `nullable`
- [ ] Contract validation rejects invalid combinations (`dict` + `many` on the same field, references to nonexistent value objects)

### Contract authoring and emission

- [ ] TS authoring surface can define value objects and reference them from model fields
- [ ] PSL interpreter supports value object declarations and references
- [ ] Emitter serializes `valueObjects` section in `contract.json`
- [ ] Emitter generates correct TypeScript types in `contract.d.ts` for value object fields, including nested, array, and dict types
- [ ] `owner` on models can be authored and emitted

### Typed JSON simplification

- [ ] `parameterizedRenderers` map is replaced by codec-dispatched `renderType` method
- [ ] Phantom `typeParams.schema` is removed from the contract representation
- [ ] `jsonb()` (no schema) continues to produce `JsonValue` type
- [ ] `jsonb(schema)` continues to produce schema-derived type via codec `renderType`
- [ ] Existing typed JSON column tests pass with the new codec-dispatch infrastructure

### ORM reads

- [ ] Value object fields appear in model row types without `.include()`
- [ ] Dot-path filtering works for value object fields in both SQL and Mongo ORM
- [ ] `.select()` can include/exclude value object fields as a whole

### ORM writes

- [ ] `create()` accepts nested value object structure inline
- [ ] `update()` accepts wholesale value object replacement
- [ ] Input types for create/update are correctly derived from value object field descriptors

### Cross-family

- [ ] Same contract with value objects works in both SQL and Mongo
- [ ] Integration tests for both families against real databases

# Other Considerations

## Coordination

- **Alexey (SQL ORM):** SQL dot-path filtering via JSONB operators and value object type expansion in the SQL ORM may require coordination.
- **Contract domain extraction:** Value objects add a new top-level contract section (`valueObjects`). The unified contract type ([ADR 182](../../../docs/architecture%20docs/adrs/ADR%20182%20-%20Unified%20contract%20representation.md)) needs to include it — this is a framework-level domain concept, not family-specific.

## Risk

- **Field type system complexity.** Adding `many` on scalars and `dict` increases the combinatorial surface of field descriptors. Each combination needs type generation, validation, and ORM support. The mitigation is that these are orthogonal modifiers with clear semantics — they compose, they don't interact.
- **SQL JSONB dot-path operators.** Different SQL targets may have different JSONB path operator syntax (Postgres `->` vs `->>`). This is a target-adapter concern but needs to be designed for extensibility.

# References

- [ADR 178 — Value objects in the contract](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)
- [ADR 179 — Union field types](../../../docs/architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md)
- [ADR 177 — Ownership replaces relation strategy](../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)
- [ADR 168 — Postgres JSON and JSONB typed columns](../../../docs/architecture%20docs/adrs/ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md)
- [ADR 184 — Codec-owned value serialization](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md)
- [ADR 182 — Unified contract representation](../../../docs/architecture%20docs/adrs/ADR%20182%20-%20Unified%20contract%20representation.md)
- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)
- [ORM consolidation plan — Phase 1.75](../plan.md)
- [Cross-cutting learnings § 3: Nested/embedded types](../../../docs/planning/mongo-target/cross-cutting-learnings.md)

# Open Questions

1. **`dict` field semantics.** Should `dict` be a modifier (like `many`) or a type constructor (like `union`)? As a modifier: `{ "codecId": "...", "dict": true }`. As a constructor: `{ "dict": { "codecId": "..." } }`. The constructor form composes better with nesting (`dict` of `dict`, `dict` of `many`) but changes the field descriptor shape. The modifier form is simpler and consistent with `many`. **Assumption:** modifier form, revisit if nesting requirements emerge.

2. **`many` on scalars — PSL syntax.** How do scalar arrays look in PSL? `tags String[]`? `tags String @list`? The TS surface is unambiguous (`{ codecId: "...", many: true }`) but PSL needs a syntax decision.

3. **Value object naming in contract.** ADR 178 notes this is open: `valueObjects`, `types`, or `composites`? This should be decided before implementation.

4. **Codec `renderType` interface location.** The codec's `renderType` method is an emission-time concern, not a runtime concern. Should it live on the core `Codec` interface (alongside `encodeJson`/`decodeJson`) or on a separate emission-layer interface (like `DdlLiteralCodec` and `PslLiteralCodec` in ADR 184)? **Assumption:** separate `TypeRenderCodec` interface, contributed through the target descriptor, keyed by `codecId`. This keeps emission concerns out of the runtime codec.

5. **Embedded entities vs value objects sequencing.** ADR 177 defines `owner` for embedded entities (models with identity embedded in a parent). ADR 178 defines `valueObjects` for structured data without identity. Both need implementation. Should they be sequenced (entities first, then value objects) or implemented together? **Assumption:** together — they share the same ORM infrastructure (inlined in results, nested inputs) and only differ in contract semantics.
