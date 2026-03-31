# @prisma-next/adapter-mongo

MongoDB adapter for Prisma Next. Lowers abstract MongoDB commands into wire-protocol documents.

## Responsibilities

- **Command lowering**: Converts `MongoCommand` instances (find, aggregate) into MongoDB wire-protocol documents
- **Codec application**: Applies codec transformations to query parameters and result documents

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-core` (command types, codec types)
