# @prisma-next/mongo-core

Core types and validation for Prisma Next MongoDB support.

## Responsibilities

- **Contract types**: `MongoContract`, `MongoModelDefinition`, `MongoRelation`, `MongoStorage`, and associated type helpers (`InferModelRow`, `ExtractMongoCodecTypes`)
- **Contract validation**: Three-layer validation pipeline — structural (Arktype), domain-agnostic (`validateContractDomain`), and Mongo-specific storage (`validateMongoStorage`) — composed by `validateMongoContract`
- **Codec registry**: Built-in MongoDB codecs (`objectId`, `string`, `date`, etc.) and the `MongoCodecDefinition` type
- **Query plan types**: `MongoQueryPlan`, `MongoCommand`, and lowering context types consumed by higher layers

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` (core contract types)
- **Depended on by**:
  - `@prisma-next/mongo-orm` (ORM client types and row inference)
  - `@prisma-next/mongo-runtime` (runtime executor)
  - `@prisma-next/target-mongo` (target pack)
  - `@prisma-next/adapter-mongo` (command lowering)
  - `@prisma-next/driver-mongo` (driver types)
