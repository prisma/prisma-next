# ADR 179 — Unified contract representation

## At a glance

The contract has one canonical in-memory type, parameterized by family-specific storage:

```ts
interface Contract<Storage extends StorageBase, ModelStorage> {
  readonly target: string;
  readonly targetFamily: string;
  readonly roots: Record<string, string>;
  readonly models: Record<string, ContractModel<ModelStorage>>;
  readonly storage: Storage;                                     // ← family-controlled
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly extensionPacks?: Record<string, unknown>;
}

interface StorageBase {
  readonly storageHash: string;   // ← family computes this from its own storage representation
}

interface ContractModel<ModelStorage> {
  readonly fields: Record<string, DomainField>;         // ← framework-owned domain layer
  readonly relations: Record<string, DomainRelation>;   // ← framework-owned domain layer
  readonly storage: ModelStorage;                        // ← family-controlled per-model bridge
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, DomainVariantEntry>;
  readonly base?: string;
  readonly owner?: string;
}
```

The framework operates on the domain layer: `roots`, `fields`, `relations`, `discriminator`, `variants`, `base`, `owner`. These types (`DomainField`, `DomainRelation`, etc.) are family-agnostic and already live in the framework layer. The framework also reads `storage.storageHash` for verification, but does not interpret `storage` or `model.storage` beyond that.

Each family fills in the two generic parameters with its own storage types:

```ts
// SQL
type SqlContract = Contract<SqlStorage, SqlModelStorage>;

// Mongo
type MongoContract = Contract<MongoStorage, MongoModelStorage>;
```

This is the type that authoring surfaces produce, that the emitter serializes to `contract.json`, that the validator parses back, and that runtime consumers read. One type, used everywhere.

Here is the contract pipeline **today** — six representations, two round-trips through a storage-first bottleneck:

```mermaid
graph TD
  PSL(schema.psl) --> AST(PslDocumentAst)
  TS_STAGED(contract.ts — staged) --> SCI(StagedContractInput)
  TS_CHAIN(contract.ts — chain) --> CBS(ContractBuilderState)
  SCI --> SSCD(SqlSemanticContractDef)
  SSCD -->|lower| IR
  AST -->|interpret| IR
  CBS -->|.build| IR
  IR(ContractIR)
  IR -->|serialize| JSON(contract.json + contract.d.ts)
  JSON -->|parse + validate| SC(SqlContract)
  SC -->|reconstruct| DM(ContractBase + DomainModel)
  DM --> CONSUMERS(schema / sql / orm)
```

And **after** — authoring surfaces lower directly to `Contract`, which survives serialization unchanged:

```mermaid
graph TD
  PSL(schema.psl) --> AST(PslDocumentAst)
  TS(contract.ts — staged) --> SCI(StagedContractInput)
  AST -->|lower| C1
  SCI -->|lower| C1
  C1("Contract‹Storage, ModelStorage›")
  C1 -->|serialize| JSON(contract.json + contract.d.ts)
  JSON -->|parse + validate| C2("Contract‹Storage, ModelStorage›")
  C2 --> CONSUMERS(schema / sql / orm)
```

## The round-trip problem

A contract starts in the user's domain language. Whether authored in PSL or TypeScript, the user describes models, fields, and relations — application concepts.

The canonical intermediate representation (`ContractIR`) is storage-first. Its primary key is `storage.tables`. Models are a secondary section. Relations are a third top-level section keyed by table name. To get from authoring to `ContractIR`, the authoring surface must convert model-first data *down* to a storage-first layout.

The emitter serializes this storage-first IR to `contract.json`.

At runtime, consumers need model-first structure again. The ORM client needs to traverse models and relations. The SQL query builder needs field-to-column mappings scoped per model. So the validator reconstructs model-level types (`ContractBase`, `DomainModel`) from the storage-first layout.

The result is a round-trip: **model-first → storage-first → model-first**. Two intermediate representations exist solely to bridge this conversion:

- **SqlSemanticContractDefinition** — the staged TS authoring DSL produces model-first data, but can't emit it directly as the canonical form. So it builds this SQL-specific intermediate, then converts *down* to `ContractIR`. This type mirrors the ORM client's type definitions — both organize data around models, fields, and relations, because both describe the contract from the user's semantic perspective.
- **ContractBase / DomainModel** — runtime consumers need model-first structure that `ContractIR` doesn't provide. So validation reconstructs these types from the storage-first layout on the way back *up*.

