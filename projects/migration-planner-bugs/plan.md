# Migration Planner Bugs & Framework-Level PSL Contributions

## Summary

Fix three MongoDB migration planner bugs (spurious variant collections, incomplete polymorphic validators, missing Float type) and eliminate their root cause by lifting PSL contribution assembly (scalar type descriptors, mutation defaults, authoring contributions, codec lookup) to the framework level. After this work, `ContractSourceContext` carries all assembled contributions, both SQL and Mongo providers read from context, and user configs no longer perform manual assembly.

**Spec:** [spec.md](spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |

## Milestones

### Milestone 1: Framework-level PSL contribution assembly

Lift scalar type descriptors, mutation defaults, and codec lookup into the framework layer. This is the foundational work that unblocks everything else — the Mongo bug fixes, the SQL simplification, and the config cleanup all depend on contributions flowing through `ContractSourceContext`.

**Deliverable:** `ComponentMetadata` supports `pslScalarTypeDescriptors` and `controlMutationDefaults`; `ControlStack` assembles them; `ContractSourceContext` carries them; the CLI passes them to the contract source provider.

**Tasks:**

- [ ] **1.1** Add mutation default types to framework level — move `DefaultFunctionRegistryEntry`, `MutationDefaultGeneratorDescriptor`, `ControlMutationDefaults` (and related types like `DefaultFunctionLoweringContext`, `LoweredDefaultValue`, `LoweredDefaultResult`, `ParsedDefaultFunctionCall`) from `packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts` to `packages/1-framework/1-core/framework-components/`. Update all imports. The SQL authoring package re-exports or imports from the framework.
- [ ] **1.2** Add `pslScalarTypeDescriptors` and `controlMutationDefaults` to `ComponentMetadata` in `packages/1-framework/1-core/framework-components/src/framework-components.ts`. Both are optional fields.
- [ ] **1.3** Extend `createControlStack` in `packages/1-framework/1-core/framework-components/src/control-stack.ts` to assemble `pslScalarTypeDescriptors` (with duplicate detection) and `controlMutationDefaults` (with duplicate detection) from all component descriptors. Add unit tests in `control-stack.test.ts`.
- [ ] **1.4** Enrich `ContractSourceContext` in `packages/1-framework/1-core/config/src/contract-source-types.ts` with `pslScalarTypeDescriptors`, `authoringContributions`, `codecLookup`, and `controlMutationDefaults`.
- [ ] **1.5** Update CLI's `executeContractEmit` in `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts` to build the `ControlStack` *before* calling the contract source provider, and pass assembled contributions via `ContractSourceContext`.

### Milestone 2: Migrate SQL to framework contributions

Migrate the Postgres adapter and SQL provider to use the new framework-level contribution fields, eliminating `SqlControlStaticContributions`, `assemblePslInterpretationContributions()`, and the SQL-specific `PslScalarTypeDescriptor` type.

**Deliverable:** SQL contract authoring works end-to-end using framework-assembled contributions from context. No manual assembly in configs. All existing SQL tests pass.

**Tasks:**

- [ ] **2.1** Migrate Postgres adapter descriptor (`packages/3-targets/6-adapters/postgres/src/exports/control.ts`) from `SqlControlStaticContributions` hooks (`pslTypeDescriptors()`, `controlMutationDefaults()`) to `ComponentMetadata` fields (`pslScalarTypeDescriptors`, `controlMutationDefaults`). The Postgres scalar type descriptors become `Map<string, string>` (PSL name → codec ID only, no `nativeType`).
- [ ] **2.2** Update the SQL PSL interpreter (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`) and column resolution (`psl-column-resolution.ts`) to derive `nativeType` from `codecLookup.get(codecId).targetTypes[0]` instead of reading it from the scalar type descriptor. The interpreter must receive a `CodecLookup` (from context).
- [ ] **2.3** Update `prismaContract()` provider (`packages/2-sql/2-authoring/contract-psl/src/provider.ts`) to read `pslScalarTypeDescriptors`, `authoringContributions`, `controlMutationDefaults`, and `codecLookup` from `ContractSourceContext`. Remove these from `PrismaContractOptions`.
- [ ] **2.4** Eliminate `SqlControlStaticContributions` interface and `PslScalarTypeDescriptor` type from `packages/2-sql/9-family/src/core/migrations/types.ts`. Eliminate `assemblePslInterpretationContributions()` and `assembleControlMutationDefaultContributions()` from `packages/2-sql/9-family/src/core/assembly.ts`. Update all imports and consumers. Update `mutation-default-assembly.test.ts` to test via `createControlStack` instead.
- [ ] **2.5** Update all SQL interpreter tests to pass contributions via `ContractSourceContext` (or directly as the interpreter expects). Ensure all existing tests pass with the new flow.
- [ ] **2.6** Update SQL provider test (`packages/2-sql/2-authoring/contract-psl/test/provider.test.ts`) to verify the provider reads from context.

### Milestone 3: Fix Mongo interpreter bugs and wire Mongo to framework contributions

Fix FL-09 (spurious variant collections), FL-10 (incomplete validators), FL-11 (missing Float), and wire the Mongo provider to framework-level contributions.

**Deliverable:** Mongo interpreter produces correct contracts for polymorphic schemas with Float fields. All type knowledge comes from framework contributions. Hardcoded maps are deleted.

**Tasks:**

- [ ] **3.1** Write tests for FL-09 in `interpreter.polymorphism.test.ts`: a PSL schema with `@@discriminator` / `@@base` produces no separate collection entry for the variant model. Verify variant indexes merge into the base collection.
- [ ] **3.2** Write tests for FL-10 in `interpreter.polymorphism.test.ts` and `derive-json-schema.test.ts`: the base collection's `$jsonSchema` validator includes all base fields and uses `oneOf` for variant-specific fields. Verify a base with no variant-specific fields produces a simple validator.
- [ ] **3.3** Write tests for FL-11 in `derive-json-schema.test.ts`: a `Float` field produces `{ bsonType: "double" }` in the validator.
- [ ] **3.4** Add `pslScalarTypeDescriptors` to the Mongo adapter descriptor (`packages/3-mongo-target/2-mongo-adapter/src/`), including `Float` → `mongo/double@1` and all other Mongo scalar types currently in `createMongoScalarTypeDescriptors()`.
- [ ] **3.5** Fix FL-09: update the Mongo interpreter (`interpreter.ts`) so variant models sharing a base collection via `@@base` do not create separate `storage.collections` entries. Merge variant indexes into the base collection.
- [ ] **3.6** Fix FL-10: update `deriveJsonSchema` and the interpreter's validator-generation loop to compose a `oneOf`-based validator that includes base fields and discriminated variant branches.
- [ ] **3.7** Fix FL-11: update `deriveJsonSchema` to derive BSON types from `codecLookup.get(codecId).targetTypes[0]` instead of `CODEC_TO_BSON_TYPE`. Delete the `CODEC_TO_BSON_TYPE` map.
- [ ] **3.8** Update `mongoContract()` provider (`packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts`) to read `pslScalarTypeDescriptors` and `codecLookup` from `ContractSourceContext`. Remove the `scalarTypeDescriptors` option.
- [ ] **3.9** Delete `createMongoScalarTypeDescriptors()` and `scalar-type-descriptors.ts`.
- [ ] **3.10** Write/update Mongo planner tests to verify no `createCollection` for variant collection names when planning from a polymorphic contract.

### Milestone 4: Config simplification, cleanup, and close-out

Simplify example configs, verify all acceptance criteria, and finalize documentation.

**Deliverable:** Clean configs, all tests green, documentation updated.

**Tasks:**

- [ ] **4.1** Simplify `examples/prisma-next-demo/prisma-next.config.ts` — remove `assembleAuthoringContributions()`, `assemblePslInterpretationContributions()`, and all manual contribution passing to `prismaContract()`.
- [ ] **4.2** Simplify `examples/retail-store/prisma-next.config.ts` — remove manual `createMongoScalarTypeDescriptors()` extension with `Float`.
- [ ] **4.3** Update any other example configs or test fixtures that manually assemble contributions.
- [ ] **4.4** Remove `assembleAuthoringContributions` and `assemblePslInterpretationContributions` exports from `@prisma-next/family-sql/control` if no longer needed.
- [ ] **4.5** Run full test suite (`pnpm test:packages`) and fix any regressions.
- [ ] **4.6** Update architecture docs: update [MongoDB Family subsystem doc](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md) to reflect the new contribution flow. Update [Migration System doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md) if affected.
- [ ] **4.7** Verify all acceptance criteria from spec are met.
- [ ] **4.8** Delete `projects/migration-planner-bugs/` and migrate any long-lived documentation into `docs/`.

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| FL-09: No variant collection entry in `storage.collections` | Unit | 3.1 | `interpreter.polymorphism.test.ts` |
| FL-09: No `createCollection` for variant collections | Unit | 3.10 | Mongo planner test |
| FL-09: Variant indexes merged into base collection | Unit | 3.1 | `interpreter.polymorphism.test.ts` |
| FL-10: Base fields in validator `properties`/`required` | Unit | 3.2 | `derive-json-schema.test.ts` |
| FL-10: `oneOf` array with variant-specific fields | Unit | 3.2 | `derive-json-schema.test.ts` |
| FL-10: No `oneOf` when no variant-specific fields | Unit | 3.2 | `derive-json-schema.test.ts` |
| FL-11: Float produces `{ bsonType: "double" }` | Unit | 3.3 | `derive-json-schema.test.ts` |
| FL-11: Float codec from descriptor, not hardcoded | Unit | 3.4 | Verify descriptor declares Float |
| Context carries all contributions | Unit | 1.3, 1.5 | `control-stack.test.ts` + CLI test |
| `ComponentMetadata` has PSL contribution fields | Unit | 1.2, 1.3 | `control-stack.test.ts` |
| Duplicate detection in assembly | Unit | 1.3 | `control-stack.test.ts` |
| Mongo adapter declares Float scalar | Unit | 3.4 | Descriptor test |
| Postgres uses framework-level fields | Unit | 2.1 | Verify descriptor shape |
| Mutation default types at framework level | Unit | 1.1, 2.5 | Import verification in tests |
| `createMongoScalarTypeDescriptors()` deleted | Manual | 3.9 | File deletion verified |
| `CODEC_TO_BSON_TYPE` deleted | Manual | 3.7 | Code deletion verified |
| `PslScalarTypeDescriptor` eliminated | Manual | 2.4 | Type deletion verified |
| `SqlControlStaticContributions` eliminated | Manual | 2.4 | Interface deletion verified |
| `prismaContract()` reads from context | Unit | 2.3, 2.6 | Provider test |
| `mongoContract()` reads from context | Unit | 3.8 | Provider test |
| Demo config has no manual assembly | Manual | 4.1 | Config inspection |
| Retail-store config has no manual Float extension | Manual | 4.2 | Config inspection |
| Existing SQL tests pass | Integration | 2.5 | Full suite run in 4.5 |

## Open Items

- The `ColumnDescriptor` type in `psl-column-resolution.ts` retains `nativeType`, `typeRef`, and `typeParams` as output fields from various resolution paths (enums, `@db.*` attributes, type constructors, generators). Only the *input* scalar type descriptor is simplified to codec ID only.
- The `MutationDefaultGeneratorDescriptor.resolveGeneratedColumnDescriptor` return type still includes `nativeType`, `typeRef`, `typeParams` — these need to be derived from codec lookup in the same way as scalar descriptors (or kept as-is if the generator needs to override the base codec's native type).
- pgvector and other extension packs that contribute scalar type descriptors need to work with the new framework-level field. Verify via existing extension tests.
