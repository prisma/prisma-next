import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-query/contract-builder';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('email', 'text', { nullable: false })
      .column('createdAt', 'timestamptz', { nullable: false })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('title', 'text', { nullable: false })
      .column('userId', 'int4', { nullable: false })
      .column('createdAt', 'timestamptz', { nullable: false })
      .primaryKey(['id'])
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'post_userId_fkey'),
  )
  .model('User', 'user', (m) =>
    m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
  )
  .model('Post', 'post', (m) =>
    m
      .field('id', 'id')
      .field('title', 'title')
      .field('userId', 'userId')
      .field('createdAt', 'createdAt'),
  )
  .extensions({
    postgres: {
      version: '15.0.0',
    },
    pg: {},
  })
  .build();
