import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  boolColumn,
  int4Column,
  json,
  jsonb,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import postgresPack from '@prisma-next/target-postgres/pack';
import { type as arktype } from 'arktype';
// Use relative import to avoid module resolution issues in test context
import { defineContract } from '../../../../../packages/2-sql/2-authoring/contract-ts/src/exports/contract-builder';

const profileSchema = arktype({
  displayName: 'string',
  tags: 'string[]',
  active: 'boolean',
});

const metaSchema = arktype({
  source: 'string',
  rank: 'number',
  verified: 'boolean',
});

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('email', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('update_at', { type: timestamptzColumn, nullable: true })
      .column('profile', {
        type: jsonb(profileSchema),
        nullable: true,
      })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('userId', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('update_at', { type: timestamptzColumn, nullable: true })
      .column('published', { type: boolColumn, nullable: false })
      .column('meta', {
        type: json(metaSchema),
        nullable: true,
      })
      .primaryKey(['id']),
  )
  .table('comment', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('postId', { type: int4Column, nullable: false })
      .column('content', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('update_at', { type: timestamptzColumn, nullable: true })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('createdAt', 'created_at')
      .field('updatedAt', 'update_at')
      .field('profile', 'profile'),
  )
  .model('Post', 'post', (m) =>
    m
      .field('id', 'id')
      .field('userId', 'userId')
      .field('title', 'title')
      .field('createdAt', 'created_at')
      .field('updatedAt', 'update_at')
      .field('meta', 'meta'),
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
