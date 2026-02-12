import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  bitColumn,
  boolColumn,
  charColumn,
  int4Column,
  intervalColumn,
  json,
  jsonb,
  numericColumn,
  textColumn,
  timeColumn,
  timestamptzColumn,
  timetzColumn,
  varbitColumn,
  varcharColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { uuidv7 } from '@prisma-next/ids';
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
      .column('email', { type: varcharColumn(255), nullable: false })
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
  .table('param_types', (t) =>
    t
      .column('id', {
        type: int4Column,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('name', { type: varcharColumn(255), nullable: true })
      .column('code', { type: charColumn(16), nullable: true })
      .column('price', { type: numericColumn(10, 2), nullable: true })
      .column('flags', { type: bitColumn(8), nullable: true })
      .column('bits', { type: varbitColumn(12), nullable: true })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: true,
        typeParams: { precision: 3 },
      })
      .column('starts_at', { type: timeColumn(2), nullable: true })
      .column('starts_at_tz', { type: timetzColumn(2), nullable: true })
      .column('duration', { type: intervalColumn(6), nullable: true })
      .primaryKey(['id']),
  )
  .table('event', (t) =>
    t
      .generated('id', uuidv7())
      .column('name', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        default: { kind: 'function', expression: 'now()' },
      })
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
  .model('Event', 'event', (m) =>
    m.field('id', 'id').field('name', 'name').field('createdAt', 'created_at'),
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