Meanwhile, `MongoContract` — designed from scratch with [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)'s domain/storage separation — is already model-first. It doesn't use `ContractIR` at all. And `ContractIR` is nominally family-agnostic, but in practice it's just the SQL contract with `Record<string, unknown>` escape hatches.

Three independent efforts — the staged DSL, the ORM client, and the Mongo family — all converged on the same model-first shape. The canonical representation should be that shape, not the storage-first IR that everything converts to and from.

## Design principles

1. **Model-first organization.** Models are the primary key. A model's fields, relations, and storage bridge are co-located — a consumer reads `contract.models.User` and sees everything about that model without cross-referencing other sections.
2. **Family-parameterized storage.** The framework defines the domain layer (fields, relations, roots, variants, ownership). Each family defines its own storage types. The framework does not interpret storage contents beyond a `storageHash` on the top-level block.
3. **Same type before and after serialization.** The in-memory contract type and the JSON shape are structurally identical. No reconstruction, no conversion, no intermediate representations.
4. **Two-pass validation.** Domain validation (roots, relation targets, variant consistency, ownership) is framework-owned. Storage validation (table/column integrity, FK consistency, collection rules) is family-provided.
5. **Family-owned hashing.** Each family computes its own `storageHash` from its storage representation. The framework reads the hash for verification but does not compute or interpret it.

## Decision

