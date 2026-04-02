# ADR 181 — Staged contract DSL for SQL TS authoring

## At a glance

A User and Post contract authored with the staged DSL. Notice how the model definition speaks in application-domain terms first — fields, relations, identity — and falls back to SQL details only when the author needs something storage-specific.

```ts
import { defineContract, field, model, rel, type } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const User = model('User', {
  fields: {
    id: field.id.uuidv7(),                // ← pack-provided preset: UUID v7 primary key
    email: field.text().unique(),          // ← inline unique constraint
    createdAt: field.createdAt(),          // ← pack-provided preset: timestamp with default
  },
  relations: {
    posts: rel.hasMany('Post', { by: 'authorId' }),  // ← reverse side, no FK authored here
  },
});

const Post = model('Post', {
  fields: {
    id: field.id.uuidv7(),
    authorId: field.uuid(),
    title: field.text(),
    body: field.text().optional(),
  },
  relations: {
    author: rel.belongsTo(User, {         // ← typed model token, not a string
      from: 'authorId',
      to: User.ref('id'),                 // ← typed cross-model field ref
    }).sql({
      fk: { name: 'post_author_id_fkey', onDelete: 'cascade' },
    }),
  },
}).sql(({ cols, constraints }) => ({      // ← SQL overlay: only storage-specific details
  table: 'blog_post',
  indexes: [constraints.index(cols.authorId, { name: 'post_author_id_idx' })],
}));

export const contract = defineContract({
  target: postgresPack,
  naming: { tables: 'snake_case', columns: 'snake_case' },
  models: { User, Post },
});
```

Three things to notice:

1. **No table or column layer.** The author writes `field.text()`, not `t.column('email', textColumn)`. Column names come from the field keys via a naming strategy. The author only touches storage names when overriding.
2. **Semantic intent, then SQL.** Identity (`field.id.uuidv7()`), uniqueness (`.unique()`), and relations (`rel.belongsTo(User, ...)`) are expressed in the model definition. The `.sql()` block is reserved for table mapping, indexes, and constraint names.
3. **Typed references.** `User` is a model token, not a string. `User.ref('id')` is a typed field reference. The lowering pipeline validates these at build time.

## Design principles

