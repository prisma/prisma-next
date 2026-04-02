# ADR 178 — Staged contract DSL for SQL TS authoring

## Context

The SQL TypeScript authoring surface uses `defineContract()` with a chain-builder API (`SqlContractBuilder`). Authors define tables and models separately, repeat the same information at the storage and model layers for common scalar fields, and manually coordinate relations, naming, defaults, and constraints at low-level coordinates. See [ADR 096](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md) for the TS-authored contract purity rules this surface must satisfy.

[ADR 170](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) introduced pack-provided type constructors and field presets — a shared vocabulary for TS and PSL where families, targets, and extension packs contribute column shapes and field helpers through a composition registry. This ADR describes the authoring surface that consumes those contributions.

## Problem

The chain-builder surface requires mechanical authoring for the most common patterns:

1. **Redundant declarations**: scalar fields repeat column type, name, and codec at both the model and table layers.
2. **Scattered constraints**: primary keys, uniques, indexes, and foreign keys are defined at the table level, disconnected from the fields and relations they describe.
3. **No domain vocabulary**: the builder speaks in database-first terms (`t.column(...)`, `t.primaryKey([...])`) rather than application-domain terms.
4. **Opaque cross-model references**: FK authoring uses untyped string arrays with no autocompletion or compile-time validation.

The result is verbose, error-prone contracts where intent is obscured by storage choreography.

## Constraints