Replace `ContractIR`, `SqlSemanticContractDefinition`, `ContractBase`, and `DomainModel` with the unified `Contract<Storage, ModelStorage>` type shown in [At a glance](#at-a-glance).

### Each family defines its storage types

A family provides two concrete types — one for the top-level storage block, one for the per-model bridge:

**SQL** — the top-level block holds the full database schema; the per-model bridge maps fields to columns:

```ts
type SqlStorage = StorageBase & {
  readonly tables: Record<string, SqlStorageTable>;
  readonly types?: Record<string, SqlStorageType>;
};

type SqlModelStorage = {
  readonly table: string;
  readonly fields: Record<string, { readonly column: string }>;
};

type SqlContract = Contract<SqlStorage, SqlModelStorage>;
```

This replaces three separate structures in `ContractIR`: the `storage.tables` section (now `contract.storage`), the top-level `models` section with mixed domain/storage fields (now `contract.models` with domain and `model.storage` cleanly separated), and the top-level `relations` section (now `model.relations` on each model).

It also eliminates the `mappings` section (`modelToTable`, `tableToModel`, `fieldToColumn`, `columnToField`). These are derivable from each model's `storage` bridge — `model.storage.table` gives you model→table, and `model.storage.fields` gives you field→column. Utility functions can provide O(1) lookups if needed.

**Mongo** — the top-level block holds collection metadata; the per-model bridge is just a collection name:

```ts
type MongoStorage = StorageBase & {
  readonly collections: Record<string, MongoStorageCollection>;
};

type MongoModelStorage = {
  readonly collection?: string;
  readonly relations?: Record<string, { readonly field: string }>;
};

type MongoContract = Contract<MongoStorage, MongoModelStorage>;
```

This is a minimal change for Mongo — `MongoContract` is already model-first with family-specific storage. The existing types adopt the generic parameters; the structure stays the same.

### Validation is two-pass, with family-provided storage validators

The framework provides a `validateContract` function that orchestrates two passes:

1. **Domain validation** (framework-owned): validates roots, relation targets, variant/base consistency, discriminators, ownership, and orphaned models. This already exists as `validateContractDomain()` in `packages/1-framework/1-core/shared/contract/src/validate-domain.ts`.

2. **Storage validation** (family-provided): the family passes a storage validator function that checks family-specific invariants. For Mongo this is `validateMongoStorage()`. SQL will provide an equivalent.

This pattern is already established in the Mongo family. `validateMongoContract()` follows exactly this sequence: structural parse → `validateContractDomain()` → `validateMongoStorage()` → build indices. The unified `validateContract` generalizes this into a framework-level function that accepts the family's storage validator as a parameter.

### Emission-time metadata

The unified contract type focuses on the domain and storage layers — the data that authoring surfaces produce and runtime consumers read. Several properties on the current `ContractBase` are added by the emitter during emission, not authored by the user:

- `schemaVersion` — contract format version, stamped by the emitter
- `storageHash` / `executionHash` / `profileHash` — computed hashes for verification
- `meta` — generator metadata
- `sources` — source file references
- `execution` — execution-time configuration (stored procedures, custom operations)

These properties are preserved in the emitted artifact. `storageHash` lives on `StorageBase` (family-computed). The remaining emission-time properties are orthogonal to the domain/storage restructuring — they're added to the contract during emission and are available at runtime, but they don't affect the core contract structure that this ADR addresses.

### What this does not replace

- **PslDocumentAst** — a syntax tree with source spans, fundamentally different from a resolved contract. Needed for diagnostics and error reporting.
- **StagedContractInput** — live builder objects with closures, lazy tokens, and type-level state. Non-serializable by design.
- **ContractBuilderState** — the old chain-builder's internal state. Being deprecated.

These are authoring-time representations. They exist because authoring ergonomics require live objects that a serializable contract type cannot provide. The boundary is clear: authoring representations are non-serializable and transient; the contract is serializable and canonical.

## What this replaces

| Current | Unified |
|---------|---------|
| `ContractIR` (storage-first, family-agnostic facade) | `Contract<Storage, ModelStorage>` |
| `SqlContract<S, M, R>` (SQL instantiation of ContractIR) | `Contract<SqlStorage, SqlModelStorage>` |
| `SqlSemanticContractDefinition` (authoring intermediate) | Authoring surfaces lower directly to `Contract<SqlStorage, SqlModelStorage>` |
| `DomainModel` / `ContractBase` (runtime reconstruction) | `ContractModel<ModelStorage>` — the domain layer is already there |
| `MongoContract` (already model-first) | `Contract<MongoStorage, MongoModelStorage>` — minimal change |
| `mappings` section in ContractIR | Eliminated — derivable from `model.storage` |
| Top-level `relations` section in ContractIR | Eliminated — relations live on each model |

## Consequences

### Benefits

- **One canonical type.** Authoring surfaces, the emitter, the validator, and the runtime all operate on the same type. No intermediate representations, no reconstruction.
- **Model-first everywhere.** A consumer reading `contract.models.User` sees fields, relations, and storage together — no cross-referencing three sections.
- **Family extensibility without framework knowledge.** Adding a new family means defining two storage types and a storage validator. The framework's domain validation, contract type, and runtime SPI work unchanged.
- **MongoContract already works this way.** Unifying means SQL adopts what Mongo has, not inventing something new.
- **No redundant data in the artifact.** Materialized mappings and the separate relations section are eliminated.

### Costs

- **SQL consumers must adapt.** Code that reads `contract.mappings.modelToTable` or `contract.relations[tableName]` must change. This affects the emitter, both builders, and the three query lane surfaces (schema, sql, orm). Utility functions can provide derived lookups where O(1) access is needed.
- **Emitter changes.** The SQL emitter currently produces `contract.json` in the storage-first ContractIR shape. It must be updated to produce the unified shape. The emitted `contract.d.ts` will also change to reflect model-first types — models carry their own relations and storage bridges instead of these being separate top-level sections.
- **Builder changes.** The staged lowering pipeline must produce `Contract<SqlStorage, SqlModelStorage>` instead of going through `SqlSemanticContractDefinition` → `ContractIR`.

### Migration

There are no external consumers of `contract.json`. The change is internal. Existing emitted contracts will be regenerated when the emitter is updated.

## Related

- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — designed the three-level structure (domain, bridge, storage) that this ADR formalizes as the canonical contract representation
- [ADR 178 — Staged contract DSL for SQL TS authoring](ADR%20178%20-%20Staged%20contract%20DSL%20for%20SQL%20TS%20authoring.md) — introduced `SqlSemanticContractDefinition` as an intermediate form; this ADR eliminates the need for it
- [Architecture Overview — Domain-first surfaces](../../Architecture%20Overview.md) — the guiding principle that user-facing APIs speak in application-domain terms
