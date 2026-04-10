# @prisma-next/target-mongo

MongoDB target pack for Prisma Next.

## Responsibilities

- **Target pack assembly**: Exports the MongoDB target pack for authoring and family composition
- **Target metadata**: Defines the stable Mongo target identity (`kind`, `familyId`, `targetId`, `version`, `capabilities`)
- **Codec type surface**: Exposes the base Mongo codec type map used by authoring-time type composition

## Entrypoints

- `./pack`: pure target pack ref used by `@prisma-next/family-mongo` and `@prisma-next/mongo-contract-ts`
- `./codec-types`: base Mongo codec type map

## Usage

```typescript
import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
});
```
