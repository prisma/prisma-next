import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .extensionPacks({ pgvector })
  .table('users', (table) =>
    table
      .column('id', { type: int4Column, nullable: false })
      .column('name', { type: textColumn, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .column('invited_by_id', { type: int4Column, nullable: true })
      .primaryKey(['id'])
      .unique(['email'])
      .foreignKey(['invited_by_id'], { table: 'users', columns: ['id'] }),
  )
  .table('posts', (table) =>
    table
      .column('id', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('user_id', { type: int4Column, nullable: false })
      .column('views', { type: int4Column, nullable: false })
      .column('embedding', { type: vectorColumn, nullable: true })
      .primaryKey(['id'])
      .foreignKey(['user_id'], { table: 'users', columns: ['id'] }),
  )
  .table('comments', (table) =>
    table
      .column('id', { type: int4Column, nullable: false })
      .column('body', { type: textColumn, nullable: false })
      .column('post_id', { type: int4Column, nullable: false })
      .primaryKey(['id'])
      .foreignKey(['post_id'], { table: 'posts', columns: ['id'] }),
  )
  .table('profiles', (table) =>
    table
      .column('id', { type: int4Column, nullable: false })
      .column('user_id', { type: int4Column, nullable: false })
      .column('bio', { type: textColumn, nullable: false })
      .primaryKey(['id'])
      .foreignKey(['user_id'], { table: 'users', columns: ['id'] }),
  )
  .table('articles', (table) =>
    table
      .column('id', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('reviewer_id', { type: int4Column, nullable: false })
      .primaryKey(['id']),
  )
  .table('tags', (table) =>
    table
      .generated('id', { type: textColumn, generated: { kind: 'generator', id: 'uuidv4' } })
      .column('name', { type: textColumn, nullable: false })
      .primaryKey(['id'])
      .unique(['name']),
  )
  .model('User', 'users', (model) =>
    model
      .field('id', 'id')
      .field('name', 'name')
      .field('email', 'email')
      .field('invitedById', 'invited_by_id')
      .relation('invitedUsers', {
        toModel: 'User',
        toTable: 'users',
        cardinality: '1:N',
        on: {
          parentTable: 'users',
          parentColumns: ['id'],
          childTable: 'users',
          childColumns: ['invited_by_id'],
        },
      })
      .relation('invitedBy', {
        toModel: 'User',
        toTable: 'users',
        cardinality: 'N:1',
        on: {
          parentTable: 'users',
          parentColumns: ['invited_by_id'],
          childTable: 'users',
          childColumns: ['id'],
        },
      })
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
      .field('embedding', 'embedding')
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
    model
      .field('id', 'id')
      .field('userId', 'user_id')
      .field('bio', 'bio')
      .relation('user', {
        toModel: 'User',
        toTable: 'users',
        cardinality: '1:1',
        on: {
          parentTable: 'profiles',
          parentColumns: ['user_id'],
          childTable: 'users',
          childColumns: ['id'],
        },
      }),
  )
  .model('Article', 'articles', (model) =>
    model
      .field('id', 'id')
      .field('title', 'title')
      .field('reviewerId', 'reviewer_id')
      .relation('reviewer', {
        toModel: 'User',
        toTable: 'users',
        cardinality: 'N:1',
        on: {
          parentTable: 'articles',
          parentColumns: ['reviewer_id'],
          childTable: 'users',
          childColumns: ['id'],
        },
      }),
  )
  .model('Tag', 'tags', (model) => model.field('id', 'id').field('name', 'name'))
  .build();
