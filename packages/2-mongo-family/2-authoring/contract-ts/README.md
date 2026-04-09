# @prisma-next/mongo-contract-ts

Mongo-specific TypeScript contract authoring surface for Prisma Next.

## Purpose

This package provides the Mongo `contract.ts` DSL:

- `defineContract(...)`
- `field`, `index`, `model`, `rel`, and `valueObject` helpers
- callback and object-literal authoring forms

It builds canonical `MongoContract` values and validates them through `@prisma-next/mongo-contract`.

## Current Slice

The current implementation supports:

- aggregate roots and collection-backed models
- typed reference relations via `rel.belongsTo`, `rel.hasOne`, and `rel.hasMany`
- owned models via `owner` plus parent `storageRelations`
- discriminator-based polymorphism via `base`, `discriminator`, and `variants`
- top-level value objects referenced from fields
- Mongo collection index authoring via model-local `indexes`
- Mongo collection option authoring via model-local `collectionOptions`
- base Mongo codec helpers such as `field.objectId()`, `field.string()`, `field.double()`, `field.int32()`, `field.bool()`, `field.date()`, and `field.vector()`

This first slice does not yet cover union or dict authoring, or Mongo validator authoring.

## Exports

- `./contract-builder`: Mongo DSL entrypoint
- `./config-types`: config helper types

## Usage

```typescript
import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract, field, index, model, rel, valueObject } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    homeAddress: field.valueObject(Address).optional(),
  },
  indexes: [
    index({ _id: 1 }, { unique: true }),
  ],
  collectionOptions: {
    collation: { locale: 'en', strength: 2 },
  },
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    _id: field.objectId(),
    authorId: field.objectId(),
    title: field.string(),
  },
  relations: {
    author: rel.belongsTo(User, {
      from: 'authorId',
      to: User.ref('_id'),
    }),
  },
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  valueObjects: { Address },
  models: { User, Post },
});
```

## Notes

- Use `@prisma-next/family-mongo/pack` and `@prisma-next/target-mongo/pack` in authoring flows. They are pure pack refs and do not pull in control-plane runtime code.
- Runtime validation and row inference live in `@prisma-next/mongo-contract`.
- When you hoist reusable index or collection option objects, prefer `satisfies MongoIndexOptions` or `satisfies MongoCollectionOptions` from `@prisma-next/mongo-contract` so TypeScript validates the supported Mongo option surface.
