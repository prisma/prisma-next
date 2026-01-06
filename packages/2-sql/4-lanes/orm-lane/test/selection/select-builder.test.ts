import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  Direction,
  ExistsExpr,
  IncludeAst,
  OperationExpr,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyExpressionSource,
  ExpressionBuilder,
} from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import type { IncludeState } from '../../src/relations/include-plan';
import type { ProjectionState } from '../../src/selection/projection';
import { buildProjectionItems, buildSelectAst } from '../../src/selection/select-builder';

function createTestContract(): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {},
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    relations: {},
    mappings: {
      modelToTable: {},
      tableToModel: {},
      fieldToColumn: {},
      columnToField: {},
      codecTypes: {},
      operationTypes: {},
    },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

function createTestOperationExpr(): OperationExpr {
  return {
    kind: 'operation',
    method: 'add',
    forTypeId: 'pg/int4@1',
    self: createColumnRef('user', 'id'),
    args: [],
    returns: { kind: 'builtin', type: 'number' },
    lowering: {
      targetFamily: 'sql',
      strategy: 'infix',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
      template: '${self} + ${arg0}',
    },
  };
}

function createTestExpressionBuilder(operationExpr: OperationExpr): ExpressionBuilder<number> {
  return {
    kind: 'expression',
    expr: operationExpr,
    columnMeta: {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    },
    toExpr: () => operationExpr,
    eq: () =>
      ({
        kind: 'binary',
        op: 'eq',
        left: operationExpr,
        right: { kind: 'param', index: 0, name: 'p' },
      }) as never,
    neq: () =>
      ({
        kind: 'binary',
        op: 'neq',
        left: operationExpr,
        right: { kind: 'param', index: 0, name: 'p' },
      }) as never,
    gt: () =>
      ({
        kind: 'binary',
        op: 'gt',
        left: operationExpr,
        right: { kind: 'param', index: 0, name: 'p' },
      }) as never,
    lt: () =>
      ({
        kind: 'binary',
        op: 'lt',
        left: operationExpr,
        right: { kind: 'param', index: 0, name: 'p' },
      }) as never,
    gte: () =>
      ({
        kind: 'binary',
        op: 'gte',
        left: operationExpr,
        right: { kind: 'param', index: 0, name: 'p' },
      }) as never,
    lte: () =>
      ({
        kind: 'binary',
        op: 'lte',
        left: operationExpr,
        right: { kind: 'param', index: 0, name: 'p' },
      }) as never,
    asc: () => ({ kind: 'order', expr: operationExpr, dir: 'asc' }) as never,
    desc: () => ({ kind: 'order', expr: operationExpr, dir: 'desc' }) as never,
    __jsType: undefined as unknown as number,
  };
}

function createTestIncludeState(): IncludeState {
  const int4ColumnMeta: StorageColumn = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: false,
  };

  return {
    alias: 'posts',
    table: { kind: 'table', name: 'post' },
    on: {
      kind: 'join-on',
      left: int4ColumnMeta,
      right: int4ColumnMeta,
    },
    childProjection: {
      aliases: ['id'],
      columns: [], // Will be filled by test
    },
  };
}

function createTestIncludeAst(): IncludeAst[] {
  return [
    {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
        project: [{ alias: 'id', expr: createColumnRef('post', 'id') }],
      },
    },
  ];
}

function createTestWhereExpr(): BinaryExpr {
  return {
    kind: 'bin',
    op: 'eq',
    left: createColumnRef('user', 'id'),
    right: { kind: 'param', index: 1, name: 'userId' },
  };
}

function createTestOrderByClause(
  dir: Direction = 'asc',
): Array<{ expr: ColumnRef | OperationExpr; dir: Direction }> {
  return [
    {
      expr: createColumnRef('user', 'id'),
      dir,
    },
  ];
}

function createTestExistsExpr(): ExistsExpr {
  return {
    kind: 'exists',
    subquery: {
      kind: 'select',
      from: { kind: 'table', name: 'post' },
      project: [{ alias: '_exists', expr: createColumnRef('post', 'id') }],
    },
    not: false,
  };
}

