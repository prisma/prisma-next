import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  boolColumn,
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import postgresPack from '@prisma-next/target-postgres/pack';
// Use relative import to avoid module resolution issues in test context
import { defineContract } from '../../../../../packages/2-sql/2-authoring/contract-ts/src/exports/contract-builder';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'db-generated', expression: 'autoincrement()' },
      })
      .column('email', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'db-generated', expression: 'now()' },
      })
      .column('update_at', { type: timestamptzColumn, nullable: true })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'db-generated', expression: 'autoincrement()' },
      })
      .column('userId', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'db-generated', expression: 'now()' },
      })
      .column('update_at', { type: timestamptzColumn, nullable: true })
      .column('published', { type: boolColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('comment', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'db-generated', expression: 'autoincrement()' },
      })
      .column('postId', { type: int4Column, nullable: false })
      .column('content', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'db-generated', expression: 'now()' },
      })
      .column('update_at', { type: timestamptzColumn, nullable: true })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('createdAt', 'created_at')
      .field('updatedAt', 'update_at'),
  )
  .model('Post', 'post', (m) =>
    m
      .field('id', 'id')
      .field('userId', 'userId')
      .field('title', 'title')
      .field('createdAt', 'created_at')
      .field('updatedAt', 'update_at'),
  )
  .model('Comment', 'comment', (m) =>
    m
      .field('id', 'id')
      .field('postId', 'postId')
      .field('content', 'content')
      .field('createdAt', 'created_at')
      .field('updatedAt', 'update_at'),
  )
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'defaults.autoincrement': true,
      'defaults.now': true,
    },
  })
  .build();
