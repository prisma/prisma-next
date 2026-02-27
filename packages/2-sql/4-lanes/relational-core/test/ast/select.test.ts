import { describe, expect, it } from 'vitest';
import { createColumnRef, createParamRef, createTableRef } from '../../src/ast/common';
import { createJoin, createJoinOnExpr } from '../../src/ast/join';
import { createOrderByItem } from '../../src/ast/order';
import { createBinaryExpr, createExistsExpr } from '../../src/ast/predicate';
import { createSelectAst } from '../../src/ast/select';
import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  JoinAst,
  OperationExpr,
  SelectAst,
  TableRef,
} from '../../src/ast/types';

describe('ast/select', () => {
  describe('createSelectAst', () => {
    it('creates select ast with from and project', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
        {
          alias: 'email',
          expr: createColumnRef('user', 'email') as ColumnRef,
        },
      ];

      const selectAst = createSelectAst({ from, project });

      expect(selectAst).toEqual({
        kind: 'select',
        from,
        project,
      });
      expect(selectAst.kind).toBe('select');
      expect(selectAst.from).toBe(from);
      expect(selectAst.project).toBe(project);
      expect(selectAst.joins).toBeUndefined();
      expect(selectAst.includes).toBeUndefined();
      expect(selectAst.where).toBeUndefined();
      expect(selectAst.orderBy).toBeUndefined();
      expect(selectAst.limit).toBeUndefined();
      expect(selectAst.selectAllIntent).toBeUndefined();
    });

    it('creates select ast with selectAllIntent', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        { alias: 'id', expr: createColumnRef('user', 'id') as ColumnRef },
        { alias: 'email', expr: createColumnRef('user', 'email') as ColumnRef },
      ];

      const selectAst = createSelectAst({ from, project, selectAllIntent: { table: 'user' } });

      expect(selectAst.selectAllIntent).toEqual({ table: 'user' });
    });

    it('creates select ast with joins', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];
      const joins: JoinAst[] = [
        createJoin(
          'inner',
          createTableRef('post'),
          createJoinOnExpr(createColumnRef('user', 'id'), createColumnRef('post', 'userId')),
        ),
      ];

      const selectAst = createSelectAst({ from, project, joins });

      expect(selectAst.joins).toBe(joins);
      expect(selectAst.joins).toHaveLength(1);
    });

    it('creates select ast with where clause', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(0, 'userId'),
      );

      const selectAst = createSelectAst({ from, project, where });

      expect(selectAst.where).toBe(where);
    });

    it('creates select ast with orderBy', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];
      const orderBy = [
        createOrderByItem(createColumnRef('user', 'id'), 'asc'),
        createOrderByItem(createColumnRef('user', 'email'), 'desc'),
      ];

      const selectAst = createSelectAst({ from, project, orderBy });

      expect(selectAst.orderBy).toBe(orderBy);
      expect(selectAst.orderBy).toHaveLength(2);
    });

    it('creates select ast with limit', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];
      const limit = 10;

      const selectAst = createSelectAst({ from, project, limit });

      expect(selectAst.limit).toBe(10);
    });

    it('creates select ast with all optional fields', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];
      const joins: JoinAst[] = [
        createJoin(
          'left',
          createTableRef('post'),
          createJoinOnExpr(createColumnRef('user', 'id'), createColumnRef('post', 'userId')),
        ),
      ];
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(0, 'userId'),
      );
      const orderBy = [createOrderByItem(createColumnRef('user', 'id'), 'asc')];
      const limit = 5;

      const selectAst = createSelectAst({ from, project, joins, where, orderBy, limit });

      expect(selectAst.joins).toBe(joins);
      expect(selectAst.where).toBe(where);
      expect(selectAst.orderBy).toBe(orderBy);
      expect(selectAst.limit).toBe(limit);
    });

    it('creates select ast with operation expr in project', () => {
      const from: TableRef = createTableRef('user');
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'test',
        forTypeId: 'pg/text@1',
        self: createColumnRef('user', 'email'),
        args: [],
        returns: { kind: 'builtin', type: 'string' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'test(${self})',
        },
      };
      const project = [
        {
          alias: 'result',
          expr: operationExpr,
        },
      ];

      const selectAst = createSelectAst({ from, project });

      expect(selectAst.project[0]?.expr).toBe(operationExpr);
    });

    it('creates select ast with exists expr in where', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];
      const subquery: SelectAst = createSelectAst({
        from: createTableRef('post'),
        project: [
          {
            alias: 'id',
            expr: createColumnRef('post', 'id') as ColumnRef,
          },
        ],
      });
      const where: ExistsExpr = createExistsExpr(false, subquery);

      const selectAst = createSelectAst({ from, project, where });

      expect(selectAst.where).toBe(where);
      expect(selectAst.where?.kind).toBe('exists');
    });

    it('removes undefined optional fields', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];

      const selectAst = createSelectAst({ from, project });

      expect('joins' in selectAst).toBe(false);
      expect('includes' in selectAst).toBe(false);
      expect('where' in selectAst).toBe(false);
      expect('orderBy' in selectAst).toBe(false);
      expect('limit' in selectAst).toBe(false);
    });

    it('removes empty arrays from optional fields', () => {
      const from: TableRef = createTableRef('user');
      const project = [
        {
          alias: 'id',
          expr: createColumnRef('user', 'id') as ColumnRef,
        },
      ];

      const selectAst = createSelectAst({ from, project, joins: [] });

      expect('joins' in selectAst).toBe(false);
    });
  });
});
