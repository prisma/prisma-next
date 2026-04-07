import type { ProfileHashBase, StorageHashBase } from '@prisma-next/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  InferModelRow,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '../src/contract-types';

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
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
    readonly roots: { readonly users: 'User' };
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
    readonly storage: {
      readonly collections: { readonly users: Record<string, never> };
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
