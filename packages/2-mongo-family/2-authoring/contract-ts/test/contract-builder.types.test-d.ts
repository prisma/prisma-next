import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  InferModelRow,
  MongoCollectionOptions,
  MongoIndexOptions,
} from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, index, model, valueObject } from '../src/contract-builder';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

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
    previousAddresses: field.valueObject(Address).many(),
  },
});

const contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { User },
  valueObjects: { Address },
});

type UserRow = InferModelRow<typeof contract, 'User'>;

test('contract roots stay specific', () => {
  expectTypeOf(contract.roots.users).toEqualTypeOf<'User'>();
});

test('value object rows flow through InferModelRow', () => {
  expectTypeOf<UserRow['_id']>().toEqualTypeOf<string>();
  expectTypeOf<UserRow['homeAddress']>().toEqualTypeOf<{
    street: string;
    zip: string | null;
  } | null>();
  expectTypeOf<UserRow['previousAddresses']>().toEqualTypeOf<
    {
      street: string;
      zip: string | null;
    }[]
  >();
});

test('index helper preserves literal Mongo index authoring', () => {
  const uniqueEmailIndex = index({ email: 1 }, { unique: true });

  expectTypeOf(uniqueEmailIndex.fields.email).toEqualTypeOf<1>();
  expectTypeOf(uniqueEmailIndex.options.unique).toEqualTypeOf<true>();
});

test('index helper accepts typed Mongo index options', () => {
  const searchablePostIndex = index(
    { title: 'text', location: '2dsphere' },
    {
      name: 'post_search_idx',
      hidden: true,
      default_language: 'english',
      collation: { locale: 'en', strength: 2 },
      wildcardProjection: { internalNotes: 0, title: 1 },
    },
  );

  expectTypeOf(searchablePostIndex.options.name).toEqualTypeOf<'post_search_idx'>();
  expectTypeOf(searchablePostIndex.options.hidden).toEqualTypeOf<true>();
  expectTypeOf(searchablePostIndex.options.default_language).toEqualTypeOf<'english'>();
  expectTypeOf(searchablePostIndex.options.collation.locale).toEqualTypeOf<'en'>();
  expectTypeOf(searchablePostIndex.options.collation.strength).toEqualTypeOf<2>();
  expectTypeOf(searchablePostIndex.options.wildcardProjection.internalNotes).toEqualTypeOf<0>();
});

test('model authoring accepts typed Mongo collection options', () => {
  model('Event', {
    collection: 'events',
    fields: {
      _id: field.objectId(),
      createdAt: field.date(),
    },
    collectionOptions: {
      capped: true,
      size: 4096,
      expireAfterSeconds: 3600,
      collation: { locale: 'en', strength: 2 },
      timeseries: { timeField: 'createdAt', granularity: 'hours' },
      changeStreamPreAndPostImages: { enabled: true },
      clusteredIndex: {
        name: '_id_',
        key: { _id: 1 },
        unique: true,
      },
    },
  });
});

test('Mongo option types reject unsupported authoring shapes', () => {
  // @ts-expect-error unknown Mongo index option
  const _invalidIndexOptions = { unsupported: true } satisfies MongoIndexOptions;
  _invalidIndexOptions;

  // @ts-expect-error expireAfterSeconds must be a number
  const _invalidTtlIndexOptions = { expireAfterSeconds: '3600' } satisfies MongoIndexOptions;
  _invalidTtlIndexOptions;

  // @ts-expect-error unknown Mongo collection option
  const _invalidCollectionOptionKey = { unsupported: true } satisfies MongoCollectionOptions;
  _invalidCollectionOptionKey;

  const _invalidCollectionOptionValue = {
    timeseries: {
      timeField: 'createdAt',
      // @ts-expect-error invalid timeseries granularity
      granularity: 'days',
    },
  } satisfies MongoCollectionOptions;
  _invalidCollectionOptionValue;
});
