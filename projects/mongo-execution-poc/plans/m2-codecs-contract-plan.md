# M2: Codecs and Contract Types

## Summary

Build Mongo codecs and an independent `MongoContract` type that is structurally symmetric with `SqlContract`, then prove the contract carries enough information for row type inference by executing a contract-driven query plan against a real MongoDB instance. This is the critical architectural bottleneck for the PoC — all subsequent work (typed query surface, ORM client, cross-family validation) depends on the contract shape.

**Spec:** `projects/mongo-execution-poc/spec.md` (M2 requirements under "Codecs" and "Contract types")

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives execution |

## Milestones

### Milestone 1: Codec infrastructure and base codecs

Build the codec interface, registry, and base Mongo codecs. These provide the `CodecTypes` type map that the contract's type system references.

**Design context:** SQL codecs live in `2-sql/4-lanes/relational-core/src/ast/codec-types.ts`. They define a `Codec` interface (`id`, `targetTypes`, `decode`, `encode`), a `CodecRegistry` (lookup by id or by scalar), and a `defineCodecs()` builder that derives `CodecTypes` (codec id → `{ input, output }`). We build a parallel set in `2-mongo/`, keeping the shapes as close as possible.

Unlike SQL, the MongoDB Node.js driver handles BSON→JS conversion natively. Mongo codecs primarily serve:
- **Type-level mapping** — codec id → TS type for row inference
- **Identity normalization** — most base types are identity transforms
- **ObjectId handling** — the one type that needs a representation decision
- **Extension point** — future user-defined or extension types

**Tasks:**

- [ ] **Define `MongoCodec` interface** — parallel to SQL's `Codec<Id, TWire, TJs>`: `id` (namespaced, e.g. `'mongo/string@1'`), `targetTypes` (BSON type names this codec handles), `decode(wire): js`, optional `encode(js): wire`. No `paramsSchema` / `init` / `meta` for now — those are extension concerns. Lives in `2-mongo/1-core/`.
- [ ] **Define `MongoCodecRegistry`** — parallel to SQL's `CodecRegistry`: `get(id)`, `has(id)`, `register(codec)`, iterable. No `getByScalar` / `getDefaultCodec` — those exist for the SQL emitter's scalar-to-codec resolution; we don't need them yet. Lives in `2-mongo/1-core/`.
- [ ] **Decide ObjectId representation** — `string` (simpler, JSON-friendly, consistent with contract.json serialization) vs. `mongodb.ObjectId` class (preserves BSON identity, richer comparison semantics). Document the decision and rationale. This affects every downstream consumer.
- [ ] **Implement base Mongo codecs:**
  - `mongo/objectId@1` — decode/encode per ObjectId decision above
  - `mongo/string@1` — identity (`string → string`)
  - `mongo/int32@1` — identity (`number → number`)
  - `mongo/boolean@1` — identity (`boolean → boolean`)
  - `mongo/date@1` — identity (`Date → Date`)
- [ ] **Define `MongoCodecTypes` extraction** — a type utility that derives `{ readonly 'mongo/string@1': { readonly output: string }; ... }` from the codec definitions, parallel to SQL's `ExtractCodecTypes`. This is the type-level bridge between codec IDs in the contract and TypeScript types.
- [ ] **Unit tests: codec round-trips** — for each base codec, test `decode(encode(value)) === value` and `encode(decode(wire)) === wire`. For ObjectId, test the chosen representation (string normalization or ObjectId class preservation).

### Milestone 2: MongoContract type

Define `MongoContract` as an independent type, structurally parallel to `SqlContract`. Do NOT import from `2-sql` or extend `ContractBase`. Build the Mongo equivalent with the same structural patterns, substituting Mongo-specific storage concepts (collections for tables, fields for columns, embedded documents).

**Design context — SQL contract structure to mirror:**

