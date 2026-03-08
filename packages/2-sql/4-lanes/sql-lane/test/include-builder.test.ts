import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractCodecTypes } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef, createTableRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createOrderBuilder } from '@prisma-next/sql-relational-core/types';
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
  const codecTypes = {} as unknown as ExtractCodecTypes<Contract>;
  const tableRef = createTableRef('user');
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

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
    expect({
      hasProjection: state.childProjection !== undefined,
      hasWhere: state.childWhere !== undefined,
      hasOrderBy: state.childOrderBy !== undefined,
      limit: state.childLimit,
    }).toMatchObject({
      hasProjection: true,
      hasWhere: true,
      hasOrderBy: true,
      limit: 10,
    });
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
    expect({
      hasProjection: state.childProjection !== undefined,
      hasWhere: state.childWhere !== undefined,
    }).toMatchObject({
      hasProjection: true,
      hasWhere: true,
    });
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
    expect({
      hasProjection: state.childProjection !== undefined,
      hasOrderBy: state.childOrderBy !== undefined,
    }).toMatchObject({
      hasProjection: true,
      hasOrderBy: true,
    });
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
    expect({
      hasProjection: state.childProjection !== undefined,
      limit: state.childLimit,
    }).toMatchObject({
      hasProjection: true,
      limit: 5,
    });
  });

  it.each([
    [
      'where',
      (builder: IncludeChildBuilderImpl) => builder.where(userColumns.id.eq(param('userId'))),
      (state: ReturnType<IncludeChildBuilderImpl['getState']>) => {
        expect(state.childWhere).toBeDefined();
      },
    ],
    [
      'orderBy',
      (builder: IncludeChildBuilderImpl) => builder.orderBy(userColumns.id.asc()),
      (state: ReturnType<IncludeChildBuilderImpl['getState']>) => {
        expect(state.childOrderBy).toBeDefined();
      },
    ],
    [
      'limit',
      (builder: IncludeChildBuilderImpl) => builder.limit(3),
      (state: ReturnType<IncludeChildBuilderImpl['getState']>) => {
        expect(state.childLimit).toBe(3);
      },
    ],
  ] as const)('preserves %s state when select is called later', (_name, apply, assertState) => {
    const seeded = apply(new IncludeChildBuilderImpl(contract, codecTypes, tableRef));
    const next = seeded.select({
      id: userColumns.id,
    });
    const state = next.getState();
    expect(state.childProjection).toBeDefined();
    assertState(state);
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

    expect({
      kind: ast.kind,
      alias: ast.alias,
      hasWhere: ast.child.where !== undefined,
      hasOrderBy: ast.child.orderBy !== undefined,
      limit: ast.child.limit,
    }).toMatchObject({
      kind: 'includeMany',
      alias: 'posts',
      hasWhere: true,
      hasOrderBy: true,
      limit: 10,
    });
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

    expect({
      kind: ast.kind,
      alias: ast.alias,
      where: ast.child.where,
      orderBy: ast.child.orderBy,
      limit: ast.child.limit,
    }).toMatchObject({
      kind: 'includeMany',
      alias: 'posts',
      where: undefined,
      orderBy: undefined,
      limit: undefined,
    });
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

  it('throws when alias is missing in child projection', () => {
    const includeState = {
      alias: 'posts',
      table: postTableRef,
      on: {
        kind: 'join-on' as const,
        left: userColumns.id,
        right: userColumns.id,
      },
      childProjection: {
        aliases: [undefined as unknown as string],
        columns: [userColumns.id],
      },
    };

    expect(() => buildIncludeAst(includeState, contract, {}, [], [])).toThrow(
      'Missing column for alias',
    );
  });

  it('builds include AST with operation expression in childOrderBy', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    // Create an OrderBuilder with an OperationExpr
    const childOrderBy = createOrderBuilder(operationExpr, 'asc');

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
      childOrderBy,
    };

    const ast = buildIncludeAst(includeState, contract, {}, [], []);

    expect(ast.child.orderBy).toBeDefined();
    // When orderExpr is an OperationExpr, extractBaseColumnRef extracts the base column
    expect(ast.child.orderBy?.[0]?.expr).toMatchObject({
      kind: 'col',
      table: 'user',
      column: 'id',
    });
  });
});
