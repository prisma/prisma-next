#!/usr/bin/env -S node
import {
  addForeignKey,
  createEnumType,
  createIndex,
  createSchema,
  createTable,
  Migration,
  MigrationCLI,
} from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:e6f860c806e651e2d0253c01304989e3914db86fffded47c0eda9ae4081f47d3',
    };
  }

  override get operations() {
    return [
      createSchema('auth'),
      createEnumType('public', 'user_type', ['admin', 'user']),
      createTable('public', 'bug', [
        { name: 'severity', typeSql: 'text', defaultSql: '', nullable: false },
        { name: 'stepsToRepro', typeSql: 'text', defaultSql: '', nullable: true },
      ]),
      createTable('public', 'feature', [
        { name: 'priority', typeSql: 'text', defaultSql: '', nullable: false },
        { name: 'targetRelease', typeSql: 'text', defaultSql: '', nullable: true },
      ]),
      createTable(
        'public',
        'post',
        [
          {
            name: 'createdAt',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'embedding', typeSql: 'vector(1536)', defaultSql: '', nullable: true },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'title', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'userId', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createTable(
        'public',
        'task',
        [
          {
            name: 'createdAt',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'description', typeSql: 'text', defaultSql: '', nullable: true },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          {
            name: 'status',
            typeSql: 'text',
            defaultSql: "DEFAULT 'open'",
            nullable: false,
          },
          { name: 'title', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'type', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'userId', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createTable(
        'auth',
        'user',
        [
          { name: 'address', typeSql: 'jsonb', defaultSql: '', nullable: true },
          {
            name: 'createdAt',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'displayName', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'email', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'kind', typeSql: '"user_type"', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createIndex('public', 'post', 'post_userId_idx', ['userId']),
      createIndex('public', 'task', 'task_userId_idx', ['userId']),
      addForeignKey('public', 'post', {
        name: 'post_userId_fkey',
        columns: ['userId'],
        target: { schema: 'auth', table: 'user', columns: ['id'] },
      }),
      addForeignKey('public', 'task', {
        name: 'task_userId_fkey',
        columns: ['userId'],
        target: { schema: 'auth', table: 'user', columns: ['id'] },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
