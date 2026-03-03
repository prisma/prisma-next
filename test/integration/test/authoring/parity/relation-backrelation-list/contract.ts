import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) => t.column('id', { type: int4Column, nullable: false }).primaryKey(['id']))
  .table('post', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('userId', { type: int4Column, nullable: false })
      .foreignKey(
        ['userId'],
        { table: 'user', columns: ['id'] },
        { onDelete: 'cascade', onUpdate: 'cascade' },
      )
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) =>
    m.field('id', 'id').relation('posts', {
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
      .field('userId', 'userId')
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
  .build();