1. **Semantic model first, storage second.** Authors describe their application's domain graph — models, fields, relations, identity — before they describe how it maps to SQL. Most contracts need no `.sql()` block at all. This is a concrete application of the framework's [domain-first surfaces](../../Architecture%20Overview.md#domain-first-surfaces) principle.
2. **Pack-driven vocabulary.** Helpers like `field.text()`, `field.id.uuidv7()`, and `field.createdAt()` come from pack-provided preset descriptors, not from hardcoded DSL internals. The vocabulary changes as framework composition changes.
3. **Typed local references.** Inside `.sql()`, `cols` provides typed refs to the model's scalar fields only. Relation fields cannot appear in constraint authoring. Cross-model refs use model tokens.
4. **Same canonical output.** The staged DSL lowers to the same `contract.json` and `contract.d.ts` that the chain builder produces. Downstream `schema()`, `sql()`, and `orm()` inference is unchanged.
5. **Contract purity.** The contract object remains pure data — no functions, closures, or side effects — per [ADR 096](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md).

## Why a new authoring surface

The chain-builder API (`SqlContractBuilder`) requires authors to describe tables and models as separate layers, then stitch them together with column names and string-based references. For a simple `User` model with an email field, the chain builder requires declaring the table, the column, the model, the field-to-column mapping, the primary key, and the unique constraint — all separately.

The staged DSL collapses that into `field.text().unique()` and lets the naming strategy handle the rest. The insight is that most of a SQL contract's verbosity comes from restating information the system already has: field names imply column names, relation declarations imply FK structure, and common column shapes (UUID IDs, timestamps, text) have well-known codecs and defaults.

Pack-provided type constructors and field presets — introduced in [ADR 170](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md), which defines how families, targets, and extension packs contribute named column shapes through a composition registry — are what make this collapse possible. When `field.text()` carries a codec ID, a native type descriptor, and nullability semantics from the pack registry, the author doesn't need to spell them out.

## How authoring works

### Two stages

The model definition is conceptually split into two stages. Stage 1 captures everything that is independent of any particular SQL target:

- **Scalar fields** with their type, nullability, defaults, and inline constraints (`.id()`, `.unique()`)
- **Relations** with cardinality and ownership semantics
- **Naming strategy** applied to field keys to derive column names

Stage 2 — the `.sql()` block — captures SQL-specific storage details:

- Table name override
- Named indexes and their configuration (`using`, `config`)
- Named constraint overrides (PK names, unique names, FK names)
- FK constraint and index toggles

The key rule: anything that could exist in a non-SQL data model belongs in stage 1. Anything that only makes sense in SQL belongs in stage 2.

### Field presets

`field.text()`, `field.uuid()`, `field.id.uuidv7()`, `field.createdAt()` — these are not DSL keywords. They are thin wrappers around `AuthoringFieldPresetDescriptor` values contributed by pack descriptors. The framework composition machinery (`composeFieldNamespace`) merges contributions from the SQL family, the target (e.g. Postgres), and any extension packs (e.g. pgvector).

Each preset carries:
- A codec ID (e.g. `sql/text@1`)
- A column type descriptor (native type, optional parameters)
- Optional default behavior (literal default, SQL expression, or execution-time generator)
- Optional nullability

When a developer writes `field.id.uuidv7()`, the preset resolves to a specific codec, a UUID native type, a UUIDv7 execution-time generator, and non-nullable semantics — all from the pack registry.

The structural helpers (`field.column()`, `field.generated()`, `field.namedType()`) are different. They are part of the DSL mechanics: ways to specify a raw column descriptor, an execution-time generated value, or a named storage type reference. These don't come from packs.

### Relations and ownership

Relations declare graph edges between models. The key design choice is that only the **owning side** carries FK storage details:

- `rel.belongsTo(User, { from: 'authorId', to: User.ref('id') })` — the owning side. The `from` field on this model maps to the `to` field on the target. FK constraint details (name, referential actions) go in `.sql({ fk: { ... } })`.
- `rel.hasMany('Post', { by: 'authorId' })` — the reverse side. No FK is authored here; the `by` parameter tells the lowering pipeline which field on the target model owns the FK.
- `rel.hasOne('Profile', { by: 'accountId' })` — reverse side, 1:1.
- `rel.manyToMany('Tag', { through: 'PostTag', from: 'postId', to: 'tagId' })` — junction-table relationship.

Model tokens (`User`, `Post`) are the preferred way to reference other models. When a model isn't yet defined (forward references) or when two models reference each other (circular relations), string names work as a fallback. Lazy token resolution handles self-referential relations (e.g. a Category with parent/children fields) and circular relations (e.g. Employee ↔ Department).

A fallback warning system emits diagnostics when authors use string-based refs where typed model tokens are available.

### Naming strategy

Instead of explicit column names on every field, a contract-level naming strategy derives them:

```ts
defineContract({
  naming: { tables: 'snake_case', columns: 'snake_case' },
  ...
});
```

With `snake_case`, a model named `User` maps to table `user`, a field `createdAt` maps to column `created_at`. The `applyNaming()` function handles camelCase boundaries, all-uppercase sequences, and digit boundaries.

Overrides take precedence at any level:
- Per-field: `field.text().column('email_address')`
- Per-model: `.sql({ table: 'app_user' })`

### Inline vs. compound constraints

Single-field constraints are inline because that's where they're most readable:

```ts
id: field.id.uuidv7(),         // primary key
email: field.text().unique(),  // unique constraint
```

Compound constraints require the `.sql()` stage because they reference multiple fields:

```ts
.sql(({ cols, constraints }) => ({
  indexes: [constraints.index([cols.authorId, cols.slug], { name: 'post_author_slug_idx' })],
}))
```

Inside `.sql()`, `cols` exposes only scalar fields — relation fields are excluded. This prevents a common class of errors where relation names are accidentally used as column references.

## How lowering works

The staged DSL doesn't produce `ContractIR` directly. Instead, it lowers through an intermediate representation called `SqlSemanticContractDefinition`:

```
model() + field.* + rel.*                →  StagedModelBuilder instances
          ↓
defineContract({ target, models, ... })
          ↓
buildStagedSemanticContractDefinition()  →  SqlSemanticContractDefinition
          ↓
buildSqlContractFromSemanticDefinition() →  ContractIR
```

`SqlSemanticContractDefinition` is a flat, well-typed interface that captures each model's resolved fields (with column names, codecs, defaults), relations (with cardinality and join coordinates), and constraints (PKs, uniques, indexes, FKs). It creates a clean seam between the authoring surface and the serialization machinery in `SqlContractBuilder`.

This seam matters for two reasons:

1. **Decoupled authoring from serialization.** The staged DSL can evolve without touching the builder internals that produce `ContractIR`. Alternative authoring surfaces could target the same IR.
2. **Shared lowering target.** PSL could lower to `SqlSemanticContractDefinition` instead of going directly to `ContractIR`, making TS ↔ PSL parity structural rather than fixture-tested. (This is deferred to the contract-domain-extraction project, Milestone 5.)

Lowering validates the contract graph and produces actionable error messages for:
- Duplicate PK or unique specifications on the same field
- Duplicate table or column mappings
- Missing FK target models or fields
- Arity mismatches on relation join columns
- Named constraint collisions

### Type-level inference

`SqlContractResult<Definition>` is a computed type that derives storage tables, column mappings, codec IDs, and type maps from the `Definition` generic parameter. This is what makes no-emit usage possible: downstream `schema()`, `sql()`, and `orm()` can infer their full type surface from the TS-authored contract without importing emitted `.d.ts` files.

The name `SqlContractResult` describes what the type represents (the result of building a contract), not the authoring process that created it.

## Consequences

### Benefits

- **Reduced boilerplate.** Pack presets carry codec, native type, nullability, and default in a single call. A naming strategy eliminates explicit column names for the common case.
- **Visible intent.** The contract reads as a model graph first, SQL details second. A developer scanning the contract sees application concepts, not storage choreography.
- **Type-safe references.** Model tokens and typed `cols` provide autocompletion and compile-time validation for constraint authoring and cross-model FK targets.
- **Portability.** Switching a contract from Postgres to SQLite means changing the target import and any target-specific `.sql()` details. The model layer stays unchanged — measured at <10% source change for average portable contracts.
- **Shared TS/PSL foundation.** Both authoring surfaces can lower to `SqlSemanticContractDefinition`, making parity structural rather than fixture-tested.

### Costs

- **Coexisting surfaces.** The chain builder and staged DSL both remain available until the old surface is deprecated.
- **Type-level complexity.** `SqlContractResult<Definition>` uses conditional and mapped types that can be harder to debug. Mitigation: keep authoring-time types shallow and opaque, push graph-wide inference to build/emit time.

### Known gaps

- **Field presets bypass pack composition.** The `field` export currently spreads `portableFieldHelpers` at module initialization, making presets available outside pack context. The structural fix — extracting SQL family presets to a high-layer package (e.g. `packages/2-sql/9-family/`) so the authoring DSL at layer 2 cannot import them — is tracked but not yet implemented.
- **No-emit flow incomplete.** The demo no-emit path still imports emitted `.d.ts` types rather than inferring from the TS-authored contract directly. The `SqlContractResult<Definition>` type machinery works, but literal type propagation through `createExecutionContext` needs investigation.
- **Semantic IR will converge with runtime types.** `SqlSemanticContractDefinition` and the runtime-side `DomainModel` representation both describe "a contract organized by models" — one built working forward from authoring, the other working backward from `ContractIR`. Unifying them into a single model-first representation is deferred to the contract-domain-extraction project, Milestone 5.

## Related ADRs

- [ADR 096 — TS-authored contract parity & purity rules](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md) — contracts must be pure data with deterministic canonicalization
- [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) — the composition registry that provides the field vocabulary
- [ADR 121 — Contract.d.ts structure and relation typing](ADR%20121%20-%20Contract.d.ts%20structure%20and%20relation%20typing.md) — emitted type structure this surface must continue to produce
- [ADR 161 — Explicit foreign key constraint and index configuration](ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) — FK constraint and index toggle design
- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — the domain/storage separation that the two-stage split reflects
