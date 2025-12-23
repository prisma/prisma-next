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
import { createExpressionBuilder } from '@prisma-next/sql-relational-core/expression-builder';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import type { IncludeState } from '../../src/relations/include-plan';
import type { ProjectionState } from '../../src/selection/projection';
import { buildProjectionItems, buildSelectAst } from '../../src/selection/select-builder';

describe('select-builder', () => {
  const contract: SqlContract<SqlStorage> = {
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
    meta: {},
    sources: {},
  };

  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema(context).tables;

  describe('buildProjectionItems', () => {
    const int4ColumnMeta: StorageColumn = {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    };

    it('builds projection items with include reference', () => {
      const projectionState: ProjectionState = {
        aliases: ['posts'],
        columns: [tables['user']!.columns['id']!],
      };
      const includesForMeta: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: int4ColumnMeta,
            right: int4ColumnMeta,
          },
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
      const operationExpr: OperationExpr = {
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
      const columnWithOperation = createExpressionBuilder(operationExpr, {
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      });
      const projectionState: ProjectionState = {
        aliases: ['id_plus_one'],
        columns: [columnWithOperation],
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
      const operationExpr: OperationExpr = {
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
      const columnWithOperation = createExpressionBuilder(operationExpr, {
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      });
      const projectionState: ProjectionState = {
        aliases: ['id', 'posts', 'email'],
        columns: [
          tables['user']!.columns['id']!,
          tables['user']!.columns['id']!,
          columnWithOperation,
        ],
      };
      const includesForMeta: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: int4ColumnMeta,
            right: int4ColumnMeta,
          },
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
        columns: [undefined as unknown as AnyColumnBuilder],
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
          },
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
      const includesAst: IncludeAst[] = [
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
      const whereExpr: BinaryExpr = {
        kind: 'bin',
        op: 'eq',
        left: createColumnRef('user', 'id'),
        right: { kind: 'param', index: 1, name: 'userId' },
      };
      const orderByClause: Array<{ expr: ColumnRef | OperationExpr; dir: Direction }> = [
        {
          expr: createColumnRef('user', 'id'),
          dir: 'asc',
        },
      ];
      const limit = 10;

      const result = buildSelectAst(
        table,
        projectEntries,
        includesAst,
        whereExpr,
        orderByClause,
        limit,
      );

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
      const result = buildSelectAst(
        table,
        projectEntries,
        undefined,
        undefined,
        undefined,
        undefined,
      );

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
      const includesAst: IncludeAst[] = [
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

      const result = buildSelectAst(
        table,
        projectEntries,
        includesAst,
        undefined,
        undefined,
        undefined,
      );

      expect(result.includes).toEqual(includesAst);
    });

    it('builds select AST with only where clause', () => {
      const whereExpr: BinaryExpr = {
        kind: 'bin',
        op: 'eq',
        left: createColumnRef('user', 'id'),
        right: { kind: 'param', index: 1, name: 'userId' },
      };

      const result = buildSelectAst(
        table,
        projectEntries,
        undefined,
        whereExpr,
        undefined,
        undefined,
      );

      expect(result.where).toEqual(whereExpr);
    });

    it('builds select AST with only orderBy clause', () => {
      const orderByClause: Array<{ expr: ColumnRef | OperationExpr; dir: Direction }> = [
        {
          expr: createColumnRef('user', 'id'),
          dir: 'desc',
        },
      ];

      const result = buildSelectAst(
        table,
        projectEntries,
        undefined,
        undefined,
        orderByClause,
        undefined,
      );

      expect(result.orderBy).toEqual(orderByClause);
    });

    it('builds select AST with only limit', () => {
      const limit = 5;

      const result = buildSelectAst(table, projectEntries, undefined, undefined, undefined, limit);

      expect(result.limit).toBe(limit);
    });

    it('builds select AST with ExistsExpr in where clause', () => {
      const existsExpr: ExistsExpr = {
        kind: 'exists',
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'post' },
          project: [{ alias: '_exists', expr: createColumnRef('post', 'id') }],
        },
        not: false,
      };

      const result = buildSelectAst(
        table,
        projectEntries,
        undefined,
        existsExpr,
        undefined,
        undefined,
      );

      expect(result.where).toEqual(existsExpr);
    });
  });
});
