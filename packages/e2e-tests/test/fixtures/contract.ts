import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-query/contract-builder';

const base = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('email', 'text', { nullable: false })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('userId', 'int4', { nullable: false })
      .column('title', 'text', { nullable: false })
      .primaryKey(['id']),
  )
  .table('comment', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('postId', 'int4', { nullable: false })
      .column('content', 'text', { nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .model('Post', 'post', (m) =>
    m.field('id', 'id').field('userId', 'userId').field('title', 'title'),
  )
  .model('Comment', 'comment', (m) =>
    m.field('id', 'id').field('postId', 'postId').field('content', 'content'),
  )
  .build();

export const contract = {
  ...base,
  extensions: {
    postgres: { version: '15.0.0' },
    pg: {},
  },
};
