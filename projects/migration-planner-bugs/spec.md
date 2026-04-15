# Summary

Fix three bugs in the MongoDB migration planner (FL-09, FL-10, FL-11) and eliminate the root architectural cause: contract source providers require manually assembled contributions that should flow automatically from the framework. By the end of this work, `ContractSourceContext` carries all assembled contributions (scalar type descriptors, authoring contributions, mutation defaults, codec lookup), both PSL and TS contract authoring surfaces receive their type knowledge from the framework, hardcoded maps are deleted, and the migration planner produces correct operations for polymorphic collections.

# Description

The MongoDB migration planner produces incorrect operations for schemas with polymorphic (discriminated) models, and silently drops `Float` fields from `$jsonSchema` validators. These are symptoms of two problems:

1. **Interpreter bugs (FL-09, FL-10):** The PSL interpreter generates a separate storage collection entry for every model — including polymorphic variants that share their base model's collection. This causes the migration planner to emit spurious `createCollection` operations for variants. Additionally, the validator for the shared collection is overwritten per-model instead of being composed from base + variant fields.

2. **Missing scalar type (FL-11) caused by broken composition:** The `Float` PSL type is missing from two hardcoded maps in the Mongo authoring layer: `createMongoScalarTypeDescriptors()` (PSL type → codec ID) and `CODEC_TO_BSON_TYPE` (codec ID → BSON type). These maps should not exist in the authoring layer at all — they should be provided by the target/adapter via framework composition. The SQL side has the right idea (Postgres provides its scalar type descriptors via the adapter descriptor), but the composition is broken there too: users must manually call `assemblePslInterpretationContributions()` and pass the result to the contract source provider in the config file. The framework should handle this automatically.

The fix has two dimensions:

- **Bug fixes (FL-09, FL-10, FL-11):** Fix the interpreter's collection and validator generation for polymorphic models, and ensure `Float` maps to `mongo/double@1` / `bsonType: "double"`.
- **Architectural fix:** Make `ContractSourceContext` carry all assembled framework contributions. The CLI already has access to all framework components and already builds a `ControlStack` — it just does so *after* calling the contract source. This work moves that assembly *before* the source call and passes the results via `ContractSourceContext`. Both SQL and Mongo providers read from context. All manual assembly in user configs is eliminated.

## Key insight: `codecId` is sufficient

The current SQL `PslScalarTypeDescriptor` carries redundant data: `{ codecId, nativeType, typeRef?, typeParams? }`. But `nativeType` is already available on the codec itself via `codec.targetTypes`. The BSON type mapping (`CODEC_TO_BSON_TYPE`) is equally redundant — it's just `codec.targetTypes[0]` for Mongo codecs.

Therefore the scalar type descriptor contribution is simply a `Map<string, string>` — PSL type name → codec ID. Any additional data the interpreter needs (native type, BSON type) can be derived from the codec lookup, which is already assembled on the `ControlStack`.

## What `ContractSourceContext` should carry

The `ControlStack` already assembles everything the contract source providers need:

| What | Currently on `ControlStack` | Currently passed as provider option |
|---|---|---|
| Authoring contributions (field presets, type constructors) | `authoringContributions` | `authoringContributions` on `prismaContract()` |
| Codec lookup | `codecLookup` | Not passed (but needed for the new `codecId`-only descriptors) |
| Extension pack IDs | `extensionIds` | `composedExtensionPacks` on context + `composedExtensionPacks` option |
| Scalar type descriptors | Not assembled | `scalarTypeDescriptors` on both `prismaContract()` and `mongoContract()` |
| Mutation defaults | Not assembled | `controlMutationDefaults` on `prismaContract()` |

The fix: enrich `ContractSourceContext` with all of these, assembled by the CLI from the `ControlStack` and component descriptors before calling the source provider.

# Requirements

## Functional Requirements

### FL-09: No separate collections for polymorphic variants

- When a variant model shares its base model's collection (single-collection polymorphism via `@@base`), the contract's `storage.collections` must not contain a separate entry for the variant's default collection name.
- The migration planner must not emit `createCollection` operations for variant models that share their base's collection.
- Variant indexes must be merged into the base collection's index list.

