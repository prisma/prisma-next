import {
  ForeignKeyConstraint,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@prisma-next/sql-relational-core/ast';
import { col } from '@prisma-next/sql-relational-core/contract-free';
import { createTable } from '@prisma-next/target-postgres/contract-free';
import { PostgresSchema, postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const publicNs = postgresCreateNamespace({ id: 'public', entries: { table: {} } });
const unboundNs = PostgresSchema.unbound;

describe('PostgresCreateTable with table-level constraints', () => {
  it('renders a join table with composite PK, two FKs, and a table-level unique', async () => {
    const ast = createTable({
      ref: publicNs.tableRef('post_tags'),
      columns: [col('postId', 'text', { notNull: true }), col('tagId', 'text', { notNull: true })],
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

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE "public"."post_tags" (\n' +
        '  "postId" text NOT NULL,\n' +
        '  "tagId" text NOT NULL,\n' +
        '  PRIMARY KEY ("postId", "tagId"),\n' +
        '  FOREIGN KEY ("postId") REFERENCES "posts" ("id") ON DELETE CASCADE,\n' +
        '  FOREIGN KEY ("tagId") REFERENCES "tags" ("id") ON DELETE CASCADE,\n' +
        '  CONSTRAINT "uq_post_tags_reverse" UNIQUE ("tagId", "postId")\n' +
        ')',
    );
    expect(lowered.params).toEqual([]);
  });

  it('renders a named primary key', async () => {
    const ast = createTable({
      ref: unboundNs.tableRef('items'),
      columns: [col('a', 'text'), col('b', 'text')],
      constraints: [new PrimaryKeyConstraint({ columns: ['a', 'b'], name: 'pk_items' })],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain('CONSTRAINT "pk_items" PRIMARY KEY ("a", "b")');
  });

  it('renders FK with onUpdate action', async () => {
    const ast = createTable({
      ref: unboundNs.tableRef('orders'),
      columns: [col('userId', 'text', { notNull: true })],
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

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(
      'CONSTRAINT "fk_orders_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    );
  });

  it('quotes mixed-case constraint names and splits schema-qualified FK refTable', async () => {
    const ast = createTable({
      ref: publicNs.tableRef('orders'),
      columns: [col('id', 'text', { notNull: true }), col('userId', 'text', { notNull: true })],
      constraints: [
        new PrimaryKeyConstraint({ columns: ['id'], name: 'MyPK' }),
        new ForeignKeyConstraint({
          columns: ['userId'],
          refTable: 'app.users',
          refColumns: ['id'],
        }),
      ],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain('CONSTRAINT "MyPK" PRIMARY KEY ("id")');
    expect(lowered.sql).toContain('REFERENCES "app"."users" ("id")');
  });

  it('omits constraints section when no constraints given', async () => {
    const ast = createTable({
      ref: unboundNs.tableRef('simple'),
      columns: [col('id', 'text', { primaryKey: true, notNull: true })],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toBe('CREATE TABLE "simple" (\n  "id" text NOT NULL PRIMARY KEY\n)');
  });
});
