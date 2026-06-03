import { computeProfileHash, computeStorageHash } from '@prisma-next/contract/hashing';
import { crossRef } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildMongoNamespace,
  MongoCollection,
  type MongoContract,
  MongoIndex,
  MongoStorage,
} from '@prisma-next/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@prisma-next/mongo-contract/canonicalization-hooks';

const scalarObjectId = {
  nullable: false as const,
  type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
};

const scalarString = {
  nullable: false as const,
  type: { kind: 'scalar' as const, codecId: 'mongo/string@1' },
};

function collectionIndex(
  fields: Record<string, 1 | -1>,
  options?: { readonly unique?: boolean },
): MongoIndex {
  return new MongoIndex({
    keys: Object.entries(fields).map(([field, direction]) => ({ field, direction })),
    ...options,
  });
}

const collections = {
  catalog: new MongoCollection({
    control: 'managed',
    indexes: [collectionIndex({ sku: 1 }, { unique: true })],
  }),
  audit_log: new MongoCollection({
    control: 'tolerated',
    indexes: [collectionIndex({ ts: 1 })],
  }),
  auth_users: new MongoCollection({
    control: 'external',
    indexes: [collectionIndex({ email: 1 }, { unique: true })],
  }),
  legacy_jobs: new MongoCollection({
    control: 'observed',
    indexes: [collectionIndex({ status: 1 })],
  }),
};

const capabilities: Record<string, Record<string, boolean>> = {};

const storageBody = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      collections,
    },
  },
};

const storageHash = computeStorageHash({
  target: 'mongo',
  targetFamily: 'mongo',
  storage: storageBody,
  ...mongoContractCanonicalizationHooks,
});

export const contract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: {
    Catalog: crossRef('Catalog'),
    AuditLog: crossRef('AuditLog'),
    AuthUsers: crossRef('AuthUsers'),
    LegacyJobs: crossRef('LegacyJobs'),
  },
  domain: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        models: {
          Catalog: {
            fields: { _id: scalarObjectId, sku: scalarString },
            relations: {},
            storage: { collection: 'catalog' },
          },
          AuditLog: {
            fields: { _id: scalarObjectId, ts: scalarString },
            relations: {},
            storage: { collection: 'audit_log' },
          },
          AuthUsers: {
            fields: { _id: scalarObjectId, email: scalarString },
            relations: {},
            storage: { collection: 'auth_users' },
          },
          LegacyJobs: {
            fields: { _id: scalarObjectId, status: scalarString },
            relations: {},
            storage: { collection: 'legacy_jobs' },
          },
        },
      },
    },
  },
  storage: new MongoStorage({
    storageHash,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: buildMongoNamespace({
        id: UNBOUND_NAMESPACE_ID,
        collections,
      }),
    },
  }),
  capabilities,
  extensionPacks: {},
  profileHash: computeProfileHash({
    target: 'mongo',
    targetFamily: 'mongo',
    capabilities,
  }),
  meta: {},
} satisfies MongoContract;
