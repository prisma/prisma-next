import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-query/contract-builder';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('userId', { type: 'pg/int4@1', nullable: false })
      .column('title', { type: 'pg/text@1', nullable: false })
      .column('published', { type: 'pg/bool@1', nullable: false })
      .primaryKey(['id']),
  )
  .table('comment', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('postId', { type: 'pg/int4@1', nullable: false })
      .column('content', { type: 'pg/text@1', nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .model('Post', 'post', (m) =>
    m.field('id', 'id').field('userId', 'userId').field('title', 'title'),
  )
  .model('Comment', 'comment', (m) =>
    m.field('id', 'id').field('postId', 'postId').field('content', 'content'),
  )
  .extensions({
    postgres: { version: '15.0.0' },
    pg: {},
  })
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
    },
  })
  .build();
