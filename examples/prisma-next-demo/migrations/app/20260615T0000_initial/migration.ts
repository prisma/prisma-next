#!/usr/bin/env -S node
import {
  addCheckConstraint,
  addForeignKey,
  col,
  createExtension,
  createIndex,
  fn,
  lit,
  Migration,
  MigrationCLI,
  primaryKey,
} from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:1a02eed4ad52f589641c1e16b929427e1060acc6bc1e9cc4e3b6e663523f88b4',
    };
  }

  override get operations() {
    return [
      createExtension('vector'),
      this.createTable({
        schema: 'public',
        table: 'user',
        columns: [
          col('address', 'jsonb'),
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('displayName', 'text', { notNull: true }),
          col('email', 'text', { notNull: true }),
          col('id', 'character(36)', { notNull: true }),
          col('kind', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      addCheckConstraint('public', 'user', 'user_kind_check', 'kind', ['admin', 'user']),
      this.createTable({
        schema: 'public',
        table: 'post',
        columns: [
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('embedding', 'vector(1536)'),
          col('id', 'character(36)', { notNull: true }),
          col('priority', 'text', { notNull: true, default: lit('low') }),
          col('title', 'text', { notNull: true }),
          col('userId', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      addCheckConstraint('public', 'post', 'post_priority_check', 'priority', [
        'low',
        'high',
        'urgent',
      ]),
      this.createTable({
        schema: 'public',
        table: 'task',
        columns: [
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('description', 'text'),
          col('id', 'character(36)', { notNull: true }),
          col('status', 'text', { notNull: true, default: lit('open') }),
          col('title', 'text', { notNull: true }),
          col('type', 'text', { notNull: true }),
          col('userId', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'bug',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('severity', 'text', { notNull: true }),
          col('stepsToRepro', 'text'),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'feature',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('priority', 'text', { notNull: true }),
          col('targetRelease', 'text'),
        ],
        constraints: [primaryKey(['id'])],
      }),
      addForeignKey('public', 'post', {
        name: 'post_userId_fkey',
        columns: ['userId'],
        references: { schema: 'public', table: 'user', columns: ['id'] },
      }),
      createIndex('public', 'post', 'post_userId_idx', ['userId']),
      addForeignKey('public', 'task', {
        name: 'task_userId_fkey',
        columns: ['userId'],
        references: { schema: 'public', table: 'user', columns: ['id'] },
      }),
      createIndex('public', 'task', 'task_userId_idx', ['userId']),
      addForeignKey('public', 'bug', {
        name: 'bug_id_fkey',
        columns: ['id'],
        references: { schema: 'public', table: 'task', columns: ['id'] },
        onDelete: 'cascade',
      }),
      addForeignKey('public', 'feature', {
        name: 'feature_id_fkey',
        columns: ['id'],
        references: { schema: 'public', table: 'task', columns: ['id'] },
        onDelete: 'cascade',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
