import { computeProfileHash, computeStorageHash } from '@prisma-next/contract/hashing';
import type { Contract } from '@prisma-next/contract/types';

// Hand-constructed because the Mongo authoring surface (PSL) doesn't yet
// support polymorphism, discriminators, or embedded documents — features
// this integration test exercises.

const target = 'mongo';
const targetFamily = 'mongo';
const capabilities = {};

const storageBody = {
  collections: {
    tasks: {},
    users: {},
  },
} as const;

const storage = {
  ...storageBody,
  storageHash: computeStorageHash({ target, targetFamily, storage: storageBody }),
} as const;

export const contract = {
  target,
  targetFamily,
  capabilities,
  extensionPacks: {},
  meta: {},
  profileHash: computeProfileHash({ target, targetFamily, capabilities }),
  roots: {
    tasks: 'Task',
    users: 'User',
  },
  storage,
  models: {
    Task: {
      storage: {
        collection: 'tasks',
        relations: { comments: { field: 'comments' } },
      },
      fields: {
        _id: { type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' }, nullable: false },
        title: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        type: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        assigneeId: {
          type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
          nullable: false,
        },
      },
      relations: {
        assignee: {
          to: 'User',
          cardinality: 'N:1' as const,
          on: { localFields: ['assigneeId'], targetFields: ['_id'] },
        },
        comments: { to: 'Comment', cardinality: '1:N' as const },
      },
      discriminator: { field: 'type' },
      variants: {
        Bug: { value: 'bug' },
        Feature: { value: 'feature' },
      },
    },
    Bug: {
      storage: { collection: 'tasks' },
      fields: {
        severity: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
      },
      relations: {},
      base: 'Task',
    },
    Feature: {
      storage: { collection: 'tasks' },
      fields: {
        priority: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        targetRelease: {
          type: { kind: 'scalar' as const, codecId: 'mongo/string@1' },
          nullable: false,
        },
      },
      relations: {},
      base: 'Task',
    },
    User: {
      storage: {
        collection: 'users',
        relations: { addresses: { field: 'addresses' } },
      },
      fields: {
        _id: { type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' }, nullable: false },
        name: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        email: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
      },
      relations: {
        addresses: { to: 'Address', cardinality: '1:N' as const },
      },
    },
    Address: {
      storage: {},
      fields: {
        street: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        city: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        zip: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
      },
      relations: {},
      owner: 'User',
    },
    Comment: {
      storage: {},
      fields: {
        _id: { type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' }, nullable: false },
        text: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        createdAt: { type: { kind: 'scalar' as const, codecId: 'mongo/date@1' }, nullable: false },
      },
      relations: {},
      owner: 'Task',
    },
  },
} satisfies Contract;
