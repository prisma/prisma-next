import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

type AllCodecTypes = CodecTypes & PgVectorCodecTypes;

export const contract = defineContract<AllCodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .column('createdAt', { type: timestamptzColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('userId', { type: int4Column, nullable: false })
      .column('createdAt', { type: timestamptzColumn, nullable: false })
      .column('embedding', { type: vectorColumn, nullable: true })
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
      .field('embedding', 'embedding')
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
    pgvector: {},
  })
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'pgvector/cosine': true,
    },
  })
  .build();
