import type { ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import type { AnyOrderBuilder, BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import type {
  OperationExpr,
  SelectAst,
  SqlContract,
  SqlStorage,
  TableRef,
} from '@prisma-next/sql-target';
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

  const table: TableRef = { name: 'user', alias: 'u' };

  describe('buildMeta', () => {
    it('builds meta with simple projection', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
        ],
      };

      const args = {
        contract,
        table,
        projection,
        paramDescriptors: [],
      };

      const meta = buildMeta(args);

      expect(meta.lane).toBe('dsl');
      expect(meta.refs.tables).toEqual(['user']);
      expect(meta.refs.columns).toHaveLength(1);
      expect(meta.refs.columns[0]?.table).toBe('user');
      expect(meta.refs.columns[0]?.column).toBe('id');
      expect(meta.projection).toEqual({ id: 'user.id' });
    });

    it('builds meta with operation expr in projection', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        method: 'add',
        self: {
          kind: 'col',
          table: 'user',
          column: 'id',
        },
        args: [],
        returns: {
          kind: 'typeId',
          type: 'pg/int4@1',
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

      expect(meta.projection).toEqual({ sum: 'operation:add' });
      expect(meta.projectionTypes).toEqual({ sum: 'pg/int4@1' });
      expect(meta.annotations?.codecs).toEqual({ sum: 'pg/int4@1' });
    });

    it('builds meta with operation expr returning builtin type', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'count',
        method: 'count',
        self: {
          kind: 'col',
          table: 'user',
          column: 'id',
        },
        args: [],
        returns: {
          kind: 'builtin',
          type: 'number',
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
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
          {
            kind: 'column',
            table: 'post',
            column: '',
            columnMeta: { type: 'core/json@1', nullable: true },
          },
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { name: 'post', alias: 'p' },
          on: {
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              {
                kind: 'column',
                table: 'post',
                column: 'id',
                columnMeta: { type: 'pg/int4@1', nullable: false },
              },
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

      expect(meta.refs.tables).toContain('user');
      expect(meta.refs.tables).toContain('post');
      expect(meta.projection).toEqual({ id: 'user.id', posts: 'include:posts' });
    });

    it('builds meta with where clause', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
        ],
      };

      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'id',
        },
        right: { name: 'userId', index: 0 },
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

      expect(meta.refs.columns).toHaveLength(1);
      expect(meta.refs.columns[0]?.table).toBe('user');
      expect(meta.refs.columns[0]?.column).toBe('id');
    });

    it('builds meta with where clause operation expr', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
        ],
      };

      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        method: 'add',
        self: {
          kind: 'col',
          table: 'user',
          column: 'id',
        },
        args: [],
        returns: {
          kind: 'typeId',
          type: 'pg/int4@1',
        },
      };

      const where: BinaryBuilder = {
        left: {
          _operationExpr: operationExpr,
        } as unknown as BinaryBuilder['left'],
        right: { name: 'value', index: 0 },
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

      expect(meta.refs.columns).toHaveLength(1);
      expect(meta.refs.columns[0]?.table).toBe('user');
      expect(meta.refs.columns[0]?.column).toBe('id');
    });

    it('builds meta with orderBy clause', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
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

      expect(meta.refs.columns).toHaveLength(1);
      expect(meta.refs.columns[0]?.table).toBe('user');
      expect(meta.refs.columns[0]?.column).toBe('id');
    });

    it('builds meta with orderBy operation expr', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
        ],
      };

      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        method: 'add',
        self: {
          kind: 'col',
          table: 'user',
          column: 'id',
        },
        args: [],
        returns: {
          kind: 'typeId',
          type: 'pg/int4@1',
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

      expect(meta.refs.columns).toHaveLength(1);
      expect(meta.refs.columns[0]?.table).toBe('user');
      expect(meta.refs.columns[0]?.column).toBe('id');
    });

    it('builds meta with include childWhere', () => {
      const projection: ProjectionState = {
        aliases: ['id', 'posts'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
          {
            kind: 'column',
            table: 'post',
            column: '',
            columnMeta: { type: 'core/json@1', nullable: true },
          },
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { name: 'post', alias: 'p' },
          on: {
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              {
                kind: 'column',
                table: 'post',
                column: 'id',
                columnMeta: { type: 'pg/int4@1', nullable: false },
              },
            ],
          },
          childWhere: {
            left: {
              table: 'post',
              column: 'id',
            },
            right: { name: 'postId', index: 0 },
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

      expect(meta.refs.columns).toHaveLength(3);
      const postIdRef = meta.refs.columns.find((c) => c.table === 'post' && c.column === 'id');
      expect(postIdRef).toBeDefined();
    });

    it('builds meta with include childOrderBy', () => {
      const projection: ProjectionState = {
        aliases: ['id', 'posts'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
          {
            kind: 'column',
            table: 'post',
            column: '',
            columnMeta: { type: 'core/json@1', nullable: true },
          },
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'posts',
          table: { name: 'post', alias: 'p' },
          on: {
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              {
                kind: 'column',
                table: 'post',
                column: 'id',
                columnMeta: { type: 'pg/int4@1', nullable: false },
              },
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

      expect(meta.refs.columns).toHaveLength(3);
      const postIdRef = meta.refs.columns.find((c) => c.table === 'post' && c.column === 'id');
      expect(postIdRef).toBeDefined();
    });

    it('builds meta with paramCodecs merged with projection codecs', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: { type: 'pg/int4@1', nullable: false },
          },
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

      expect(meta.annotations?.codecs).toHaveProperty('id');
      expect(meta.annotations?.codecs).toHaveProperty('userId');
      expect(meta.annotations?.codecs?.id).toBe('pg/int4@1');
      expect(meta.annotations?.codecs?.userId).toBe('pg/int4@1');
    });

    it('builds meta without annotations when no codecs', () => {
      const projection: ProjectionState = {
        aliases: ['id'],
        columns: [
          {
            kind: 'column',
            table: 'user',
            column: 'id',
            columnMeta: {},
          },
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
            columnMeta: {},
          },
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
          },
        ],
      };

      const includes: IncludeState[] = [
        {
          alias: 'include_alias',
          table: { name: 'post', alias: 'p' },
          on: {
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              {
                kind: 'column',
                table: 'post',
                column: 'id',
                columnMeta: { type: 'pg/int4@1', nullable: false },
              },
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
        } as LoweredStatement,
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
        kind: 'exists',
        subquery: {
          kind: 'select',
          from: { name: 'post', alias: 'p' },
          project: [],
        },
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

      expect(plan.ast.where).toBe(combinedWhere);
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

      expect(plan.ast.where).toBeUndefined();
      expect(plan.meta.lane).toBe('orm');
    });
  });
});
