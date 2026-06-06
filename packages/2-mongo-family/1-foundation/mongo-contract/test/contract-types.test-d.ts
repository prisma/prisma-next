import type { CrossReference, ProfileHashBase, StorageHashBase } from '@prisma-next/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  ExtractMongoFieldInputTypes,
  ExtractMongoFieldOutputTypes,
  InferModelRow,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '../src/contract-types';
import type { MongoCollection } from '../src/ir/mongo-collection';
import type { MongoCollectionOptionsAuthoringInput } from '../src/ir/mongo-collection-options';
import type { MongoIndexOptionsInput } from '../src/ir/mongo-index-options';

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
};

type TestFieldOutputTypes = {
  readonly User: { readonly age: number };
};

type TestFieldInputTypes = {
  readonly User: { readonly age: number };
};

type TestTypeMaps = MongoTypeMaps<TestCodecTypes>;

type ContractWithVO = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'sha256:test'>;
    readonly capabilities: Record<string, never>;
    readonly extensionPacks: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly users: CrossReference & { readonly model: 'User' } };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly User: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly homeAddress: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                };
                readonly workAddress: {
                  readonly nullable: true;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                };
                readonly previousAddresses: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                  readonly many: true;
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'users' };
            };
          };
          readonly valueObjects: {
            readonly Address: {
              readonly fields: {
                readonly street: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly city: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly zip: {
                  readonly nullable: true;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
            };
          };
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: { readonly users: MongoCollection } };
        };
      };
      readonly storageHash: StorageHashBase<'sha256:test-storage'>;
    };
  },
  TestTypeMaps
>;

type ExpectedAddress = {
  street: string;
  city: string;
  zip: string | null;
};

test('InferModelRow expands value object fields to nested object types', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['homeAddress']>().toEqualTypeOf<ExpectedAddress>();
});

test('InferModelRow handles nullable value object fields', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['workAddress']>().toEqualTypeOf<ExpectedAddress | null>();
});

test('InferModelRow handles many: true value object fields', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['previousAddresses']>().toEqualTypeOf<ExpectedAddress[]>();
});

test('InferModelRow still handles scalar fields alongside value objects', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['_id']>().toEqualTypeOf<string>();
});

test('MongoTypeMaps accepts a fieldOutputTypes parameter', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes>;
  expectTypeOf<TM['fieldOutputTypes']>().toEqualTypeOf<TestFieldOutputTypes>();
});

test('MongoTypeMaps defaults fieldOutputTypes to Record<string, Record<string, unknown>>', () => {
  type TM = MongoTypeMaps<TestCodecTypes>;
  expectTypeOf<TM['fieldOutputTypes']>().toEqualTypeOf<Record<string, Record<string, unknown>>>();
});

test('ExtractMongoFieldOutputTypes extracts fieldOutputTypes from contract', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes>;
  type C = MongoContractWithTypeMaps<
    {
      readonly target: 'mongo';
      readonly targetFamily: 'mongo';
      readonly profileHash: ProfileHashBase<'sha256:test'>;
      readonly capabilities: Record<string, never>;
      readonly extensionPacks: Record<string, never>;
      readonly meta: Record<string, never>;
      readonly roots: Record<string, never>;
      readonly domain: {
        readonly namespaces: Record<string, { readonly models: Record<string, never> }>;
      };
      readonly storage: {
        readonly namespaces: Record<
          string,
          { readonly id: string; readonly entries: { readonly collection: Record<string, never> } }
        >;
        readonly storageHash: StorageHashBase<'sha256:s'>;
      };
    },
    TM
  >;
  expectTypeOf<ExtractMongoFieldOutputTypes<C>>().toEqualTypeOf<TestFieldOutputTypes>();
});

test('MongoTypeMaps accepts a 3rd fieldInputTypes parameter', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
  expectTypeOf<TM['fieldInputTypes']>().toEqualTypeOf<TestFieldInputTypes>();
});

test('MongoTypeMaps defaults fieldInputTypes to Record<string, Record<string, unknown>>', () => {
  type TM = MongoTypeMaps<TestCodecTypes>;
  expectTypeOf<TM['fieldInputTypes']>().toEqualTypeOf<Record<string, Record<string, unknown>>>();
});

test('ExtractMongoFieldInputTypes extracts fieldInputTypes from contract', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
  type C = MongoContractWithTypeMaps<
    {
      readonly target: 'mongo';
      readonly targetFamily: 'mongo';
      readonly profileHash: ProfileHashBase<'sha256:test'>;
      readonly capabilities: Record<string, never>;
      readonly extensionPacks: Record<string, never>;
      readonly meta: Record<string, never>;
      readonly roots: Record<string, never>;
      readonly domain: {
        readonly namespaces: Record<string, { readonly models: Record<string, never> }>;
      };
      readonly storage: {
        readonly namespaces: Record<
          string,
          { readonly id: string; readonly entries: { readonly collection: Record<string, never> } }
        >;
        readonly storageHash: StorageHashBase<'sha256:s'>;
      };
    },
    TM
  >;
  expectTypeOf<ExtractMongoFieldInputTypes<C>>().toEqualTypeOf<TestFieldInputTypes>();
});

test('MongoTypeMaps with single param compiles', () => {
  type TM = MongoTypeMaps<TestCodecTypes>;
  expectTypeOf<TM['codecTypes']>().toEqualTypeOf<TestCodecTypes>();
  expectTypeOf<TM['fieldOutputTypes']>().toEqualTypeOf<Record<string, Record<string, unknown>>>();
  expectTypeOf<TM['fieldInputTypes']>().toEqualTypeOf<Record<string, Record<string, unknown>>>();
});

test('Mongo index and collection option input types stay specific', () => {
  const typedIndexOptions: MongoIndexOptionsInput = {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    wildcardProjection: { internal: 0, title: 1 },
  };
  const typedCollectionOptions: MongoCollectionOptionsAuthoringInput = {
    capped: true,
    collation: { locale: 'en', strength: 2 },
    timeseries: { timeField: 'createdAt', granularity: 'hours' },
    changeStreamPreAndPostImages: { enabled: true },
  };

  expectTypeOf(typedIndexOptions.collation).toEqualTypeOf<
    | import('../src/ir/mongo-collation-options').MongoCollationOptions
    | import('../src/ir/mongo-collation-options').MongoCollationOptionsInput
    | undefined
  >();
  expectTypeOf(typedCollectionOptions.timeseries?.granularity).toEqualTypeOf<
    'seconds' | 'minutes' | 'hours' | undefined
  >();
});

test('Mongo option input types reject unsupported keys', () => {
  // @ts-expect-error unknown Mongo index option
  const _invalidIndexOptions: MongoIndexOptionsInput = { unsupported: true };
  _invalidIndexOptions;

  // @ts-expect-error unknown Mongo collection option
  const _invalidCollectionOptions: MongoCollectionOptionsAuthoringInput = { unsupported: true };
  _invalidCollectionOptions;
});