describe('select-builder', () => {
  const contract = createTestContract();
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema(context).tables;

  describe('buildProjectionItems', () => {
    it('builds projection items with include reference', () => {
      const projectionState: ProjectionState = {
        aliases: ['posts'],
        columns: [tables['user']!.columns['id']!],
      };
      const includesForMeta: IncludeState[] = [
        {
          ...createTestIncludeState(),
          childProjection: {
            aliases: ['id'],
            columns: [tables['post']!.columns['id']!],
          },
        },
      ];

      const result = buildProjectionItems(projectionState, includesForMeta);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        alias: 'posts',
        expr: { kind: 'includeRef', alias: 'posts' },
      });
    });

    it('builds projection items with operation expression', () => {
      const operationExpr = createTestOperationExpr();
      const expressionBuilder = createTestExpressionBuilder(operationExpr);
      const projectionState: ProjectionState = {
        aliases: ['id_plus_one'],
        columns: [expressionBuilder],
      };

      const result = buildProjectionItems(projectionState, []);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        alias: 'id_plus_one',
        expr: operationExpr,
      });
    });

    it('builds projection items with column reference', () => {
      const projectionState: ProjectionState = {
        aliases: ['id'],
        columns: [tables['user']!.columns['id']!],
      };

      const result = buildProjectionItems(projectionState, []);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        alias: 'id',
        expr: { kind: 'col', table: 'user', column: 'id' },
      });
    });

    it('builds projection items with mixed includes and columns', () => {
      const operationExpr = createTestOperationExpr();
      const expressionBuilder = createTestExpressionBuilder(operationExpr);
      const projectionState: ProjectionState = {
        aliases: ['id', 'posts', 'email'],
        columns: [
          tables['user']!.columns['id']!,
          tables['user']!.columns['id']!,
          expressionBuilder,
        ],
      };
      const includesForMeta: IncludeState[] = [
        {
          ...createTestIncludeState(),
          childProjection: {
            aliases: ['id'],
            columns: [tables['post']!.columns['id']!],
          },
        },
      ];

      const result = buildProjectionItems(projectionState, includesForMeta);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        alias: 'id',
        expr: { kind: 'col', table: 'user', column: 'id' },
      });
      expect(result[1]).toMatchObject({
        alias: 'posts',
        expr: { kind: 'includeRef', alias: 'posts' },
      });
      expect(result[2]).toMatchObject({
        alias: 'email',
        expr: operationExpr,
      });
    });

    it('throws error when alias is missing', () => {
      const projectionState: ProjectionState = {
        aliases: [undefined as unknown as string],
        columns: [tables['user']!.columns['id']!],
      };

      expect(() => buildProjectionItems(projectionState, [])).toThrow('Missing alias at index 0');
    });

    it('throws error when column is missing', () => {
      const projectionState: ProjectionState = {
        aliases: ['id'],
        columns: [undefined as unknown as AnyExpressionSource],
      };

      expect(() => buildProjectionItems(projectionState, [])).toThrow(
        'Missing column for alias "id" at index 0',
      );
    });

    it('throws error when column has invalid table or column name', () => {
      const projectionState: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            ...tables['user']!.columns['id']!,
            table: undefined as unknown as string,
            column: undefined as unknown as string,
            // Provide toExpr that returns invalid ColumnRef
            toExpr: () => ({
              kind: 'col',
              table: undefined as unknown as string,
              column: undefined as unknown as string,
            }),
          } as AnyExpressionSource,
        ],
      };

      expect(() => buildProjectionItems(projectionState, [])).toThrow(
        'Invalid column for alias "id" at index 0',
      );
    });
  });

  describe('buildSelectAst', () => {
    const table: TableRef = { kind: 'table', name: 'user' };
    const projectEntries = [
      {
        alias: 'id',
        expr: createColumnRef('user', 'id') as ColumnRef,
      },
    ];

    it('builds select AST with all optional parameters', () => {
      const includesAst = createTestIncludeAst();
      const whereExpr = createTestWhereExpr();
      const orderByClause = createTestOrderByClause('asc');
      const limit = 10;

      const result = buildSelectAst({
        table,
        projectEntries,
        includesAst,
        whereExpr,
        orderByClause,
        limit,
      });

      expect(result).toMatchObject({
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: projectEntries,
        includes: includesAst,
        where: whereExpr,
        orderBy: orderByClause,
        limit,
      });
    });

    it('builds select AST without optional parameters', () => {
      const result = buildSelectAst({
        table,
        projectEntries,
      });

      expect(result).toMatchObject({
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: projectEntries,
      });
      expect(result.includes).toBeUndefined();
      expect(result.where).toBeUndefined();
      expect(result.orderBy).toBeUndefined();
      expect(result.limit).toBeUndefined();
    });

    it('builds select AST with only includes', () => {
      const includesAst = createTestIncludeAst();
      const result = buildSelectAst({
        table,
        projectEntries,
        includesAst,
      });

      expect(result).toMatchObject({
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: projectEntries,
        includes: includesAst,
      });
    });

    it('builds select AST with only where clause', () => {
      const whereExpr = createTestWhereExpr();
      const result = buildSelectAst({
        table,
        projectEntries,
        whereExpr,
      });

      expect(result).toMatchObject({
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: projectEntries,
        where: whereExpr,
      });
    });

    it('builds select AST with only orderBy clause', () => {
      const orderByClause = createTestOrderByClause('desc');
      const result = buildSelectAst({
        table,
        projectEntries,
        orderByClause,
      });

      expect(result).toMatchObject({
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: projectEntries,
        orderBy: orderByClause,
      });
    });

    it('builds select AST with only limit', () => {
      const limit = 5;
      const result = buildSelectAst({
        table,
        projectEntries,
        limit,
      });

      expect(result).toMatchObject({
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: projectEntries,
        limit,
      });
    });

    it('builds select AST with ExistsExpr in where clause', () => {
      const existsExpr = createTestExistsExpr();

      const result = buildSelectAst({
        table,
        projectEntries,
        whereExpr: existsExpr,
      });

      expect(result.where).toEqual(existsExpr);
    });
  });
});
