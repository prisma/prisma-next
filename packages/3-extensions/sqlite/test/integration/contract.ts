import type { CodecTypes } from '@prisma-next/adapter-sqlite/codec-types';
import {
  booleanColumn,
  datetimeColumn,
  integerColumn,
  jsonColumn,
  textColumn,
} from '@prisma-next/adapter-sqlite/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import sqlitePack from '@prisma-next/target-sqlite/pack';

export const contract = defineContract<CodecTypes>()
  .target(sqlitePack)
  .capabilities({
    sql: {
      lateral: false,
      returning: true,
      jsonAgg: true,
      enums: false,
      foreignKeys: true,
      autoIndexesForeignKeys: false,
    },
  })
  .table('users', (table) =>
    table
      .column('id', { type: integerColumn, nullable: false })
      .column('name', { type: textColumn, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .column('invited_by_id', { type: integerColumn, nullable: true })
      .primaryKey(['id']),
  )
  .table('posts', (table) =>
    table
      .column('id', { type: integerColumn, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('user_id', { type: integerColumn, nullable: false })
      .column('views', { type: integerColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('comments', (table) =>
    table
      .column('id', { type: integerColumn, nullable: false })
      .column('body', { type: textColumn, nullable: false })
      .column('post_id', { type: integerColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('profiles', (table) =>
    table
      .column('id', { type: integerColumn, nullable: false })
      .column('user_id', { type: integerColumn, nullable: false })
      .column('bio', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('typed_rows', (table) =>
    table
      .column('id', { type: integerColumn, nullable: false })
      .column('active', { type: booleanColumn, nullable: false })
      .column('created_at', { type: datetimeColumn, nullable: false })
      .column('metadata', { type: jsonColumn, nullable: true })
      .column('label', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'users', (model) =>
    model
      .field('id', 'id')
      .field('name', 'name')
      .field('email', 'email')
      .field('invitedById', 'invited_by_id')
      .relation('posts', {
        toModel: 'Post',
        toTable: 'posts',
        cardinality: '1:N',
        on: {
          parentTable: 'users',
          parentColumns: ['id'],
          childTable: 'posts',
          childColumns: ['user_id'],
        },
      })
      .relation('profile', {
        toModel: 'Profile',
        toTable: 'profiles',
        cardinality: '1:1',
        on: {
          parentTable: 'users',
          parentColumns: ['id'],
          childTable: 'profiles',
          childColumns: ['user_id'],
        },
      }),
  )
  .model('Post', 'posts', (model) =>
    model
      .field('id', 'id')
      .field('title', 'title')
      .field('userId', 'user_id')
      .field('views', 'views')
      .relation('comments', {
        toModel: 'Comment',
        toTable: 'comments',
        cardinality: '1:N',
        on: {
          parentTable: 'posts',
          parentColumns: ['id'],
          childTable: 'comments',
          childColumns: ['post_id'],
        },
      })
      .relation('author', {
        toModel: 'User',
        toTable: 'users',
        cardinality: 'N:1',
        on: {
          parentTable: 'posts',
          parentColumns: ['user_id'],
          childTable: 'users',
          childColumns: ['id'],
        },
      }),
  )
  .model('Comment', 'comments', (model) =>
    model.field('id', 'id').field('body', 'body').field('postId', 'post_id'),
  )
  .model('Profile', 'profiles', (model) =>
    model.field('id', 'id').field('userId', 'user_id').field('bio', 'bio'),
  )
  .model('TypedRow', 'typed_rows', (model) =>
    model
      .field('id', 'id')
      .field('active', 'active')
      .field('createdAt', 'created_at')
      .field('metadata', 'metadata')
      .field('label', 'label'),
  )
  .build();
