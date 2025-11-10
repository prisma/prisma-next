import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createTableRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { buildIncludeAst, IncludeChildBuilderImpl } from '../src/sql/include-builder';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('IncludeChildBuilderImpl', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const codecTypes = contract.mappings.codecTypes;
  const tableRef = createTableRef('user');

  it('throws when getState called without projection', () => {
    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef);

    expect(() => builder.getState()).toThrow('Child projection must be specified');
  });

  it('preserves state when chaining methods', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef)
      .select({
        id: userColumns.id,
      })
      .where(userColumns.id.eq(param('userId')))
      .orderBy(userColumns.id.asc())
      .limit(10);

    const state = builder.getState();
    expect(state.childProjection).toBeDefined();
    expect(state.childWhere).toBeDefined();
    expect(state.childOrderBy).toBeDefined();
    expect(state.childLimit).toBe(10);
  });

  it('allows chaining where after select', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef)
      .select({
        id: userColumns.id,
      })
      .where(userColumns.id.eq(param('userId')));

    const state = builder.getState();
    expect(state.childProjection).toBeDefined();
    expect(state.childWhere).toBeDefined();
  });

  it('allows chaining orderBy after select', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef)
      .select({
        id: userColumns.id,
      })
      .orderBy(userColumns.id.asc());

    const state = builder.getState();
    expect(state.childProjection).toBeDefined();
    expect(state.childOrderBy).toBeDefined();
  });

  it('allows chaining limit after select', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef)
      .select({
        id: userColumns.id,
      })
      .limit(5);

    const state = builder.getState();
    expect(state.childProjection).toBeDefined();
    expect(state.childLimit).toBe(5);
  });

  it('throws when limit is negative', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef).select({
      id: userColumns.id,
    });

    expect(() => builder.limit(-1)).toThrow('Limit must be a non-negative integer');
  });

  it('throws when limit is not an integer', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, codecTypes, tableRef).select({
      id: userColumns.id,
    });

    expect(() => builder.limit(1.5)).toThrow('Limit must be a non-negative integer');
  });
});

describe('buildIncludeAst', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;
  const postTableRef = createTableRef('post');

  it('builds include AST with all optional fields', () => {
    const includeState = {
      alias: 'posts',
      table: postTableRef,
      on: {
        kind: 'join-on' as const,
        left: userColumns.id,
        right: userColumns.id,
      },
      childProjection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      childWhere: userColumns.id.eq(param('userId')),
      childOrderBy: userColumns.id.asc(),
      childLimit: 10,
    };

    const ast = buildIncludeAst(includeState, contract, { userId: 42 }, [], []);

    expect(ast.kind).toBe('includeMany');
    expect(ast.alias).toBe('posts');
    expect(ast.child.where).toBeDefined();
    expect(ast.child.orderBy).toBeDefined();
    expect(ast.child.limit).toBe(10);
  });

  it('builds include AST without optional fields', () => {
    const includeState = {
      alias: 'posts',
      table: postTableRef,
      on: {
        kind: 'join-on' as const,
        left: userColumns.id,
        right: userColumns.id,
      },
      childProjection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
    };

    const ast = buildIncludeAst(includeState, contract, {}, [], []);

    expect(ast.kind).toBe('includeMany');
    expect(ast.alias).toBe('posts');
    expect(ast.child.where).toBeUndefined();
    expect(ast.child.orderBy).toBeUndefined();
    expect(ast.child.limit).toBeUndefined();
  });

  it('throws when column is missing for alias', () => {
    const includeState = {
      alias: 'posts',
      table: postTableRef,
      on: {
        kind: 'join-on' as const,
        left: userColumns.id,
        right: userColumns.id,
      },
      childProjection: {
        aliases: ['id'],
        columns: [],
      },
    };

    expect(() => buildIncludeAst(includeState, contract, {}, [], [])).toThrow(
      'Missing column for alias',
    );
  });
});
