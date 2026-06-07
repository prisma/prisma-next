import {
  ForeignKeyConstraint,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@prisma-next/sql-relational-core/ast';
import { col } from '@prisma-next/sql-relational-core/contract-free';
import { createTable } from '@prisma-next/target-sqlite/contract-free';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

describe('SqliteCreateTable with table-level constraints', () => {
  it('renders a join table with composite PK, two FKs, and a table-level unique', () => {
    // Representative user table: same join table as the Postgres test.
    // SQLite renders constraints inline in the CREATE TABLE body.
    const ast = createTable({
      table: 'post_tags',
      columns: [col('postId', 'TEXT', { notNull: true }), col('tagId', 'TEXT', { notNull: true })],
      constraints: [
        new PrimaryKeyConstraint({ columns: ['postId', 'tagId'] }),
        new ForeignKeyConstraint({
          columns: ['postId'],
          refTable: 'posts',
          refColumns: ['id'],
          onDelete: 'cascade',
        }),
        new ForeignKeyConstraint({
          columns: ['tagId'],
          refTable: 'tags',
          refColumns: ['id'],
          onDelete: 'cascade',
        }),
        new UniqueConstraint({ columns: ['tagId', 'postId'], name: 'uq_post_tags_reverse' }),
      ],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE "post_tags" (\n' +
        '  "postId" TEXT NOT NULL,\n' +
        '  "tagId" TEXT NOT NULL,\n' +
        '  PRIMARY KEY ("postId", "tagId"),\n' +
        '  FOREIGN KEY ("postId") REFERENCES posts ("id") ON DELETE CASCADE,\n' +
        '  FOREIGN KEY ("tagId") REFERENCES tags ("id") ON DELETE CASCADE,\n' +
        '  CONSTRAINT uq_post_tags_reverse UNIQUE ("tagId", "postId")\n' +
        ')',
    );
    expect(lowered.params).toEqual([]);
  });

  it('renders a named primary key', () => {
    const ast = createTable({
      table: 'items',
      columns: [col('a', 'TEXT'), col('b', 'TEXT')],
      constraints: [new PrimaryKeyConstraint({ columns: ['a', 'b'], name: 'pk_items' })],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain('CONSTRAINT pk_items PRIMARY KEY ("a", "b")');
  });

  it('renders FK with onUpdate action', () => {
    const ast = createTable({
      table: 'orders',
      columns: [col('userId', 'TEXT', { notNull: true })],
      constraints: [
        new ForeignKeyConstraint({
          columns: ['userId'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'restrict',
          onUpdate: 'cascade',
          name: 'fk_orders_user',
        }),
      ],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain(
      'CONSTRAINT fk_orders_user FOREIGN KEY ("userId") REFERENCES users ("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    );
  });

  it('omits constraints section when no constraints given', () => {
    const ast = createTable({
      table: 'simple',
      columns: [col('id', 'TEXT', { primaryKey: true, notNull: true })],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toBe('CREATE TABLE "simple" (\n  "id" TEXT NOT NULL PRIMARY KEY\n)');
  });
});
