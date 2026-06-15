#!/usr/bin/env -S node
import {
  addCheckConstraint,
  addForeignKey,
  col,
  createIndex,
  fn,
  lit,
  Migration,
  MigrationCLI,
  primaryKey,
  rawSql,
} from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:243450a642aa1368a4ab49b4fcc61bf0b7ae1569e40db03c7510bbd029de64b2',
    };
  }

  override get operations() {
    return [
      rawSql({
        id: 'extension.vector',
        label: 'Enable extension "vector"',
        summary: 'Ensures the vector extension is available for pgvector operations',
        operationClass: 'additive',
        target: { id: 'postgres' },
        precheck: [
          {
            description: 'verify extension "vector" is not already enabled',
            sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
          },
        ],
        execute: [
          {
            description: 'create extension "vector"',
            sql: 'CREATE EXTENSION IF NOT EXISTS vector',
          },
        ],
        postcheck: [
          {
            description: 'confirm extension "vector" is enabled',
            sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
          },
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'bug',
        columns: [col('severity', 'text', { notNull: true }), col('stepsToRepro', 'text')],
      }),
      this.createTable({
        schema: 'public',
        table: 'feature',
        columns: [col('priority', 'text', { notNull: true }), col('targetRelease', 'text')],
      }),
      this.createTable({
        schema: 'public',
        table: 'post',
        columns: [
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('embedding', 'vector(1536)'),
          col('id', 'character(36)', { notNull: true }),
          col('title', 'text', { notNull: true }),
          col('userId', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
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
        table: 'user',
        columns: [
          col('address', 'jsonb'),
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('email', 'text', { notNull: true }),
          col('id', 'character(36)', { notNull: true }),
          col('kind', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      addCheckConstraint('public', 'user', 'user_kind_check', 'kind', ['admin', 'user']),
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
