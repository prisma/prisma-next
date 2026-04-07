import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';

export type TestContract = MongoContract & {
  readonly models: {
    readonly Order: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly status: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly amount: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
        readonly customerId: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly notes: { readonly codecId: 'mongo/string@1'; readonly nullable: true };
        readonly tags: { readonly codecId: 'mongo/array@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'orders' };
    };
    readonly User: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly firstName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly lastName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly email: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'users' };
    };
  };
  readonly roots: { readonly orders: 'Order'; readonly users: 'User' };
};

export type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
  readonly 'mongo/array@1': { readonly output: unknown[] };
  readonly 'mongo/null@1': { readonly output: null };
};

export type TestTypeMaps = MongoTypeMaps<TestCodecTypes>;
export type TContract = MongoContractWithTypeMaps<TestContract, TestTypeMaps>;

export const testContractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { orders: 'Order', users: 'User' },
  models: {
    Order: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        status: { codecId: 'mongo/string@1', nullable: false },
        amount: { codecId: 'mongo/double@1', nullable: false },
        customerId: { codecId: 'mongo/objectId@1', nullable: false },
        notes: { codecId: 'mongo/string@1', nullable: true },
        tags: { codecId: 'mongo/array@1', nullable: false },
      },
      relations: {},
      storage: { collection: 'orders' },
    },
    User: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        firstName: { codecId: 'mongo/string@1', nullable: false },
        lastName: { codecId: 'mongo/string@1', nullable: false },
        email: { codecId: 'mongo/string@1', nullable: false },
      },
      relations: {},
      storage: { collection: 'users' },
    },
  },
  storage: { storageHash: 'test-hash', collections: { orders: {}, users: {} } },
  capabilities: {},
  extensionPacks: {},
  profileHash: 'test-profile',
  meta: {},
};
