import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
      .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('title', { type: 'pg/text@1', nullable: false })
      .column('userId', { type: 'pg/int4@1', nullable: false })
      .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
      .primaryKey(['id'])
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'post_userId_fkey'),
  )
  .model('User', 'user', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('createdAt', 'createdAt')
      .relation('posts', {
        toModel: 'Post',
        toTable: 'post',
        cardinality: '1:N',
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'post',
          childColumns: ['userId'],
        },
      }),
  )
  .model('Post', 'post', (m) =>
    m
      .field('id', 'id')
      .field('title', 'title')
      .field('userId', 'userId')
      .field('createdAt', 'createdAt')
      .relation('user', {
        toModel: 'User',
        toTable: 'user',
        cardinality: 'N:1',
        on: {
          parentTable: 'post',
          parentColumns: ['userId'],
          childTable: 'user',
          childColumns: ['id'],
        },
      }),
  )
  .extensions({
    postgres: {
      version: '15.0.0',
    },
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