### FL-10: Polymorphic collection validators include all fields

- The `$jsonSchema` validator for a polymorphic base collection must include all base model fields.
- The validator must use a `oneOf` discriminator pattern covering variant-specific fields, keyed by the discriminator field's value.
- Each `oneOf` branch must declare the variant's own required fields and properties.

### FL-11: Float fields in validators

- Fields typed as `Float` in PSL must produce `{ bsonType: "double" }` in the `$jsonSchema` validator.
- The `Float` → `mongo/double@1` mapping must come from the Mongo target/adapter descriptor, not a hardcoded map in the authoring layer.

### Enriched `ContractSourceContext`

- `ContractSourceContext` must carry:
  - `pslScalarTypeDescriptors: ReadonlyMap<string, string>` — PSL type name → codec ID, assembled from all framework components
  - `authoringContributions: AssembledAuthoringContributions` — field presets and type constructors
  - `codecLookup: CodecLookup` — for resolving codec metadata (e.g., `targetTypes` for native/BSON type derivation)
  - `composedExtensionPacks: readonly string[]` — (already present)
  - `controlMutationDefaults` — default function registry and generator descriptors
- The CLI's `executeContractEmit` must build the `ControlStack` *before* calling the contract source provider and pass the assembled contributions via `ContractSourceContext`.

### Framework-level PSL contributions on `ComponentMetadata`

- `ComponentMetadata` must support:
  - `pslScalarTypeDescriptors?: ReadonlyMap<string, string>` — PSL type name → codec ID
  - `controlMutationDefaults?: { defaultFunctionRegistry: ...; generatorDescriptors: ... }` — default function handlers and generator descriptors
- The `ControlStack` assembly (`createControlStack`) must assemble both scalar type descriptors and mutation defaults from all component descriptors, with duplicate detection (same pattern as `assembleAuthoringContributions`).
- The Mongo target/adapter must declare `pslScalarTypeDescriptors` including `Float` → `mongo/double@1`.
- The Postgres adapter already declares scalar type descriptors via `pslTypeDescriptors()` and mutation defaults via `controlMutationDefaults()` on `SqlControlStaticContributions` — both must be migrated to the new framework-level fields on `ComponentMetadata`. The SQL-specific `PslScalarTypeDescriptor` type (with `nativeType`, `typeRef`, `typeParams`) and `SqlControlStaticContributions` are eliminated.
- The mutation default types (`DefaultFunctionRegistryEntry`, `MutationDefaultGeneratorDescriptor`) move from `packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts` to the framework level, since they're family-agnostic in structure.

### BSON/native type derivation from codec lookup

- `deriveJsonSchema` must derive the BSON type mapping from the codec lookup (`codecLookup.get(codecId).targetTypes[0]`) instead of the hardcoded `CODEC_TO_BSON_TYPE` map.
- The SQL interpreter must derive `nativeType` from `codecLookup.get(codecId).targetTypes[0]` instead of the `nativeType` field on `PslScalarTypeDescriptor`.

### Provider simplification

- `prismaContract()` must read all contributions from `ContractSourceContext`, not from options. The options `scalarTypeDescriptors`, `authoringContributions`, and `controlMutationDefaults` are removed.
- `mongoContract()` must read scalar type descriptors from `ContractSourceContext`, not from options. The `scalarTypeDescriptors` option is removed.

### Config simplification

- Example configs declare components (family, target, adapter, extensions) and call the contract source function with only source-specific options (schema path, output path). No manual assembly.

### Elimination of duplicated/hardcoded contributions

- `createMongoScalarTypeDescriptors()` in `scalar-type-descriptors.ts` is deleted.
- `CODEC_TO_BSON_TYPE` in `derive-json-schema.ts` is deleted.
- SQL's `PslScalarTypeDescriptor` type (with `nativeType`) in `packages/2-sql/9-family/src/core/migrations/types.ts` is eliminated.
- SQL's `SqlControlStaticContributions` interface is eliminated — its hooks (`pslTypeDescriptors`, `controlMutationDefaults`) are replaced by the framework-level fields on `ComponentMetadata`.
- SQL's `assemblePslInterpretationContributions()` and `assembleControlMutationDefaultContributions()` are replaced by the framework-level assembly in `createControlStack`.

