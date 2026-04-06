# @prisma-next/mongo-contract

Contract types and validation for the MongoDB family.

## Responsibilities

- **Contract types**: `MongoContract`, `MongoContractWithTypeMaps`, `MongoTypeMaps`, `MongoModelDefinition`, `MongoStorage` — the typed contract representation for MongoDB targets
- **Type-level extraction**: `ExtractMongoTypeMaps`, `ExtractMongoCodecTypes`, `InferModelRow` — utility types for deriving codec types and row shapes from a contract
- **Contract validation**: `validateMongoContract()` — validates a JSON contract against the MongoDB schema using arktype, returning a `ValidatedMongoContract`
- **Storage validation**: `validateMongoStorage()` — validates the storage section of a MongoDB contract

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` (base `Contract`, `ContractModel`, `StorageBase` types and `validateContractDomain`)
  - `arktype` (runtime validation)
- **Depended on by**:
  - `@prisma-next/mongo-orm` (contract-typed queries and row inference)
  - `@prisma-next/mongo-emitter` (contract emission and validation)
  - `@prisma-next/mongo-contract-psl` (PSL-to-contract interpretation)
  - `@prisma-next/mongo-runtime` (contract-typed plan execution)
