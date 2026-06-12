#!/usr/bin/env -S node
import {
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
      to: 'sha256:b1fd962de2b19a2a4fdf0dd04fb123a4d7681e318cbef09fdad6f016b5144bd9',
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
      rawSql({
        id: 'type.user_type',
        label: 'Create type user_type',
        summary: 'Creates enum type user_type',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'type', name: 'user_type' },
        },
        precheck: [
          {
            description: 'ensure type "user_type" does not exist',
            sql: "SELECT NOT EXISTS (\n  SELECT 1\n  FROM pg_type t\n  JOIN pg_namespace n ON t.typnamespace = n.oid\n  WHERE n.nspname = 'public'\n    AND t.typname = 'user_type'\n)",
          },
        ],
        execute: [
          {
            description: 'create type "user_type"',
            sql: 'CREATE TYPE "public"."user_type" AS ENUM (\'admin\', \'user\')',
          },
        ],
        postcheck: [
          {
            description: 'verify type "user_type" exists',
            sql: "SELECT EXISTS (\n  SELECT 1\n  FROM pg_type t\n  JOIN pg_namespace n ON t.typnamespace = n.oid\n  WHERE n.nspname = 'public'\n    AND t.typname = 'user_type'\n)",
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
          col('kind', '"user_type"', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post',
        foreignKey: {
          name: 'post_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      createIndex('public', 'post', 'post_userId_idx', ['userId']),
      this.addForeignKey({
        schema: 'public',
        table: 'task',
        foreignKey: {
          name: 'task_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      createIndex('public', 'task', 'task_userId_idx', ['userId']),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