## Non-Functional Requirements

- No new packages are introduced — this reorganizes existing code across existing packages.
- No breaking changes to the `Contract` type or the emitted `contract.json` structure.
- The `storageHash` for existing contracts must not change unless the contract's content actually changes (i.e., adding `Float` support to a schema that uses `Float` will change the hash, but existing schemas without `Float` must produce identical hashes).

## Non-goals

- Adding other missing Mongo scalar types beyond `Float` (e.g. `Long`, `Decimal`, `Bytes`). These can follow naturally once the framework-level contribution mechanism is in place, but are not in scope for this task.
- Multi-collection polymorphism. The ticket explicitly scopes to single-collection (STI) polymorphism, which is the only pattern Mongo supports.
- Changes to the Mongo ORM's polymorphic query behavior — this is planner/interpreter only.
- Implementing Mongo-specific default function handlers (e.g. `@default(auto())`). The framework contribution mechanism for mutation defaults must be in place, but the Mongo adapter doesn't need to contribute handlers in this task.

# Acceptance Criteria

## FL-09: Variant collection suppression

- [ ] Running the interpreter on a PSL schema with `@@discriminator` / `@@base` produces a contract where `storage.collections` has no entry for the variant's default collection name (only the base's collection).
- [ ] `MongoMigrationPlanner.plan()` on such a contract (from empty origin) emits no `createCollection` for variant collection names.
- [ ] Variant-level `@@index` declarations are merged into the base collection's index list in the contract.

## FL-10: Polymorphic validators

- [ ] The base collection's `$jsonSchema` validator includes all base model fields in `properties` and `required`.
- [ ] The validator includes a `oneOf` array with one entry per variant, each scoped to the discriminator value and listing variant-specific properties/required.
- [ ] A base model with no variant-specific fields (all fields are on the base) produces a simple validator with no `oneOf`.

## FL-11: Float type support

- [ ] A PSL field `price Float` produces `{ bsonType: "double" }` in the collection's `$jsonSchema` validator.
- [ ] The `Float` codec ID (`mongo/double@1`) comes from the Mongo target/adapter descriptor's `pslScalarTypeDescriptors`, not from a hardcoded map in the authoring layer.

## Enriched `ContractSourceContext`

- [ ] `ContractSourceContext` carries `pslScalarTypeDescriptors`, `authoringContributions`, `codecLookup`, `controlMutationDefaults`, and `composedExtensionPacks`.
- [ ] The CLI's `executeContractEmit` builds the `ControlStack` and assembles all contributions *before* calling the contract source provider.
- [ ] The contract source provider receives the fully assembled context.

## Framework-level PSL contribution assembly

- [ ] `ComponentMetadata` has optional `pslScalarTypeDescriptors` and `controlMutationDefaults` fields.
- [ ] `createControlStack` assembles scalar type descriptors and mutation defaults from all component descriptors with duplicate detection.
- [ ] The Mongo adapter declares `pslScalarTypeDescriptors` including `Float` → `mongo/double@1`.
- [ ] The Postgres adapter declares `pslScalarTypeDescriptors` and `controlMutationDefaults` using the new framework-level fields instead of the SQL-specific `SqlControlStaticContributions` hooks.
- [ ] Mutation default types (`DefaultFunctionRegistryEntry`, `MutationDefaultGeneratorDescriptor`) live at the framework level.

## Elimination of duplicated/hardcoded contributions

- [ ] `createMongoScalarTypeDescriptors()` in `scalar-type-descriptors.ts` is deleted.
- [ ] `CODEC_TO_BSON_TYPE` in `derive-json-schema.ts` is deleted. `deriveJsonSchema` derives BSON types from the codec lookup.
- [ ] SQL's `PslScalarTypeDescriptor` type (carrying `nativeType`) is eliminated. Native type is derived from the codec.
- [ ] `SqlControlStaticContributions` interface is eliminated.
- [ ] `assemblePslInterpretationContributions()` and `assembleControlMutationDefaultContributions()` are replaced by framework-level assembly.

## Provider and config simplification

