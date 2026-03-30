import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  boolColumn,
  enumColumn,
  enumType,
  float8Column,
  int4Column,
  jsonbColumn,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const emailColumn = {
  codecId: 'pg/text@1',
  nativeType: 'text',
  typeRef: 'Email',
} as const;

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .storageType('Email', {
    codecId: 'pg/text@1',
    nativeType: 'text',
    typeParams: {},
  })
  .storageType('Role', enumType('Role', ['USER', 'ADMIN']))
  .table('user', (t) =>
    t
      .column('id', {
        type: int4Column,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('email', { type: emailColumn, nullable: false })
      .unique(['email'])
      .column('role', { type: enumColumn('Role', 'Role'), nullable: false })
      .column('createdAt', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('isActive', {
        type: boolColumn,
        nullable: false,
        default: { kind: 'literal', value: true },
      })
      .column('profile', { type: jsonbColumn, nullable: true })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', {
        type: int4Column,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('userId', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('rating', { type: float8Column, nullable: true })
      .index(['userId'])
      .unique(['title', 'userId'])
      .foreignKey(
        ['userId'],
        { table: 'user', columns: ['id'] },
        { onDelete: 'cascade', onUpdate: 'cascade' },
      )
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('role', 'role')
      .field('createdAt', 'createdAt')
      .field('isActive', 'isActive')
      .field('profile', 'profile'),
  )
  .model('Post', 'post', (m) =>
    m.field('id', 'id').field('userId', 'userId').field('title', 'title').field('rating', 'rating'),
  )
  .build();
