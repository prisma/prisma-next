#!/usr/bin/env -S node
import {
  addForeignKey,
  createIndex,
  createTable,
  Migration,
  rawSql,
} from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:empty',
      to: 'sha256:76c1bd5f5733774ae1182e83ca882f623cdf12e78a76c2fb06666d60bbdd6452',
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
        'public',
        'user',
        [
          { name: 'address', typeSql: 'jsonb', defaultSql: '', nullable: true },
          {
            name: 'createdAt',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'email', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'kind', typeSql: '"user_type"', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      addForeignKey('public', 'post', {
        name: 'post_userId_fkey',
        columns: ['userId'],
        references: { table: 'user', columns: ['id'] },
      }),
      createIndex('public', 'post', 'post_userId_idx', ['userId']),
      addForeignKey('public', 'task', {
        name: 'task_userId_fkey',
        columns: ['userId'],
        references: { table: 'user', columns: ['id'] },
      }),
      createIndex('public', 'task', 'task_userId_idx', ['userId']),
    ];
  }
}

Migration.run(import.meta.url, M);