| SQL concept | SQL type | Mongo equivalent | Mongo type |
|---|---|---|---|
| `SqlStorage` → `tables` | `Record<string, StorageTable>` | `MongoStorage` → `collections` | `Record<string, MongoStorageCollection>` |
| `StorageTable` → `columns` | `Record<string, StorageColumn>` | `MongoStorageCollection` → `fields` | `Record<string, MongoStorageField>` |
| `StorageColumn` | `{ nativeType, codecId, nullable }` | `MongoStorageField` | `{ nativeType, codecId, nullable }` (same shape) |
| `ModelDefinition` → `storage.table` | `string` (table name) | `MongoModelDefinition` → `storage.collection` | `string` (collection name) |
| `ModelField` → `column` | `string` (column name) | `MongoModelField` → `field` | `string` (storage field name) |
| `SqlMappings` | `modelToTable`, `fieldToColumn`, etc. | `MongoMappings` | `modelToCollection`, `fieldToStorageField`, etc. |
| `SqlContract` | `ContractBase & { storage, models, relations, mappings }` | `MongoContract` | independent type with same top-level shape |
| `TypeMaps` | `{ codecTypes, operationTypes }` | `MongoTypeMaps` | `{ codecTypes }` (operations deferred) |
| `ContractWithTypeMaps<C, T>` | phantom key attaching TypeMaps | `MongoContractWithTypeMaps<C, T>` | same phantom key pattern |

**New concept — embedded documents:** SQL has no equivalent. `MongoStorageField` needs an optional `embedded` property pointing to another field set. This is the primary structural divergence.

**Tasks:**

- [ ] **Define `MongoStorageField`** — `{ nativeType: string; codecId: string; nullable: boolean; embedded?: MongoStorageCollection }`. The `embedded` property is the Mongo-specific addition: when present, the field is an embedded document (or array of documents) whose structure is described by the nested collection. Lives in `2-mongo/1-core/`.
- [ ] **Define `MongoStorageCollection`** — `{ fields: Record<string, MongoStorageField> }`. Parallel to SQL's `StorageTable` with `columns`. No primaryKey/uniques/indexes/foreignKeys for now (PoC scope). Lives in `2-mongo/1-core/`.
- [ ] **Define `MongoStorage`** — `{ collections: Record<string, MongoStorageCollection> }`. Parallel to SQL's `SqlStorage` with `tables`.
- [ ] **Define `MongoModelField`** — `{ field: string }`. Parallel to SQL's `ModelField` with `{ column: string }`. The `field` property names the storage field in the collection.
- [ ] **Define `MongoModelDefinition`** — `{ storage: { collection: string }; fields: Record<string, MongoModelField>; relations: Record<string, unknown> }`. Parallel to SQL's `ModelDefinition`.
- [ ] **Define `MongoMappings`** — `{ modelToCollection, collectionToModel, fieldToStorageField, storageFieldToField }`. Parallel to SQL's `SqlMappings`.
- [ ] **Define `MongoContract`** — top-level type combining: `schemaVersion`, `target`, `targetFamily`, `storageHash`, hashes, `capabilities`, `storage: MongoStorage`, `models`, `relations`, `mappings: MongoMappings`. Independent of `ContractBase` but with the same top-level fields.
- [ ] **Define `MongoTypeMaps`** — `{ readonly codecTypes: TCodecTypes }`. Parallel to SQL's `TypeMaps` but without `operationTypes` / `queryOperationTypes` for now.
- [ ] **Define `MongoContractWithTypeMaps<C, T>`** — phantom key pattern attaching `MongoTypeMaps` to the contract type, parallel to SQL's `ContractWithTypeMaps`.
- [ ] **Update `MongoLoweringContext`** — currently references `DocumentContract` from `1-framework`. Update to reference `MongoContract` from `2-mongo/1-core/`.

### Milestone 3: Hand-crafted contract artifacts

Write `contract.d.ts` and `contract.json` for the blog platform example schema. These are the concrete test fixtures that prove the contract type structure works.

**Schema to encode** (from `docs/planning/mongo-target/1-design-docs/example-schemas.md`):
- **Users** collection: `_id` (ObjectId), `name` (string), `email` (string), `bio` (string?), `profile` (embedded: `avatarUrl`, `website`, `social` (embedded: `twitter`, `github`)), `createdAt` (Date)
- **Posts** collection: `_id` (ObjectId), `title` (string), `slug` (string), `content` (string), `status` (string), `authorId` (ObjectId), `tags` (string[]), `viewCount` (int32), `comments` (embedded array: `authorId`, `text`, `createdAt`), `publishedAt` (Date?), `updatedAt` (Date)
- **Relations**: User → Posts (via `authorId`), referenced (not embedded)

**Tasks:**

- [ ] **Hand-craft `contract.d.ts`** — define the fully-typed contract for the blog platform. Export `MongoCodecTypes`, `MongoTypeMaps`, `Contract` (as `MongoContractWithTypeMaps<MongoContract<...>, MongoTypeMaps>`). Include all models, storage collections, embedded document structures, and mappings. Lives in test fixtures alongside the integration test (e.g. `2-mongo/5-runtime/test/fixtures/`).
- [ ] **Hand-craft `contract.json`** — runtime contract data matching the `.d.ts` types. Collection names, field definitions with codec IDs, embedded document descriptors. Same fixture location.

