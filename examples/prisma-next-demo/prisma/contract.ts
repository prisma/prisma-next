import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  enumColumn,
  enumType,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

type AllCodecTypes = CodecTypes & PgVectorCodecTypes;

export const contract = defineContract<AllCodecTypes>()
  .target(postgresPack)
  .storageType('user_type', enumType('user_type', ['admin', 'user']))
  .table('user', (t) =>
    t
      .generated('id', uuidv4())
      .column('email', { type: textColumn, nullable: false })
      .column('createdAt', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('kind', {
        type: enumColumn('user_type', 'user_type'),
        nullable: false,
      })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .generated('id', uuidv4())
      .column('title', { type: textColumn, nullable: false })
      .column('userId', { type: textColumn, nullable: false })
      .column('createdAt', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('embedding', { type: vectorColumn, nullable: true })
      .primaryKey(['id'])
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, { name: 'post_userId_fkey' }),
  )
  .model('User', 'user', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('createdAt', 'createdAt')
      .field('kind', 'kind')
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
  .extensionPacks({ pgvector })
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'pgvector/cosine': true,
      'defaults.now': true,
    },
  })
  .build();