- The redesigned surface must emit the same canonical `contract.json` and `contract.d.ts` through the existing CLI emission pipeline.
- TS-authored contracts must remain pure data per [ADR 096](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md) (no functions, closures, or side effects in the contract object).
- Field presets and type constructors must come from pack-provided composition per [ADR 170](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) (not hardcoded into the authoring DSL's core surface).
- The no-emit workflow — where downstream `schema()`, `sql()`, and `orm()` infer types directly from the TS-authored contract — must remain a first-class experience.
- Type-level machinery must stay shallow enough to avoid significant TS language-server regressions.

## Decision

### Two-stage authoring: semantic model, then SQL overlay

The new surface splits contract authoring into two conceptual stages.

**Stage 1 — Semantic model intent**: scalar fields, relations, and model-level attributes (primary keys, uniques). Authors describe application-domain structure using pack-provided helpers.

**Stage 2 — SQL overlay** (`.sql()`): table name mapping, indexes, constraint names, index `using`/`config`, and storage-specific details that the semantic layer cannot express.

```ts
const User = model('User', {
  fields: {
    id: field.id.uuidv7(),
    email: field.text().unique(),
    createdAt: field.createdAt(),
  },
  relations: {
    posts: rel.hasMany('Post', { by: 'authorId' }),
  },
}).sql({
  table: 'app_user',
});
```

The stage split means most model definitions never need an `.sql()` block at all — a naming strategy handles table/column name derivation. When `.sql()` is needed, it receives typed refs to the model's scalar fields via `cols`, preventing relation fields from appearing in constraint authoring.

### Semantic intermediate representation

Lowering produces an `SqlSemanticContractDefinition` — a well-typed interface boundary between the authoring surface and the existing `SqlContractBuilder` internals. This IR describes models, fields (with resolved column names, codecs, defaults), relations (with cardinality and join coordinates), and constraints (PKs, uniques, indexes, FKs) in a flat, inspectable structure that decouples the authoring DSL from contract serialization.

The semantic IR captures everything needed to produce `ContractIR` and to derive downstream types. Both PSL and TS authoring can target this IR (PSL lowering to it is deferred to the contract-domain-extraction project, Milestone 5).

### Pack-driven vocabulary

The `field` helpers (`field.text()`, `field.uuid()`, `field.id.uuidv7()`, `field.createdAt()`, etc.) are derived from pack-provided `AuthoringFieldPresetDescriptor` values via `createFieldHelpersFromNamespace()`. The framework composition machinery (`composeFieldNamespace`) merges family, target, and extension pack contributions with conflict detection and prototype-pollution guards.

Structural helpers (`field.column()`, `field.generated()`, `field.namedType()`) are part of the DSL mechanics, not the pack vocabulary.

Type constructors (`type.enum(...)`, `type.text()`, and extension-scoped constructors like `type.pgvector.vector(1536)`) follow the same pack-driven registration model.

### Typed model tokens and cross-model references

`model('User', { ... })` returns a `StagedModelBuilder` that serves as a typed token. Relation declarations can accept either a string model name or a model token:

```ts
rel.belongsTo(User, { from: 'authorId', to: User.ref('id') })
```

When tokens are used, the lowering pipeline validates FK target models and fields at build time. When strings are used (e.g. for forward references or circular relations), a fallback warning system emits diagnostics suggesting typed alternatives where available.

### Relation ownership model

Relations use explicit ownership semantics:

- `rel.belongsTo()` declares the owning side. Only the owning side specifies FK storage details via `.sql({ fk: { ... } })`.
- `rel.hasMany()` and `rel.hasOne()` declare the reverse/query side. No FK storage is authored here.
- `rel.manyToMany()` declares a junction-table relationship with `through`, `from`, and `to`.

Self-referential relations (e.g. Category with parent/children) and circular relations (e.g. Employee ↔ Department) are supported through lazy token resolution.

### Naming strategy with overrides

Contract-level naming strategy (`naming: { tables: 'snake_case', columns: 'snake_case' }`) derives table and column names from model and field keys via `applyNaming()`. Per-field overrides (`.column('override_name')`) and per-model overrides (`.sql({ table: 'override' })`) take precedence.

### Inline vs. model-level constraints

Single-field identity and uniqueness are inline on the field:

```ts
id: field.id.uuidv7(),         // implies PK
email: field.text().unique(),  // implies unique constraint
```

Compound constraints live in the `.sql()` stage:

```ts
.sql(({ cols, constraints }) => ({
  indexes: [constraints.index([cols.authorId, cols.slug])],
}))
```

### Type-level contract result

`SqlContractResult<Definition>` computes storage tables, column mappings, codec IDs, and type maps from the definition's generic parameter. This preserves full type inference for downstream `schema()`, `sql()`, and `orm()` usage without manual annotation. The name describes the output (a contract result), not the authoring process.

### Lowering pipeline

```
model() + field.* + rel.*       →  StagedModelBuilder instances
          ↓
defineContract({ target, models, ... })
          ↓
buildStagedSemanticContractDefinition()  →  SqlSemanticContractDefinition
          ↓
buildSqlContractFromSemanticDefinition() →  ContractIR
```

Lowering validates:
- Identity conflicts (duplicate PK/unique specifications)
- Duplicate table/column mappings
- Missing FK targets
- Arity mismatches on relation join columns
- Named constraint collisions

All validations produce clear, actionable error messages.

## Consequences

### Benefits

- **Reduced boilerplate**: common scalar fields no longer require duplicate field-to-column declarations. Pack presets carry column type, codec, nullability, and default in a single call.
- **Intent is visible**: the contract reads as a model graph first, SQL details second.
- **Type-safe cross-model references**: model tokens and typed `cols` provide autocompletion and compile-time validation for constraint authoring.
- **Shared TS/PSL foundation**: both surfaces can lower to the same semantic IR, making parity structural rather than fixture-tested (PSL targeting the IR is deferred).
- **Portability**: switching from Postgres to SQLite requires changing the target import and target-specific `.sql()` details only; the semantic model layer stays unchanged. Measured at <10% source change for average portable contracts.

### Costs

- **Two authoring surfaces coexist temporarily**: the chain builder and staged DSL both remain available until the old surface is deprecated.
- **Type-level complexity**: `SqlContractResult<Definition>` uses conditional and mapped types that can be harder to debug. Mitigation: keep authoring-time types shallow and opaque, push graph-wide inference to `build`/emit time.
- **Semantic IR is a stepping stone**: `SqlSemanticContractDefinition` is SQL-specific and will converge with the runtime-side `DomainModel` representation in the contract-domain-extraction project (see the deferred convergence note below).

### Known gaps

- **Field presets bypass pack composition**: the `field` export currently spreads `portableFieldHelpers` at module initialization, making presets available outside pack context. The structural fix — extracting SQL family presets to a high-layer package so the authoring DSL (layer 2) cannot import them — is tracked but not yet implemented.
- **No-emit flow regression**: the demo no-emit path still imports emitted `.d.ts` types instead of inferring from the TS-authored contract directly. Investigation needed on literal type propagation through `createExecutionContext`.
- **Contract representation convergence (deferred)**: `SqlSemanticContractDefinition`, `ContractBase` + `DomainModel`, and `ContractIR` are three parallel type hierarchies describing "a contract organized by models." Unifying them into a single model-first representation is deferred to the contract-domain-extraction project, Milestone 5.

## Related ADRs

- [ADR 096 — TS-authored contract parity & purity rules](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md) — purity constraints this surface must satisfy
- [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) — the shared vocabulary model this surface consumes
- [ADR 121 — Contract.d.ts structure and relation typing](ADR%20121%20-%20Contract.d.ts%20structure%20and%20relation%20typing.md) — emitted types this surface must continue to produce
- [ADR 161 — Explicit foreign key constraint and index configuration](ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) — FK authoring model
- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — domain/storage principle the stage split reflects
