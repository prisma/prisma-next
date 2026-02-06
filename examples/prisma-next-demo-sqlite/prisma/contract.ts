import type { CodecTypes } from '@prisma-next/adapter-sqlite/codec-types';
import { datetimeColumn, intColumn, textColumn } from '@prisma-next/adapter-sqlite/column-types';
import type { CodecTypes as SqliteVectorCodecTypes } from '@prisma-next/extension-sqlite-vector/codec-types';
import { vectorColumn } from '@prisma-next/extension-sqlite-vector/column-types';
import sqlitevector from '@prisma-next/extension-sqlite-vector/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import sqlitePack from '@prisma-next/target-sqlite/pack';

type AllCodecTypes = CodecTypes & SqliteVectorCodecTypes;

export const contract = defineContract<AllCodecTypes>()
  .target(sqlitePack)
  .table('user', (t) =>
    t
      .column('id', {
        type: intColumn,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('email', { type: textColumn, nullable: false })
      .column('createdAt', {
        type: datetimeColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', {
        type: intColumn,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('title', { type: textColumn, nullable: false })
      .column('userId', { type: intColumn, nullable: false })
      .column('createdAt', {
        type: datetimeColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
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
  .extensionPacks({ sqlitevector })
  .capabilities({
    sqlite: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'sqlitevector/cosine': true,
      'defaults.autoincrement': true,
      'defaults.now': true,
    },
  })
  .build();
