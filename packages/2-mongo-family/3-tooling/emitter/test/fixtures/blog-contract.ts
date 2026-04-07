import type { Contract } from '@prisma-next/contract/types';

export const blogContract: Contract = {
  targetFamily: 'mongo',
  target: 'mongo',
  profileHash: 'sha256:test',
  roots: {
    users: 'User',
    posts: 'Post',
  },
  models: {
    User: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        bio: { nullable: true, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      },
      relations: {
        posts: {
          to: 'Post',
          cardinality: '1:N',
          on: { localFields: ['_id'], targetFields: ['authorId'] },
        },
      },
      storage: { collection: 'users' },
    },
    Post: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        title: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        content: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        authorId: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
      },
      relations: {
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: { localFields: ['authorId'], targetFields: ['_id'] },
        },
        comments: {
          to: 'Comment',
          cardinality: '1:N',
        },
      },
      storage: {
        collection: 'posts',
        relations: { comments: { field: 'comments' } },
      },
    },
    Comment: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        text: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        createdAt: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/date@1' } },
      },
      relations: {},
      storage: {},
      owner: 'Post',
    },
  },
  storage: {
    storageHash: 'sha256:test',
    collections: {
      users: {},
      posts: {},
    },
  },
  extensionPacks: {},
  capabilities: {},
  meta: {},
};
