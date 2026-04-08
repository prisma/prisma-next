# Phase 1.75c: Value Objects & Embedded Documents — Execution Plan

## Summary

Implement value objects and embedded documents end-to-end in both SQL and Mongo: extend the contract field type system, add `valueObjects` to the contract, support authoring via PSL and TS, emit and validate value object contracts, and surface value object fields in ORM reads and writes for both families.

**Design:** [value-objects-design.md](value-objects-design.md)
**Spec:** [embedded-documents-and-value-objects.spec.md](../specs/embedded-documents-and-value-objects.spec.md)
**Linear:** [TML-2206](https://linear.app/prisma-company/issue/TML-2206)

## Collaborators

| Role  | Person | Context                                          |
| ----- | ------ | ------------------------------------------------ |
| Maker | Will   | Drives execution                                 |
| FYI   | Alexey | SQL ORM owner — SQL dot-path filtering and JSONB  |

## Dependencies

- **TML-2194** (Phase 1.5 write operations) — **Done**
- **TML-2204** (Phase 1.75a typed JSON simplification) — **not blocking**

## Key references (implementation)

### Contract types and validation

- `ContractField` definition: [`contract/src/domain-types.ts`](../../../packages/1-framework/0-foundation/contract/src/domain-types.ts) (L1–4)
- `ContractModel` definition: [`contract/src/domain-types.ts`](../../../packages/1-framework/0-foundation/contract/src/domain-types.ts) (L34–42)
- `Contract` type: [`contract/src/contract-types.ts`](../../../packages/1-framework/0-foundation/contract/src/contract-types.ts) (L40–54)
- Exports: [`contract/src/exports/types.ts`](../../../packages/1-framework/0-foundation/contract/src/exports/types.ts)
- Canonicalization + `TOP_LEVEL_ORDER`: [`contract/src/canonicalization.ts`](../../../packages/1-framework/0-foundation/contract/src/canonicalization.ts) (L6)
- Domain validation: [`contract/src/validate-domain.ts`](../../../packages/1-framework/0-foundation/contract/src/validate-domain.ts) (L17)
- Structural validation + arktype schema: [`contract/src/validate-contract.ts`](../../../packages/1-framework/0-foundation/contract/src/validate-contract.ts) (L25–41)
- Existing `FieldType` (unrelated — used in `Source` projections): [`contract/src/types.ts`](../../../packages/1-framework/0-foundation/contract/src/types.ts) (L60–65) — our new type must use a different name (`ContractFieldType`)

### Authoring

- SQL PSL interpreter: [`sql-contract-psl/src/interpreter.ts`](../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) (~L679)
- Mongo PSL interpreter: [`mongo-contract-psl/src/interpreter.ts`](../../../packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts) (L61)
- SQL TS authoring: [`sql-contract-ts/src/build-contract.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/build-contract.ts)

### Emission

- Emitter entry: [`emitter/src/emit.ts`](../../../packages/1-framework/3-tooling/emitter/src/emit.ts)
- Domain type generation helpers: [`emitter/src/domain-type-generation.ts`](../../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts)
- SQL emitter hook: [`sql-contract-emitter/src/index.ts`](../../../packages/2-sql/3-tooling/emitter/src/index.ts) (~L207)
- Mongo emitter hook: [`mongo-emitter/src/index.ts`](../../../packages/2-mongo-family/3-tooling/emitter/src/index.ts)

### ORM

- Mongo row type inference: [`mongo-contract/src/contract-types.ts`](../../../packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts) (`InferModelRow` L46–58)
- Mongo collection: [`mongo-orm/src/collection.ts`](../../../packages/2-mongo-family/5-query-builders/src/collection.ts)
- SQL row type inference: [`sql-builder/src/resolve.ts`](../../../packages/2-sql/4-lanes/sql-builder/src/resolve.ts) (`ResolveRow` L5–14)
- SQL ORM collection: [`sql-orm-client/src/collection.ts`](../../../packages/3-extensions/sql-orm-client/src/collection.ts)

### Mongo contract schema (arktype)

- `RawFieldSchema` / `ModelDefinitionSchema`: [`mongo-contract/src/contract-schema.ts`](../../../packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts)

## Packages touched

| Package | Layer | What changes |
|---------|-------|-------------|
| `@prisma-next/contract` | framework/foundation | `ContractField` → discriminated union with `ContractFieldType`. New `ContractValueObject` type. `valueObjects` on `Contract`. Canonicalization includes `valueObjects`. Domain validation checks value object references. |
| `@prisma-next/sql-contract` | sql/core | Storage validator checks value object fields map to JSON-compatible columns. |
| `@prisma-next/mongo-contract` | mongo/foundation | `InferModelRow` handles value object field types. Arktype schema accepts new field shape. |
| `@prisma-next/sql-contract-psl` | sql/authoring | PSL interpreter: `type` declarations → `valueObjects`; value object field references → `{ kind: 'valueObject' }` fields + JSONB column. |
| `@prisma-next/mongo-contract-psl` | mongo/authoring | PSL interpreter: `type` declarations → `valueObjects`; value object field references → `{ kind: 'valueObject' }` fields. |
| `@prisma-next/sql-contract-ts` | sql/authoring | TS builders: define value objects, reference from model fields. |
| `@prisma-next/emitter` | framework/tooling | Domain type generation: recursively expand value object references into TypeScript types. |
| `@prisma-next/sql-contract-emitter` | sql/tooling | SQL `contract.d.ts` generation handles value object fields. |
| `@prisma-next/mongo-emitter` | mongo/tooling | Mongo `contract.d.ts` generation handles value object fields. |
| `@prisma-next/mongo-orm` | mongo/query-builders | Value object fields in row types, dot-path filtering, nested create/update inputs. |
| `@prisma-next/sql-orm-client` | sql/extensions | Value object fields in row types, JSONB dot-path filtering, nested create/update inputs. |

## Milestones

### Milestone 1: Contract field type system

Replace the flat `ContractField` with a structurally exclusive discriminated union. Add value object definitions to the contract.

#### 1.1 Define `ContractFieldType` discriminated union

In `contract/src/domain-types.ts`, replace:

```ts
type ContractField = { readonly nullable: boolean; readonly codecId: string };
```

With the tagged type specifier design from the [design doc](value-objects-design.md#1-field-descriptor--structurally-exclusive-type-specifier):

```ts
type ScalarFieldType = {
  readonly kind: 'scalar';
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
};

type ValueObjectFieldType = {
  readonly kind: 'valueObject';
  readonly name: string;
};

type UnionFieldType = {
  readonly kind: 'union';
  readonly members: ReadonlyArray<ScalarFieldType | ValueObjectFieldType>;
};

type ContractFieldType = ScalarFieldType | ValueObjectFieldType | UnionFieldType;

type ContractField = {
  readonly nullable: boolean;
  readonly type: ContractFieldType;
  readonly many?: true;
  readonly dict?: true;
};
```

Note: there is an existing `FieldType` export in `contract/src/types.ts` (used by `Source` projections and `DocCollection`). The new type must be named `ContractFieldType` to avoid collision.

#### 1.2 Add `ContractValueObject` and `valueObjects` to `Contract`

```ts
type ContractValueObject = {
  readonly fields: Record<string, ContractField>;
};
```

Add `readonly valueObjects?: Record<string, ContractValueObject>` to the `Contract` interface.

#### 1.3 Update canonicalization

Add `'valueObjects'` to `TOP_LEVEL_ORDER` in `canonicalization.ts` (between `'models'` and `'storage'`).

#### 1.4 Update all consumers of `ContractField`

Every place that reads `field.codecId` must change to `field.type.codecId` (after narrowing `field.type.kind === 'scalar'`). This is mechanical — grep for `\.codecId` across the packages listed in the "Packages touched" table. Key call sites:

- `validate-domain.ts` — discriminator field checks
- `build-contract.ts` — SQL TS authoring field construction
- Mongo PSL interpreter — field construction
- SQL PSL interpreter — field construction
- `family-sql` — field reads
- `contract-authoring` — field handling

#### 1.5 Update arktype schemas

- Framework `ContractSchema` in `validate-contract.ts` — add `'valueObjects?': 'Record<string, unknown>'`
- Mongo `RawFieldSchema` / `ModelDefinitionSchema` in `contract-schema.ts` — update field shape to accept the new `type` object

#### 1.6 Update exports

Export `ContractFieldType`, `ScalarFieldType`, `ValueObjectFieldType`, `UnionFieldType`, `ContractValueObject` from `contract/src/exports/types.ts`.

#### 1.7 Tests

- Type-level tests: `ContractField` rejects objects with conflicting type specifiers (e.g. `codecId` + value object `name`)
- Type-level tests: narrowing on `field.type.kind` gives access to variant-specific properties
- Unit tests: `ContractValueObject` fields use the same field shape as model fields
- Unit tests: canonicalization includes `valueObjects` section in output, ordered correctly

### Milestone 2: Contract validation

#### 2.1 Value object reference validation

Extend `validateContractDomain` in `validate-domain.ts`: add `DomainContractShape.valueObjects?: Record<string, DomainValueObjectShape>`. Add a `validateValueObjectReferences` function that walks all fields in models and value objects, checking that every `{ kind: 'valueObject', name }` resolves to a key in `valueObjects`. Self-references are allowed.

Update `extractDomainShape` in `validate-contract.ts` to pass `valueObjects` through.

#### 2.2 Field modifier validation

Validate that `dict: true` and `many: true` don't coexist on the same field. This applies to model fields and value object fields.

#### 2.3 SQL storage validation

In `@prisma-next/sql-contract`'s storage validator: when a model field has `type.kind === 'valueObject'`, the corresponding storage column must have a JSON-compatible `nativeType` (e.g. `jsonb`, `json`). Reject mismatches.

#### 2.4 Tests

- Domain validation: value object reference to nonexistent name → error
- Domain validation: self-referencing value object (e.g. `NavItem` → `NavItem[]`) → no error
- Domain validation: `dict` + `many` on same field → error
- SQL storage validation: value object field → `jsonb` column → passes
- SQL storage validation: value object field → `integer` column → error
- Existing domain validation tests continue to pass (roots, variants, relations, ownership)

### Milestone 3: Contract authoring — PSL

#### 3.1 PSL `type` declarations

Both the SQL and Mongo PSL interpreters need to:

1. Recognize `type` blocks (distinct from `model` blocks) in the PSL AST
2. Emit value object definitions into `contract.valueObjects`
3. Value object fields use the same field descriptor shape as model fields (`{ kind: 'scalar', codecId: '...' }` etc.)

#### 3.2 PSL value object field references

When a model field references a `type` name (e.g. `homeAddress Address?`):

- Emit `{ nullable: true, type: { kind: 'valueObject', name: 'Address' } }` on the model's domain fields
- **SQL:** also emit a JSONB storage column for the field
- **Mongo:** no special storage action

`Address[]` maps to `{ nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: true }`.

#### 3.3 PSL scalar arrays

`tags String[]` maps to `{ nullable: false, type: { kind: 'scalar', codecId: '...' }, many: true }`. The `many` modifier applies to scalar fields, not just value object references.

#### 3.4 Tests

- PSL with `type Address { ... }` and `model User { homeAddress Address? }` → contract has `valueObjects.Address` and `models.User.fields.homeAddress` with `kind: 'valueObject'`
- PSL with `Address[]` → `many: true`
- PSL with `String[]` → scalar with `many: true`
- PSL `type` cannot be used as a root (error diagnostic)
- SQL: value object field emits JSONB column in storage
- Mongo: value object field has no special storage

### Milestone 4: Contract authoring — TS

#### 4.1 TS authoring helpers

Add helpers in `@prisma-next/sql-contract-ts` to define value objects and reference them from model fields. The builder API should produce contracts with `valueObjects` populated and model fields using `{ kind: 'valueObject', name: '...' }`.

#### 4.2 Tests

- TS-authored contract with value objects produces correct `valueObjects` section
- TS-authored model field referencing a value object produces correct field descriptor
- Round-trip: TS-authored → emit → validate succeeds

### Milestone 5: Contract emission and type generation

#### 5.1 Serialize `valueObjects` in `contract.json`

The emitter serializes the `valueObjects` section. Canonicalization already handles it (milestone 1.3). Verify the emitted JSON includes value object definitions.

#### 5.2 Generate value object types in `contract.d.ts`

Both the SQL and Mongo emitter hooks need to generate TypeScript types for value object fields. The generation:

1. Recursively expands `{ kind: 'valueObject', name: 'Address' }` into the Address field structure
2. `many: true` → wraps in array: `Address[]`
3. `dict: true` → wraps in record: `Record<string, Address>`
4. `nullable: true` → appends `| null`
5. Self-referencing value objects emit a named TypeScript type to avoid infinite recursion

For domain type generation (`emitter/src/domain-type-generation.ts`), add a shared helper that given a `ContractField` and the `valueObjects` map, produces the TypeScript type expression string.

#### 5.3 Tests

- Emit a contract with value objects → `contract.json` contains `valueObjects` section
- Emit a contract with value objects → `contract.d.ts` has correct nested types
- `many: true` on value object → array type in `contract.d.ts`
- `many: true` on scalar → array type in `contract.d.ts`
- `nullable: true` on value object → `| null` in `contract.d.ts`
- Self-referencing value object → named TypeScript type, no infinite recursion
- Round-trip: author → emit → validate → types are consistent

### Milestone 6: ORM reads (both families)

#### 6.1 Mongo row type inference

Update `InferModelRow` in `mongo-contract/src/contract-types.ts` to handle `{ kind: 'valueObject' }` fields. When a field references a value object, the inferred type recursively expands the value object's fields. `many: true` → array. `nullable: true` → union with `null`.

#### 6.2 Mongo dot-path filtering

The Mongo ORM's `where` clause already compiles to MongoDB filter documents. Dot-path filtering on value object fields (`u("homeAddress.city").eq("NYC")`) compiles to `{ "homeAddress.city": "NYC" }` — this is MongoDB's native dot notation and should work naturally once the type system accepts dot-paths into value object fields.

#### 6.3 SQL row type inference

Update SQL's row type resolution to handle value object fields. A value object field stored as JSONB should decode into the nested TypeScript type defined by the value object's fields.

#### 6.4 SQL dot-path filtering

Dot-path filtering on JSONB value object fields compiles to JSONB path operators (`home_address->>'city' = 'NYC'`). Coordinate with Alexey.

#### 6.5 `.select()` support

Both families: `.select()` can include/exclude value object fields as a whole. Selecting individual nested fields within a value object is deferred.

#### 6.6 Tests

- Mongo: query returns value object fields inlined in result, correctly typed
- Mongo: dot-path filter on value object field compiles to native dot notation
- SQL: query returns value object field decoded from JSONB, correctly typed
- SQL: dot-path filter on JSONB value object compiles to JSONB path operators
- Both: `.select()` includes/excludes value object fields

### Milestone 7: ORM writes (both families)

#### 7.1 Nested create inputs

Both families: `create()` accepts value object structure inline. The ORM generates correct nested input types from the contract's value object field descriptors.

#### 7.2 Nested update inputs

Both families: `update()` accepts wholesale value object replacement. Dot-path partial updates are deferred to the [dot-path accessor project](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md).

#### 7.3 Tests

- Mongo: `create()` with nested value object → inserted as subdocument
- Mongo: `update()` with value object replacement → full subdocument replaced
- SQL: `create()` with nested value object → inserted as JSONB
- SQL: `update()` with value object replacement → JSONB column updated
- Both: input types correctly derived from value object field descriptors (type-level tests)

### Milestone 8: Integration tests

#### 8.1 End-to-end Mongo

PSL schema with value objects → interpret → emit → validate → ORM reads and writes against `mongodb-memory-server`. Value object fields are correctly stored, queried, and returned.

#### 8.2 End-to-end SQL

PSL schema with value objects → interpret → emit → validate → ORM reads and writes against Postgres. Value object fields are correctly stored as JSONB, queried via JSONB operators, and decoded in results.

#### 8.3 Cross-family consistency

Same PSL schema (minus target-specific annotations) produces equivalent domain-level ORM behavior in both families. The same value object definition, referenced the same way, produces the same TypeScript types.

## Test coverage

| Acceptance criterion | Test type | Milestone |
|---|---|---|
| `ContractField` rejects conflicting type specifiers | Type test | 1.7 |
| `ContractFieldType` narrowing works on `kind` | Type test | 1.7 |
| Canonicalization includes `valueObjects` | Unit | 1.7 |
| Value object reference to nonexistent name → error | Unit | 2.4 |
| Self-referencing value object → valid | Unit | 2.4 |
| `dict` + `many` on same field → error | Unit | 2.4 |
| SQL: value object field → non-JSON column → error | Unit | 2.4 |
| PSL `type` declarations produce `valueObjects` | Unit | 3.4 |
| PSL value object field refs produce correct descriptors | Unit | 3.4 |
| PSL scalar arrays produce `many: true` | Unit | 3.4 |
| SQL PSL: value object field emits JSONB column | Unit | 3.4 |
| TS authoring produces value object contracts | Unit | 4.2 |
| Emitted `contract.json` includes `valueObjects` | Unit | 5.3 |
| Emitted `contract.d.ts` has correct nested types | Snapshot | 5.3 |
| `many: true` → array type in `contract.d.ts` | Snapshot | 5.3 |
| Self-referencing value object → named type, no recursion | Unit | 5.3 |
| Author → emit → validate round-trip | Integration | 5.3 |
| Mongo: value object fields inlined in results | Integration | 6.6 |
| Mongo: dot-path filter compiles to native dot notation | Unit | 6.6 |
| SQL: value object decoded from JSONB | Integration | 6.6 |
| SQL: dot-path filter compiles to JSONB path operators | Unit | 6.6 |
| Mongo: nested create inserts subdocument | Integration | 7.3 |
| SQL: nested create inserts JSONB | Integration | 7.3 |
| Mongo: update replaces subdocument | Integration | 7.3 |
| SQL: update replaces JSONB | Integration | 7.3 |
| Input types derived from value object descriptors | Type test | 7.3 |
| End-to-end Mongo: PSL → emit → ORM CRUD | Integration | 8.1 |
| End-to-end SQL: PSL → emit → ORM CRUD | Integration | 8.2 |
| Cross-family: same schema → same domain types | Integration | 8.3 |

## Follow-ups (out of scope)

- **Dot-path partial updates** (`$set`, `$inc`, `$push` at nested paths) — deferred to the [dot-path accessor project](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)
- **Nested `.select()` within value objects** — selecting individual fields within a value object (as opposed to the whole value object)
- **Value object migration diffing** — detecting structural changes within a value object for SQL migration planning
- **Runtime validation of value object structure** — the contract describes the structure; runtime enforcement is a separate concern
- **Standard Schema as authoring input** — converting Arktype schemas into value object definitions
- **JSON compaction** — reducing contract JSON verbosity for scalar fields without changing the in-memory representation

## Open items

1. **`ContractFieldType` naming.** The existing `FieldType` in `contract/src/types.ts` is used by `Source` projections. Our new type needs a different name. `ContractFieldType` follows the `Contract*` naming convention. Confirm during milestone 1.

2. **Migration blast radius.** Changing `ContractField` from `{ codecId, nullable }` to `{ type: { kind, ... }, nullable, ... }` touches every consumer. The change is mechanical but wide. Consider splitting milestone 1 into a refactoring PR (change the type + update all consumers) before adding value object functionality.

3. **SQL dot-path JSONB operators.** Different SQL targets may have different JSONB path operator syntax. Coordinate with Alexey on the adapter design for JSONB path extraction in milestone 6.4.
