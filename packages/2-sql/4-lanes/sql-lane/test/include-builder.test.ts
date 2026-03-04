import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef, createTableRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import {
  type AnyColumnBuilderBase,
  createOrderBuilder,
} from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { buildIncludeJoinArtifact, IncludeChildBuilderImpl } from '../src/sql/include-builder';
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
  const tableRef = createTableRef('user');
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

  it('throws when getState called without projection', () => {
    const builder = new IncludeChildBuilderImpl(contract, tableRef);

    expect(() => builder.getState()).toThrow('Child projection must be specified');
  });

  it('preserves state when chaining methods', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, tableRef)
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

    const builder = new IncludeChildBuilderImpl(contract, tableRef)
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

    const builder = new IncludeChildBuilderImpl(contract, tableRef)
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

    const builder = new IncludeChildBuilderImpl(contract, tableRef)
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
    const seeded = apply(new IncludeChildBuilderImpl(contract, tableRef));
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

    const builder = new IncludeChildBuilderImpl(contract, tableRef).select({
      id: userColumns.id,
    });

    expect(() => builder.limit(-1)).toThrow('Limit must be a non-negative integer');
  });

  it('throws when limit is not an integer', () => {
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    const builder = new IncludeChildBuilderImpl(contract, tableRef).select({
      id: userColumns.id,
    });

    expect(() => builder.limit(1.5)).toThrow('Limit must be a non-negative integer');
  });
});

describe('buildIncludeJoinArtifact', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;
  const postTableRef = createTableRef('post');

  function createAliasedColumn(
    table: string,
    column: string,
    columnMeta: AnyColumnBuilderBase['columnMeta'],
  ): AnyColumnBuilderBase {
    const notImplemented = (): never => {
      throw new Error('Test helper only supports toExpr()');
    };

    return {
      kind: 'column',
      table,
      column,
      columnMeta,
      eq: notImplemented,
      neq: notImplemented,
      gt: notImplemented,
      lt: notImplemented,
      gte: notImplemented,
      lte: notImplemented,
      asc: notImplemented,
      desc: notImplemented,
      toExpr: () => createColumnRef(table, column),
      __jsType: undefined,
    };
  }

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

    const artifact = buildIncludeJoinArtifact(includeState, contract, { userId: 42 }, [], []);

    expect(artifact.join.lateral).toBe(true);
    expect(artifact.join.source.kind).toBe('derivedTable');
    expect(artifact.projection).toMatchObject({
      alias: 'posts',
      expr: { kind: 'col', table: 'posts_lateral', column: 'posts' },
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

    const artifact = buildIncludeJoinArtifact(includeState, contract, {}, [], []);
    expect(artifact.join.lateral).toBe(true);
    expect(artifact.join.source.kind).toBe('derivedTable');
  });

  it('preserves the child table alias in the inner include rows query', () => {
    const aliasedPostTableRef = createTableRef('post', 'child_post');
    const childIdColumn = createAliasedColumn('child_post', 'id', userColumns.id.columnMeta);
    const childUserIdColumn = createAliasedColumn(
      'child_post',
      'userId',
      userColumns.id.columnMeta,
    );

    const includeState = {
      alias: 'posts',
      table: aliasedPostTableRef,
      on: {
        kind: 'join-on' as const,
        left: userColumns.id,
        right: childUserIdColumn,
      },
      childProjection: {
        aliases: ['id'],
        columns: [childIdColumn],
      },
    } satisfies Parameters<typeof buildIncludeJoinArtifact>[0];

    const artifact = buildIncludeJoinArtifact(includeState, contract, {}, [], []);
    expect(artifact.join.source.kind).toBe('derivedTable');
    if (artifact.join.source.kind === 'derivedTable') {
      const rowsSource = artifact.join.source.query.from;
      expect(rowsSource.kind).toBe('derivedTable');
      if (rowsSource.kind === 'derivedTable') {
        expect(rowsSource.query.from).toMatchObject({
          kind: 'table',
          name: 'post',
          alias: 'child_post',
        });
      }
    }
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

    expect(() => buildIncludeJoinArtifact(includeState, contract, {}, [], [])).toThrow(
      'Missing column for alias',
    );
  });

  it('throws when alias is missing in child projection', () => {
    // Cast simulates a corrupted projection where an alias slot is undefined at runtime
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

    expect(() => buildIncludeJoinArtifact(includeState, contract, {}, [], [])).toThrow(
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

    const artifact = buildIncludeJoinArtifact(includeState, contract, {}, [], []);
    expect(artifact.join.source.kind).toBe('derivedTable');
    if (artifact.join.source.kind === 'derivedTable') {
      const rowsSource = artifact.join.source.query.from;
      expect(rowsSource.kind).toBe('derivedTable');
      if (rowsSource.kind === 'derivedTable') {
        expect(rowsSource.query.orderBy?.[0]?.expr).toEqual(operationExpr);
        expect(rowsSource.query.project).toContainEqual({
          alias: 'posts__order_0',
          expr: operationExpr,
        });
      }
    }
  });
});
