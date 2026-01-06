import type { PlanMeta } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  LoweredStatement,
  OperationExpr,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  AnyOrderBuilder,
  BinaryBuilder,
  ExpressionBuilder,
} from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { buildMeta, createPlan, createPlanWithExists } from '../../src/plan/plan-assembly';
import type { IncludeState } from '../../src/relations/include-plan';
import type { ProjectionState } from '../../src/selection/projection';

describe('plan assembly', () => {
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
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };

  const table: TableRef = { kind: 'table', name: 'user' };

  // Helper to create mock column builder
  function createMockColumnBuilder(
    table: string,
    column: string,
    columnMeta: { codecId: string; nativeType: string; nullable: boolean },
  ): AnyColumnBuilder {
    const colRef = createColumnRef(table, column);
    return {
      kind: 'column',
      table,
      column,
      columnMeta: {
        nativeType: columnMeta.nativeType,
        codecId: columnMeta.codecId,
        nullable: columnMeta.nullable,
      },
      toExpr: () => colRef,
      eq: () => ({ kind: 'binary', op: 'eq', left: colRef, right: {} as unknown }),
      asc: () => ({ kind: 'order', expr: colRef, dir: 'asc' }),
      desc: () => ({ kind: 'order', expr: colRef, dir: 'desc' }),
      __jsType: undefined,
    } as unknown as AnyColumnBuilder;
  }

  function createMockExpressionBuilder(operationExpr: OperationExpr): ExpressionBuilder {
    return {
      kind: 'expression',
      expr: operationExpr,
      columnMeta: {
        nativeType: 'int4',
        codecId: operationExpr.returns.kind === 'typeId' ? operationExpr.returns.type : 'pg/int4@1',
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
      __jsType: undefined as unknown,
    };
  }

  describe('buildMeta', () => {
    it('builds meta with simple projection', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
        ],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect({
        lane: meta.lane,
        tables: meta.refs?.tables,
        columnCount: meta.refs?.columns?.length,
        columnTable: meta.refs?.columns?.[0]?.table,
        columnColumn: meta.refs?.columns?.[0]?.column,
        projection: meta.projection,
      }).toMatchObject({
        lane: 'dsl',
        tables: ['user'],
        columnCount: 1,
        columnTable: 'user',
        columnColumn: 'id',
        projection: { id: 'user.id' },
      });
    });

    it('builds meta with operation expr in projection', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: {
          kind: 'typeId',
          type: 'pg/int4@1',
        },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };

      const projection: ProjectionState = {
        aliases: ['sum'],
        columns: [createMockExpressionBuilder(operationExpr)],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect({
        projection: meta.projection,
        projectionTypes: meta.projectionTypes,
        codecs: meta.annotations?.codecs,
      }).toMatchObject({
        projection: { sum: 'operation:add' },
        projectionTypes: { sum: 'pg/int4@1' },
        codecs: { sum: 'pg/int4@1' },
      });
    });

    it('builds meta with operation expr returning builtin type', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'count',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: {
          kind: 'builtin',
          type: 'number',
        },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'count(${self})',
        },
      };

      const projection: ProjectionState = {
        aliases: ['count'],
        columns: [createMockExpressionBuilder(operationExpr)],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.projectionTypes).toEqual({ count: 'number' });
      expect(meta.annotations?.codecs).toBeUndefined();
    });

    it('builds meta with includes', () => {
      const projection: ProjectionState = {
        aliases: ['id', 'posts'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
          createMockColumnBuilder('post', '', {
            codecId: 'core/json@1',
            nativeType: 'jsonb',
            nullable: true,
          }),
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            right: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
              }),
            ],
          },
        },
      ];

      const args = {
        contract,
        table,
        projection,
        includes,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.refs?.tables).toContain('user');
      expect(meta.refs?.tables).toContain('post');
      expect(meta.projection).toEqual({ id: 'user.id', posts: 'include:posts' });
    });

    it('builds meta with where clause', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
        ],
      };

      const where: BinaryBuilder = {
        kind: 'binary',
        left: createColumnRef('user', 'id') as unknown as BinaryBuilder['left'],
        right: { kind: 'param-placeholder', name: 'userId' },
        op: 'eq',
      };

      const args = {
        contract,
        table,
        projection,
        where,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect({
        columnCount: meta.refs?.columns?.length,
        columnTable: meta.refs?.columns?.[0]?.table,
        columnColumn: meta.refs?.columns?.[0]?.column,
      }).toMatchObject({
        columnCount: 1,
        columnTable: 'user',
        columnColumn: 'id',
      });
    });

    it('builds meta with where clause operation expr', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
        ],
      };

      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: {
          kind: 'typeId',
          type: 'pg/int4@1',
        },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };

      const expressionBuilder = createMockExpressionBuilder(operationExpr);
      const where: BinaryBuilder = {
        kind: 'binary',
        left: expressionBuilder.toExpr(),
        right: { kind: 'param-placeholder', name: 'value' },
        op: 'eq',
      };

      const args = {
        contract,
        table,
        projection,
        where,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect({
        columnCount: meta.refs?.columns?.length,
        columnTable: meta.refs?.columns?.[0]?.table,
        columnColumn: meta.refs?.columns?.[0]?.column,
      }).toMatchObject({
        columnCount: 1,
        columnTable: 'user',
        columnColumn: 'id',
      });
    });

    it('builds meta with orderBy clause', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
        ],
      };

      const orderBy: AnyOrderBuilder = {
        expr: {
          table: 'user',
          column: 'id',
        },
        dir: 'asc',
      } as AnyOrderBuilder;

      const args = {
        contract,
        table,
        projection,
        orderBy,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect({
        columnCount: meta.refs?.columns?.length,
        columnTable: meta.refs?.columns?.[0]?.table,
        columnColumn: meta.refs?.columns?.[0]?.column,
      }).toMatchObject({
        columnCount: 1,
        columnTable: 'user',
        columnColumn: 'id',
      });
    });

    it('builds meta with orderBy operation expr', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
        ],
      };

      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: {
          kind: 'typeId',
          type: 'pg/int4@1',
        },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };

      const orderBy: AnyOrderBuilder = {
        expr: operationExpr,
        dir: 'desc',
      } as AnyOrderBuilder;

      const args = {
        contract,
        table,
        projection,
        orderBy,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect({
        columnCount: meta.refs?.columns?.length,
        columnTable: meta.refs?.columns?.[0]?.table,
        columnColumn: meta.refs?.columns?.[0]?.column,
      }).toMatchObject({
        columnCount: 1,
        columnTable: 'user',
        columnColumn: 'id',
      });
    });

    it('builds meta with include childWhere', () => {
      const projection: ProjectionState = {
        aliases: ['id', 'posts'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
          createMockColumnBuilder('post', '', {
            codecId: 'core/json@1',
            nativeType: 'jsonb',
            nullable: true,
          }),
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            right: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
              }),
            ],
          },
          childWhere: {
            kind: 'binary',
            left: createColumnRef('post', 'id') as unknown as BinaryBuilder['left'],
            right: { kind: 'param-placeholder', name: 'postId' },
            op: 'eq',
          } as BinaryBuilder,
        },
      ];

      const args = {
        contract,
        table,
        projection,
        includes,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.refs?.columns).toHaveLength(2);
      const postIdRef = meta.refs?.columns?.find((c) => c.table === 'post' && c.column === 'id');
      expect(postIdRef).toBeDefined();
    });

    it('builds meta with include childOrderBy', () => {
      const projection: ProjectionState = {
        aliases: ['id', 'posts'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
          createMockColumnBuilder('post', '', {
            codecId: 'core/json@1',
            nativeType: 'jsonb',
            nullable: true,
          }),
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            right: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
              }),
            ],
          },
          childOrderBy: {
            expr: {
              table: 'post',
              column: 'id',
            },
            dir: 'asc',
          } as AnyOrderBuilder,
        },
      ];

      const args = {
        contract,
        table,
        projection,
        includes,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.refs?.columns).toHaveLength(2);
      const postIdRef = meta.refs?.columns?.find((c) => c.table === 'post' && c.column === 'id');
      expect(postIdRef).toBeDefined();
    });

    it('builds meta with paramCodecs merged with projection codecs', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          createMockColumnBuilder('user', 'id', {
            codecId: 'pg/int4@1',
            nativeType: 'int4',
            nullable: false,
          }),
        ],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
        paramCodecs: { userId: 'pg/int4@1' },
      };

      const meta = buildMeta(args);

      expect({
        hasId: Object.hasOwn(meta.annotations?.codecs ?? {}, 'id'),
        hasUserId: Object.hasOwn(meta.annotations?.codecs ?? {}, 'userId'),
        idCodec: meta.annotations?.codecs?.['id'],
        userIdCodec: meta.annotations?.codecs?.['userId'],
      }).toMatchObject({
        hasId: true,
        hasUserId: true,
        idCodec: 'pg/int4@1',
        userIdCodec: 'pg/int4@1',
      });
    });

    it('builds meta without annotations when no codecs', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { nullable: false },
            eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
            asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
            desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
            __jsType: undefined,
          } as unknown as AnyColumnBuilder,
        ],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.annotations).toBeUndefined();
    });

    it('builds meta without projectionTypes when empty', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { nullable: false },
            eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
            asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
            desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
            __jsType: undefined,
          } as unknown as AnyColumnBuilder,
        ],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.projectionTypes).toBeUndefined();
    });

    it('builds meta with column without table or column', () => {
      const projection: ProjectionState = {
        aliases: ['include_alias'],
        columns: [
          {
            kind: 'column',
            table: '',
            column: '',
            columnMeta: {
              nativeType: 'jsonb',
              codecId: 'core/json@1',
              nullable: true,
            },
            eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
            asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
            desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
            __jsType: undefined,
          } as unknown as AnyColumnBuilder,
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'include_alias',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            right: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
              }),
            ],
          },
        },
      ];

      const args = {
        contract,
        table,
        projection,
        includes,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.projection).toEqual({ include_alias: 'include:include_alias' });
    });

    it('throws error when column is missing for alias', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      expect(() => buildMeta(args)).toThrow('Missing column for alias id at index 0');
    });
  });

  describe('createPlan', () => {
    it('creates plan with meta', () => {
      const ast: SelectAst = {
        kind: 'select',
        from: table,
        project: [],
      };
      const lowered = {
        body: {
          sql: 'SELECT * FROM user',
          params: [],
        } as LoweredStatement,
      };
      const paramValues: unknown[] = [];
      const planMeta: PlanMeta = {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        refs: {
          tables: ['user'],
          columns: [],
        },
        projection: {},
        paramDescriptors: [],
      };

      const plan = createPlan(ast, lowered, paramValues, planMeta);

      expect(plan.meta.lane).toBe('orm');
      expect(plan.sql).toBe('SELECT * FROM user');
      expect(plan.params).toEqual([]);
    });

    it('creates plan with params from lowered body', () => {
      const ast: SelectAst = {
        kind: 'select',
        from: table,
        project: [],
      };
      const lowered = {
        body: {
          sql: 'SELECT * FROM user WHERE id = $1',
          params: [1],
        } as LoweredStatement,
      };
      const paramValues: unknown[] = [];
      const planMeta: PlanMeta = {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        refs: {
          tables: ['user'],
          columns: [],
        },
        projection: {},
        paramDescriptors: [],
      };

      const plan = createPlan(ast, lowered, paramValues, planMeta);

      expect(plan.params).toEqual([1]);
    });

    it('creates plan with params from paramValues when lowered body params is undefined', () => {
      const ast: SelectAst = {
        kind: 'select',
        from: table,
        project: [],
      };
      const lowered = {
        body: {
          sql: 'SELECT * FROM user WHERE id = $1',
          params: undefined,
        } as unknown as LoweredStatement,
      };
      const paramValues: unknown[] = [1];
      const planMeta: PlanMeta = {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        refs: {
          tables: ['user'],
          columns: [],
        },
        projection: {},
        paramDescriptors: [],
      };

      const plan = createPlan(ast, lowered, paramValues, planMeta);

      expect(plan.params).toEqual([1]);
    });
  });

  describe('createPlanWithExists', () => {
    it('creates plan with exists expr', () => {
      const ast: SelectAst = {
        kind: 'select',
        from: table,
        project: [],
      };
      const combinedWhere = {
        kind: 'exists' as const,
        subquery: {
          kind: 'select' as const,
          from: { kind: 'table' as const, name: 'post' },
          project: [],
        },
        not: false,
      };
      const lowered = {
        body: {
          sql: 'SELECT * FROM user WHERE EXISTS (SELECT * FROM post)',
          params: [],
        } as LoweredStatement,
      };
      const paramValues: unknown[] = [];
      const planMeta: PlanMeta = {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        refs: {
          tables: ['user'],
          columns: [],
        },
        projection: {},
        paramDescriptors: [],
      };

      const plan = createPlanWithExists(ast, combinedWhere, lowered, paramValues, planMeta);

      expect((plan.ast as SelectAst).where).toBe(combinedWhere);
      expect(plan.meta.lane).toBe('orm');
    });

    it('creates plan without where when combinedWhere is undefined', () => {
      const ast: SelectAst = {
        kind: 'select',
        from: table,
        project: [],
      };
      const lowered = {
        body: {
          sql: 'SELECT * FROM user',
          params: [],
        } as LoweredStatement,
      };
      const paramValues: unknown[] = [];
      const planMeta: PlanMeta = {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        refs: {
          tables: ['user'],
          columns: [],
        },
        projection: {},
        paramDescriptors: [],
      };

      const plan = createPlanWithExists(ast, undefined, lowered, paramValues, planMeta);

      expect((plan.ast as SelectAst).where).toBeUndefined();
      expect(plan.meta.lane).toBe('orm');
    });
  });
});