### Milestone 4: Integration test and symmetry documentation

Prove the contract works by building a contract-driven query plan with inferred Row type and executing it. Then document what's symmetric and what diverges.

**Tasks:**

- [ ] **Integration test: contract-driven plan with row type inference** — import the hand-crafted `contract.d.ts` types and `contract.json` data. Look up the `users` collection from the contract. Construct a `MongoQueryPlan` where the `Row` type is derived from the contract's model + codec types (NOT manually specified). Execute through `MongoRuntime` → `MongoDriver` → `mongodb-memory-server`. Assert that the returned rows have the correct structure and that the test compiles with the inferred `Row` type (compilation is the type-level proof). Lives in `2-mongo/5-runtime/test/` or a new integration test location.
- [ ] **Document structural symmetry** — create a convergence/divergence table comparing `MongoContract` and `SqlContract` at each level (storage, models, fields, mappings, type maps, phantom key pattern). Note what's identical, what's renamed, and what's structurally new (embedded documents). This becomes the input for the future `ContractBase` extraction step. Lives in `docs/planning/mongo-target/1-design-docs/`.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Mongo codec registry follows SQL registry shape (get by id, register, iterate) | Unit | M1 | Structural test |
| Base codecs encode/decode round-trip correctly | Unit | M1 | `objectId`, `string`, `int32`, `boolean`, `date` |
| ObjectId representation decision documented | Manual | M1 | Decision record |
| `MongoContract` type compiles with blog platform schema | Compilation | M3 | `contract.d.ts` compiles |
| `contract.json` structure matches `contract.d.ts` types | Manual | M3 | Review |
| Contract includes embedded documents (Profile, Comments) | Compilation | M3 | Embedded field types in `.d.ts` |
| Contract includes referenced relations (User→Posts) | Compilation | M3 | Relation types in `.d.ts` |
| Contract-driven plan executes with `Row` inferred from contract | Integration | M4 | Hand-built plan, `mongodb-memory-server`, compilation proves types |
| `MongoContract` structural symmetry with `SqlContract` documented | Manual | M4 | Convergence/divergence table |
| No `2-mongo` imports from `2-sql/*` or `3-extensions/*` | Automated | M4 | `pnpm lint:deps` (or manual grep) |

## Open Items

- **ObjectId representation** — carried forward from the project spec. Must be resolved in M1 before defining the `mongo/objectId@1` codec. Recommendation: start with `string` (simpler, JSON-friendly, no driver dependency in contract types) and revisit if it causes problems.
- **Codec package location** — should codecs live in `2-mongo/1-core/` (alongside the contract types that reference them) or a separate `2-mongo/2-codecs/` package? SQL codecs are in `2-sql/4-lanes/relational-core/` which is deep in the stack. For the PoC, `1-core/` is simpler.
- **Embedded document arrays** — the blog platform has `comments: Comment[]` (array of embedded documents). `MongoStorageField` needs to distinguish between a single embedded document and an array of them. Options: `embedded` + `array: boolean`, or separate `embeddedArray` property, or use `FieldType.items` from the framework. Resolve during M2 implementation.
- **Row type inference mechanism** — the exact TypeScript utility type that extracts `Row` from `MongoContract` + `MongoCodecTypes` given a collection name. SQL does this through the `models[modelName].fields[fieldName].column` → `storage.tables[table].columns[column].codecId` → `CodecTypes[codecId].output` chain. The Mongo equivalent is `models[modelName].fields[fieldName].field` → `storage.collections[collection].fields[field].codecId` → `MongoCodecTypes[codecId].output`. The integration test (M4) will prove this chain works.
- **`MongoLoweringContext` update scope** — updating `MongoLoweringContext` to reference `MongoContract` instead of `DocumentContract` may require updating the adapter and runtime. Keep changes minimal — the adapter still ignores the contract during lowering for now.

## Decisions

Inherited from the project plan:

- **Codecs first** — build the codec registry before the contract type, since `CodecTypes` are the foundation.
- **Independent `MongoContract`** — do not extend `ContractBase` or import from `2-sql`. Build independently, keep structurally parallel.
- **Structural symmetry is a functional requirement** — same patterns for models → fields → codec IDs → CodecTypes, storage mappings.
