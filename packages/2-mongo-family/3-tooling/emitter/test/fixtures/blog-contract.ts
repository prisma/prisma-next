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
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        name: { codecId: 'mongo/string@1', nullable: false },
        email: { codecId: 'mongo/string@1', nullable: false },
        bio: { codecId: 'mongo/string@1', nullable: true },
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
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        title: { codecId: 'mongo/string@1', nullable: false },
        content: { codecId: 'mongo/string@1', nullable: false },
        authorId: { codecId: 'mongo/objectId@1', nullable: false },
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
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        text: { codecId: 'mongo/string@1', nullable: false },
        createdAt: { codecId: 'mongo/date@1', nullable: false },
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
