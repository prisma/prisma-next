import { validateContract } from '@prisma-next/sql-contract/validate';
import { BinaryExpr, ColumnRef, ParamRef, RawSqlExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = validateContract<PostgresContract>(
  {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'sha256:raw-sql-test',
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    storage: {
      storageHash: 'sha256:raw-sql-test',
      tables: {
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
  },
  { get: () => undefined },
);

describe('renderLoweredSql RawSqlExpr arm', () => {
  const adapter = createPostgresAdapter();

  it('zero-arg raw lowers to its single fragment with empty params', () => {
    const ast = RawSqlExpr.of(['SELECT 1'], []);
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('SELECT 1');
    expect(lowered.params).toEqual([]);
  });

  it('one ParamRef substitutes $1 at the gap and lifts the value into params', () => {
    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.eq(', ')'],
      [ParamRef.of('alice@example.com', { codecId: 'pg/text@1' })],
    );
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('SELECT eql_v2.eq($1)');
    expect(lowered.params).toEqual(['alice@example.com']);
  });

  it('multiple ParamRefs in different positions render $1, $2, ... in source order', () => {
    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.add_search_config(', ', ', ', ', ', ', ')'],
      [
        ParamRef.of('user', { codecId: 'pg/text@1' }),
        ParamRef.of('email', { codecId: 'pg/text@1' }),
        ParamRef.of('unique', { codecId: 'pg/text@1' }),
        ParamRef.of('text', { codecId: 'pg/text@1' }),
      ],
    );
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('SELECT eql_v2.add_search_config($1, $2, $3, $4)');
    expect(lowered.params).toEqual(['user', 'email', 'unique', 'text']);
  });

  it('an inlined typed-builder expression lowers via renderExpr; sub-params append in canonical order', () => {
    const inner = BinaryExpr.eq(
      ColumnRef.of('user', 'email'),
      ParamRef.of('alice@example.com', { codecId: 'pg/text@1' }),
    );
    const ast = RawSqlExpr.of(
      ['SELECT * FROM "user" WHERE ', ' AND id = ', ''],
      [inner, ParamRef.of(7, { codecId: 'pg/int4@1' })],
    );
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('SELECT * FROM "user" WHERE "user"."email" = $1 AND id = $2');
    expect(lowered.params).toEqual(['alice@example.com', 7]);
  });

  it('renders an empty leading fragment correctly (template-literal `${value} suffix` shape)', () => {
    const ast = RawSqlExpr.of(['', ' AS literal_one'], [ParamRef.of(1, { codecId: 'pg/int4@1' })]);
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('$1 AS literal_one');
    expect(lowered.params).toEqual([1]);
  });

  it('dedupes repeated ParamRef identity to a single $N (collectOrderedParamRefs semantics)', () => {
    const shared = ParamRef.of('shared', { codecId: 'pg/text@1' });
    const ast = RawSqlExpr.of(['SELECT ', ' = ', ''], [shared, shared]);
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('SELECT $1 = $1');
    expect(lowered.params).toEqual(['shared']);
  });

  // SQL-injection invariant: ParamRef values never get text-inlined into
  // the rendered SQL. They must appear only in the params array, with
  // positional placeholders ($1, $2, ...) at their original positions.
  // Defense in depth — exercised here with the
  // exact shape cipherstash's `addSearchConfig` migration factory uses.
  it('ParamRef values are never text-inlined into the rendered SQL', () => {
    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.add_search_config(', ', ', ')'],
      [
        ParamRef.of('users', { codecId: 'pg/text@1' }),
        ParamRef.of('email', { codecId: 'pg/text@1' }),
      ],
    );
    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toBe('SELECT eql_v2.add_search_config($1, $2)');
    expect(lowered.params).toEqual(['users', 'email']);
    expect(lowered.sql).not.toContain('users');
    expect(lowered.sql).not.toContain('email');
  });
});
