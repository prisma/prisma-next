# @prisma-next/mongo-core

Core types and validation for Prisma Next MongoDB support.

## Responsibilities

- **Contract types**: `MongoContract`, `MongoModelDefinition`, `MongoModelStorage`, `MongoStorage`, and associated type helpers (`InferModelRow`, `ExtractMongoCodecTypes`). Domain-level types (`DomainField`, `DomainRelation`, etc.) are imported from `@prisma-next/contract/types`
- **Contract validation**: Three-layer validation pipeline — structural (Arktype), domain-agnostic (`validateContractDomain`), and Mongo-specific storage (`validateMongoStorage`) — composed by `validateMongoContract`
- **Codec registry**: Built-in MongoDB codecs (`objectId`, `string`, `date`, etc.) and the `MongoCodecDefinition` type
- **Codec types** (`@prisma-next/mongo-core/codec-types`): Compile-time `CodecTypes` mapping used by emitted `contract.d.ts` files for type inference
- **Command types**: Write commands (`InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `AggregateCommand`) and wire command equivalents
- **Adapter interface**: `MongoAdapter` — lowering context and command-to-wire-command conversion consumed by higher layers

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` (core contract types)
- **Depended on by**:
  - `@prisma-next/mongo-orm` (ORM client types and row inference)
  - `@prisma-next/mongo-runtime` (runtime executor)
  - `@prisma-next/target-mongo` (target pack)
  - `@prisma-next/adapter-mongo` (command lowering)
  - `@prisma-next/driver-mongo` (driver types)
