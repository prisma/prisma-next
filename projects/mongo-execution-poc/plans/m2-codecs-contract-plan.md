# M2: Codecs and Contract Types

## Summary

Build Mongo codecs and an independent `MongoContract` type that is structurally symmetric with `SqlContract`, then prove the contract carries enough information for row type inference by executing a contract-driven query plan against a real MongoDB instance. This is the critical architectural bottleneck for the PoC — all subsequent work (typed query surface, ORM client, cross-family validation) depends on the contract shape.

**Spec:** `projects/mongo-execution-poc/spec.md` (M2 requirements under "Codecs" and "Contract types")

## Collaborators


| Role  | Person/Team | Context          |
| ----- | ----------- | ---------------- |
| Maker | Will Madden | Drives execution |


## Milestones

### Milestone 1: Codec infrastructure and base codecs

Build the codec interface, registry, and base Mongo codecs. These provide the `CodecTypes` type map that the contract's type system references.

**Design context:** SQL codecs define how database values become TypeScript values. The key pieces are: a `Codec` interface (each codec has an `id` like `'pg/text@1'`, a `decode` function, and an optional `encode` function), a `CodecRegistry` (a runtime lookup table from codec ID to codec instance), and a `CodecTypes` type (a compile-time map from codec ID to `{ input, output }` TypeScript types). These live in `2-sql/4-lanes/relational-core/src/ast/codec-types.ts`. We build a parallel set in `2-mongo/`, keeping the shapes as close as possible.

Unlike SQL, the MongoDB Node.js driver already converts BSON wire values to JavaScript types (strings arrive as strings, numbers as numbers, Dates as Dates). SQL codecs must parse wire-protocol strings into JS values; Mongo codecs mostly pass values through unchanged. Their primary role here is:

- **Type-level mapping** — each codec ID (e.g. `'mongo/string@1'`) maps to a TypeScript type (e.g. `string`). The contract uses codec IDs on storage fields, and `CodecTypes` resolves them to TS types for row inference.
- **ObjectId handling** — the one base type that needs a representation decision (raw driver class vs. normalized string).
- **Extension point** — future user-defined or extension types (e.g. a geospatial type that serializes a JS class to a GeoJSON document).

**Tasks:**

- **Define `MongoCodec` interface** — each codec has a namespaced `id` (e.g. `'mongo/string@1'`), a list of BSON type names it handles (`targetTypes`), a `decode(wire): js` function, and an optional `encode(js): wire` function. Skip advanced features like `paramsSchema` / `init` / `meta` — those are for parameterized and extension codecs, out of scope. Lives in `2-mongo/1-core/`.
- **Define `MongoCodecRegistry`** — a runtime lookup table: `get(id)` returns a codec by its ID, `has(id)` checks existence, `register(codec)` adds one, and the registry is iterable. Skip `getByScalar` / `getDefaultCodec` — those exist for the SQL emitter to resolve native type names to codecs; we don't have an emitter yet. Lives in `2-mongo/1-core/`.
- **Decide ObjectId representation** — `string` (simpler, JSON-friendly, consistent with contract.json serialization) vs. `mongodb.ObjectId` class (preserves BSON identity, richer comparison semantics). Document the decision and rationale. This affects every downstream consumer.
- **Implement base Mongo codecs:**
  - `mongo/objectId@1` — decode/encode per ObjectId decision above
  - `mongo/string@1` — identity (`string → string`)
  - `mongo/int32@1` — identity (`number → number`)
  - `mongo/boolean@1` — identity (`boolean → boolean`)
  - `mongo/date@1` — identity (`Date → Date`)
- **Define `MongoCodecTypes` extraction** — a TypeScript utility type that, given the codec definitions, produces a map like `{ readonly 'mongo/string@1': { readonly output: string }; readonly 'mongo/int32@1': { readonly output: number }; ... }`. This is how the contract's codec IDs become TypeScript types: a storage field has `codecId: 'mongo/string@1'`, and `CodecTypes['mongo/string@1'].output` resolves to `string`.
- **Unit tests: codec round-trips** — for each base codec, test `decode(encode(value)) === value` and `encode(decode(wire)) === wire`. For ObjectId, test the chosen representation (string normalization or ObjectId class preservation).

### Milestone 2: MongoContract type

Define `MongoContract` as an independent type, structurally parallel to `SqlContract`. Do NOT import from `2-sql` or extend `ContractBase`. Build the Mongo equivalent following the same patterns — the idea is that later extraction of common elements should be mechanical (rename + move), not a redesign.

