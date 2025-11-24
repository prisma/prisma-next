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
  AnyPredicateBuilder,
  BinaryBuilder,
  LogicalBuilder,
} from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { addLogicalMethodsToBinaryBuilder } from '../../../relational-core/src/logical-builder';
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
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            userId: { type: 'pg/int4@1', nullable: false },
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

  const table: TableRef = { kind: 'table', name: 'user' };

  // Helper to create mock column builder
  function createMockColumnBuilder(
    table: string,
    column: string,
    columnMeta: { type: string; nullable: boolean },
  ): AnyColumnBuilder {
    return {
      kind: 'column',
      table,
      column,
      columnMeta,
      eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
      asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
      desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
      __jsType: undefined,
    } as unknown as AnyColumnBuilder;
  }

  // Helper to create mock binary builder with stub and/or methods
  function createMockBinaryBuilder(
    left: AnyColumnBuilder | OperationExpr,
    op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte',
    right: { kind: 'param-placeholder'; name: string },
  ): BinaryBuilder {
    return {
      kind: 'binary',
      op,
      left,
      right,
      and(_expr: AnyPredicateBuilder): LogicalBuilder {
        throw new Error(
          'and() should not be called on mock BinaryBuilder - use addLogicalMethodsToBinaryBuilder',
        );
      },
      or(_expr: AnyPredicateBuilder): LogicalBuilder {
        throw new Error(
          'or() should not be called on mock BinaryBuilder - use addLogicalMethodsToBinaryBuilder',
        );
      },
    };
  }

  describe('buildMeta', () => {
    it('builds meta with simple projection', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
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
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
            _operationExpr: operationExpr,
          } as unknown as ProjectionState['columns'][0],
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
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
            _operationExpr: operationExpr,
          } as unknown as ProjectionState['columns'][0],
        ],
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
          createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false }),
          createMockColumnBuilder('post', '', { type: 'core/json@1', nullable: true }),
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { type: 'pg/int4@1', nullable: false },
            right: { type: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', { type: 'pg/int4@1', nullable: false }),
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
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
      };

      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', {
        kind: 'param-placeholder',
        name: 'userId',
      });
      const where = addLogicalMethodsToBinaryBuilder(whereBase);

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
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
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

      const columnBuilderWithOp = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      (columnBuilderWithOp as { _operationExpr?: OperationExpr })._operationExpr = operationExpr;
      const whereBase = createMockBinaryBuilder(columnBuilderWithOp, 'eq', {
        kind: 'param-placeholder',
        name: 'value',
      });
      const where = addLogicalMethodsToBinaryBuilder(whereBase);

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

    it('builds meta with nested logical expression in where clause', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
      };

      const idColumn = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const emailColumn = createMockColumnBuilder('user', 'email', {
        type: 'pg/text@1',
        nullable: false,
      });
      const whereBase1 = createMockBinaryBuilder(idColumn, 'eq', {
        kind: 'param-placeholder',
        name: 'id1',
      });
      const whereBase2 = createMockBinaryBuilder(emailColumn, 'eq', {
        kind: 'param-placeholder',
        name: 'email1',
      });
      const whereBase3 = createMockBinaryBuilder(emailColumn, 'eq', {
        kind: 'param-placeholder',
        name: 'email2',
      });
      const where1 = addLogicalMethodsToBinaryBuilder(whereBase1);
      const where2 = addLogicalMethodsToBinaryBuilder(whereBase2);
      const where3 = addLogicalMethodsToBinaryBuilder(whereBase3);
      const where = where1.and(where2.or(where3));

      const args = {
        contract,
        table,
        projection,
        where,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      // Should collect columns from all predicates: id, email (from where2), email (from where3)
      // email appears twice but should be deduplicated by Map key
      expect({
        columnCount: meta.refs?.columns?.length,
        columns: meta.refs?.columns?.map((c) => `${c.table}.${c.column}`).sort(),
      }).toMatchObject({
        columnCount: 2, // id and email (deduplicated)
        columns: ['user.email', 'user.id'],
      });
    });

    it('builds meta with orderBy clause', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
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
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
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
          createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false }),
          createMockColumnBuilder('post', '', { type: 'core/json@1', nullable: true }),
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { type: 'pg/int4@1', nullable: false },
            right: { type: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', { type: 'pg/int4@1', nullable: false }),
            ],
          },
          childWhere: createMockBinaryBuilder(
            createMockColumnBuilder('post', 'id', { type: 'pg/int4@1', nullable: false }),
            'eq',
            { kind: 'param-placeholder', name: 'postId' },
          ),
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
          createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false }),
          createMockColumnBuilder('post', '', { type: 'core/json@1', nullable: true }),
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'join-on',
            left: { type: 'pg/int4@1', nullable: false },
            right: { type: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', { type: 'pg/int4@1', nullable: false }),
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
        columns: [createMockColumnBuilder('user', 'id', { type: 'pg/int4@1', nullable: false })],
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
            columnMeta: { type: 'core/json@1', nullable: true },
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
            left: { type: 'pg/int4@1', nullable: false },
            right: { type: 'pg/int4@1', nullable: false },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', { type: 'pg/int4@1', nullable: false }),
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