- [ ] `prismaContract()` reads all contributions from `ContractSourceContext`. Options for `scalarTypeDescriptors`, `authoringContributions`, and `controlMutationDefaults` are removed.
- [ ] `mongoContract()` reads scalar type descriptors from `ContractSourceContext`. The `scalarTypeDescriptors` option is removed.
- [ ] `examples/prisma-next-demo/prisma-next.config.ts` does not call assembly functions or pass contributions to the contract source.
- [ ] `examples/retail-store/prisma-next.config.ts` does not manually extend scalar type descriptors.

# Other Considerations

## Security

Not applicable — this is a build-time authoring/planning change with no runtime or network impact.

## Cost

No cost impact — no new infrastructure or services.

## Observability

Not applicable — no runtime behavior changes.

## Data Protection

Not applicable — no user data handling changes.

## Analytics

Not applicable.

# References

- [Linear issue TML-2247](https://linear.app/prisma-company/issue/TML-2247/migration-planner-bugs-variant-collections-and-float-type-fl-091011)
- [Architecture Overview](../../docs/Architecture%20Overview.md)
- [Migration System subsystem doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- [MongoDB Family subsystem doc](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md)
- [Next steps plan](../../docs/planning/mongo-target/next-steps.md) — Area 3

### Key source files

| File | Role |
|---|---|
| `packages/1-framework/1-core/config/src/contract-source-types.ts` | `ContractSourceContext` (needs enrichment) |
| `packages/1-framework/1-core/framework-components/src/framework-components.ts` | `ComponentMetadata` (needs `pslScalarTypeDescriptors`) |
| `packages/1-framework/1-core/framework-components/src/control-stack.ts` | `ControlStack` assembly (needs scalar type assembly) |
| `packages/1-framework/1-core/framework-components/src/codec-types.ts` | `Codec` interface — `targetTypes` provides native/BSON types |
| `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts` | CLI emit (builds context) |
| `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts` | Mongo PSL interpreter (FL-09, FL-10) |
| `packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts` | `$jsonSchema` derivation (FL-10, FL-11; `CODEC_TO_BSON_TYPE` to delete) |
| `packages/2-mongo-family/2-authoring/contract-psl/src/scalar-type-descriptors.ts` | Hardcoded Mongo scalar type map (to delete) |
| `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts` | Mongo contract source provider (reads from context) |
| `packages/2-sql/2-authoring/contract-psl/src/provider.ts` | SQL contract source provider (reads from context) |
| `packages/2-sql/9-family/src/core/assembly.ts` | SQL assembly (scalar type part replaced by framework) |
| `packages/2-sql/9-family/src/core/migrations/types.ts` | `PslScalarTypeDescriptor`, `SqlControlStaticContributions` (to eliminate) |
| `packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts` | Mutation default types (to lift to framework level) |
| `packages/3-targets/6-adapters/postgres/src/exports/control.ts` | Postgres adapter descriptor (contributes scalar types + mutation defaults) |
| `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts` | Postgres scalar type + mutation default descriptors |
| `packages/3-mongo-target/2-mongo-adapter/src/core/mongo-planner.ts` | Mongo migration planner (no changes expected) |

# Resolved Questions

1. **SQL `typeRef` and `typeParams` on scalar type descriptors.** Verified: the Postgres adapter's base scalar type entries (`postgresPslScalarTypeDescriptors`) never set `typeRef` or `typeParams` — they only provide `{ codecId, nativeType }`. The `typeRef`/`typeParams` are produced by other resolution paths: enum declarations, `@db.*` native type attributes, type constructors, and mutation default generator descriptors. Safe to remove from the scalar type descriptor type. The internal `ColumnDescriptor` type (output of all resolution paths) retains them.

2. **`controlMutationDefaults` at framework level.** Mutation defaults are not family-specific — the concept applies to both SQL and Mongo. The types (`DefaultFunctionRegistryEntry`, `MutationDefaultGeneratorDescriptor`) are family-agnostic (they reference codec IDs). Move them to the framework level with the full typed interface.

3. **Backward compatibility of provider APIs.** No backward compatibility concern. Remove contribution options from provider interfaces and update all consumers.