**How the SQL contract is structured (the pattern we're mirroring):**

An `SqlContract` has three layers: **storage** (what exists in the database — tables, columns, types), **models** (the domain abstraction — named models whose fields point at storage columns), and **mappings** (bidirectional name resolution between the two). Each storage column carries a `codecId` that links to `CodecTypes` for TypeScript type resolution.


| SQL concept                         | SQL type                                                  | Mongo equivalent                              | Mongo type                                       |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `SqlStorage` → `tables`             | `Record<string, StorageTable>`                            | `MongoStorage` → `collections`                | `Record<string, MongoStorageCollection>`         |
| `StorageTable` → `columns`          | `Record<string, StorageColumn>`                           | `MongoStorageCollection` → `fields`           | `Record<string, MongoStorageField>`              |
| `StorageColumn`                     | `{ nativeType, codecId, nullable }`                       | `MongoStorageField`                           | `{ nativeType, codecId, nullable }` (same shape) |
| `ModelDefinition` → `storage.table` | `string` (table name)                                     | `MongoModelDefinition` → `storage.collection` | `string` (collection name)                       |
| `ModelField` → `column`             | `string` (column name)                                    | `MongoModelField` → `field`                   | `string` (storage field name)                    |
| `SqlMappings`                       | `modelToTable`, `fieldToColumn`, etc.                     | `MongoMappings`                               | `modelToCollection`, `fieldToStorageField`, etc. |
| `SqlContract`                       | `ContractBase & { storage, models, relations, mappings }` | `MongoContract`                               | independent type with same top-level shape       |
| `TypeMaps`                          | `{ codecTypes, operationTypes }`                          | `MongoTypeMaps`                               | `{ codecTypes }` (operations deferred)           |
| `ContractWithTypeMaps<C, T>`        | phantom key attaching TypeMaps                            | `MongoContractWithTypeMaps<C, T>`             | same phantom key pattern                         |


**Tasks:**

- **Define `MongoStorageField`** — describes a single field in a collection: `{ nativeType, codecId, nullable }`, same core shape as SQL's `StorageColumn`. Lives in `2-mongo/1-core/`.
- **Define `MongoStorageCollection`** — describes a collection's structure: `{ fields: Record<string, MongoStorageField> }`. Equivalent to SQL's `StorageTable` with `columns`. Skip primaryKey/uniques/indexes/foreignKeys for now (PoC scope). Lives in `2-mongo/1-core/`.
- **Define `MongoStorage`** — the top-level storage container: `{ collections: Record<string, MongoStorageCollection> }`. Equivalent to SQL's `{ tables: Record<string, StorageTable> }`.
- **Define `MongoModelField`** — `{ field: string }` where `field` is the name of the storage field in the collection. Equivalent to SQL's `{ column: string }`.
- **Define `MongoModelDefinition`** — a domain model: which collection it maps to (`storage.collection`), its fields (each pointing at a storage field name), and its relations. Equivalent to SQL's `ModelDefinition`.
- **Define `MongoMappings`** — bidirectional name mappings: `modelToCollection` / `collectionToModel` and `fieldToStorageField` / `storageFieldToField`. Equivalent to SQL's `SqlMappings` (`modelToTable` / `fieldToColumn` etc.).
- **Define `MongoContract`** — the top-level contract type. Same fields as `ContractBase` (`schemaVersion`, `target`, `targetFamily`, hashes, `capabilities`) plus `storage: MongoStorage`, `models`, `relations`, `mappings: MongoMappings`. Built independently — does not import or extend `ContractBase`.
- **Define `MongoTypeMaps`** — `{ readonly codecTypes: TCodecTypes }`. This is how TypeScript types are attached to the contract. Equivalent to SQL's `TypeMaps`, but without `operationTypes` / `queryOperationTypes` for now (those are for extension operations like `pgvector.cosineDistance`).
- **Define `MongoContractWithTypeMaps<C, T>`** — a pattern that attaches `MongoTypeMaps` to the contract type via a phantom key (a branded property that exists only at the type level, not at runtime). This lets TypeScript extract the codec type mappings from a contract type without polluting the runtime JSON. Same mechanism as SQL's `ContractWithTypeMaps`.
- **Update `MongoLoweringContext`** — currently references `DocumentContract` (a stub type from `1-framework`). Update to reference `MongoContract` so the adapter receives the real contract type. The adapter still ignores the contract during lowering for now.

### Milestone 3: Hand-crafted contract artifacts

Write `contract.d.ts` and `contract.json` for the blog platform example schema. These are the concrete test fixtures that prove the contract type structure works.

**Schema to encode** (simplified from `docs/planning/mongo-target/1-design-docs/example-schemas.md`, flat fields only — embedded documents deferred):

- **Users** collection: `_id` (ObjectId), `name` (string), `email` (string), `bio` (string?), `createdAt` (Date)
- **Posts** collection: `_id` (ObjectId), `title` (string), `slug` (string), `content` (string), `status` (string), `authorId` (ObjectId), `viewCount` (int32), `publishedAt` (Date?), `updatedAt` (Date)
- **Relations**: User → Posts (via `authorId`), referenced

**Tasks:**

- **Hand-craft `contract.d.ts`** — write the TypeScript type definitions for the blog platform contract by hand (no emitter exists yet). This file declares the exact types for every collection, field, codec mapping, and model. It exports a `Contract` type that carries the full type information. Think of it as the "type blueprint" — if this compiles, the contract type structure works. Lives in test fixtures (e.g. `2-mongo/5-runtime/test/fixtures/`).
- **Hand-craft `contract.json`** — write the runtime JSON data that matches the `.d.ts` types. This is what gets loaded at runtime: collection names, field definitions with codec IDs, mappings. The `.d.ts` describes the shape; the `.json` is the actual data. Same fixture location.

### Milestone 4: Integration test and symmetry documentation

Prove the contract works by building a contract-driven query plan with inferred Row type and executing it. Then document what's symmetric and what diverges.

**Tasks:**

- **Integration test: contract-driven plan with row type inference** — this is the proof that the contract shape works. Import the hand-crafted contract types and JSON. Use them to construct a `MongoQueryPlan` for `find` on `users` where the `Row` type parameter is inferred from the contract (the test author does NOT manually write `MongoQueryPlan<{ _id: string; name: string; ... }>`; the type resolves automatically through the contract's model → field → codecId → CodecTypes chain). Execute the plan through the existing M1 pipeline against `mongodb-memory-server` and assert correct results. The test compiling successfully is itself the type-level proof. Lives in `2-mongo/5-runtime/test/` or a new integration test location.
- **Document structural symmetry** — write a comparison table showing where `MongoContract` and `SqlContract` converge (same patterns, just different names) and where they diverge (embedded documents, no foreign keys). This becomes the blueprint for the future extraction step: the converging parts become a shared `ContractBase`, the diverging parts stay family-specific. Lives in `docs/planning/mongo-target/1-design-docs/`.

## Test Coverage


| Acceptance Criterion                                                           | Test Type   | Milestone | Notes                                                              |
| ------------------------------------------------------------------------------ | ----------- | --------- | ------------------------------------------------------------------ |
| Mongo codec registry follows SQL registry shape (get by id, register, iterate) | Unit        | M1        | Structural test                                                    |
| Base codecs encode/decode round-trip correctly                                 | Unit        | M1        | `objectId`, `string`, `int32`, `boolean`, `date`                   |
| ObjectId representation decision documented                                    | Manual      | M1        | Decision record                                                    |
| `MongoContract` type compiles with blog platform schema                        | Compilation | M3        | `contract.d.ts` compiles                                           |
| `contract.json` structure matches `contract.d.ts` types                        | Manual      | M3        | Review                                                             |
| Contract includes referenced relations (User→Posts)                            | Compilation | M3        | Relation types in `.d.ts`                                          |
| Contract-driven plan executes with `Row` inferred from contract                | Integration | M4        | Hand-built plan, `mongodb-memory-server`, compilation proves types |
| `MongoContract` structural symmetry with `SqlContract` documented              | Manual      | M4        | Convergence/divergence table                                       |
| No `2-mongo` imports from `2-sql/*` or `3-extensions/*`                        | Automated   | M4        | `pnpm lint:deps` (or manual grep)                                  |


## Open Items

- **ObjectId representation** — must be resolved before defining the `mongo/objectId@1` codec. Two options: represent ObjectIds as plain `string` (simpler, JSON-friendly, no driver class dependency in contract types) or preserve the driver's `ObjectId` class (richer comparison semantics, preserves BSON identity). Recommendation: start with `string` and revisit if it causes problems.
- **Codec package location** — should codecs live in `2-mongo/1-core/` alongside the contract types, or in a separate `2-mongo/2-codecs/` package? SQL codecs ended up deep in the stack (`2-sql/4-lanes/relational-core/`), which is awkward. For the PoC, keeping everything in `1-core/` is simpler.
- **Row type inference mechanism** — we need a TypeScript utility type that, given a model name and the contract, produces the row type. In SQL, this chain is: model field → column name → storage column → `codecId` → `CodecTypes[codecId].output`. The Mongo equivalent would be: model field → storage field name → collection field → `codecId` → `MongoCodecTypes[codecId].output`. The integration test (M4) proves this chain works; the exact utility type will be designed during implementation.
- **`MongoLoweringContext` update scope** — changing `MongoLoweringContext` to reference `MongoContract` instead of the current `DocumentContract` may require minor updates to the adapter and runtime. Keep changes minimal — the adapter still ignores the contract during lowering for now.

## Decisions

Inherited from the project plan:

- **Codecs first** — build the codec registry before the contract type, since `CodecTypes` are the foundation.
- **Independent `MongoContract`** — do not extend `ContractBase` or import from `2-sql`. Build independently, keep structurally parallel.
- **Structural symmetry is a functional requirement** — same patterns for models → fields → codec IDs → CodecTypes, storage mappings.

