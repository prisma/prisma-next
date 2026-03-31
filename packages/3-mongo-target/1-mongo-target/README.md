# @prisma-next/target-mongo

MongoDB target pack for Prisma Next.

## Responsibilities

- **Codec definitions**: Registers MongoDB-specific codecs (`objectId`, `string`, `date`, etc.) with their type mappings
- **Target pack assembly**: Exports the MongoDB target pack for use by the contract emitter and runtime

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-core` (codec types, contract types)
