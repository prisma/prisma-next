import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { JoinOnExpr, TableRef } from '@prisma-next/sql-relational-core/ast';
import {
  int4Column as int4ColumnType,
  textColumn as textColumnType,
} from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createColumnRef, createTableRef } from '../../src/ast/common';
import { createJoin, createJoinOnBuilder, createJoinOnExpr } from '../../src/ast/join';
import { schema } from '../../src/schema';
import { createStubAdapter, createTestContext } from '../utils';

type TestContract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly userId: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  SqlMappings
>;

describe('ast/join', () => {
  const contract = validateContract<TestContract>({
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'test-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { ...int4ColumnType, nullable: false },
            email: { ...textColumnType, nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { ...int4ColumnType, nullable: false },
            userId: { ...int4ColumnType, nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  });

  describe('createJoin', () => {
    it('creates inner join', () => {
      const table: TableRef = createTableRef('post');
      const on: JoinOnExpr = createJoinOnExpr(
        createColumnRef('user', 'id'),
        createColumnRef('post', 'userId'),
      );

      const join = createJoin('inner', table, on);

      expect(join).toEqual({
        kind: 'join',
        joinType: 'inner',
        table,
        on,
      });
    });

    it('creates left join', () => {
      const table: TableRef = createTableRef('post');
      const on: JoinOnExpr = createJoinOnExpr(
        createColumnRef('user', 'id'),
        createColumnRef('post', 'userId'),
      );

      const join = createJoin('left', table, on);

      expect(join.joinType).toBe('left');
    });

    it('creates right join', () => {
      const table: TableRef = createTableRef('post');
      const on: JoinOnExpr = createJoinOnExpr(
        createColumnRef('user', 'id'),
        createColumnRef('post', 'userId'),
      );

      const join = createJoin('right', table, on);

      expect(join.joinType).toBe('right');
    });

    it('creates full join', () => {
      const table: TableRef = createTableRef('post');
      const on: JoinOnExpr = createJoinOnExpr(
        createColumnRef('user', 'id'),
        createColumnRef('post', 'userId'),
      );

      const join = createJoin('full', table, on);

      expect(join.joinType).toBe('full');
    });
  });

  describe('createJoinOnExpr', () => {
    it('creates join on expr with left and right column refs', () => {
      const left = createColumnRef('user', 'id');
      const right = createColumnRef('post', 'userId');

      const joinOnExpr = createJoinOnExpr(left, right);

      expect(joinOnExpr).toEqual({
        kind: 'eqCol',
        left,
        right,
      });
    });

    it('creates join on expr with different columns', () => {
      const left = createColumnRef('user', 'email');
      const right = createColumnRef('post', 'authorEmail');

      const joinOnExpr = createJoinOnExpr(left, right);

      expect(joinOnExpr.left).toBe(left);
      expect(joinOnExpr.right).toBe(right);
    });
  });

  describe('createJoinOnBuilder', () => {
    it('creates join on builder', () => {
      const builder = createJoinOnBuilder();
      expect(builder).toBeDefined();
      expect(typeof builder.eqCol).toBe('function');
    });

    it('creates join on predicate with valid column builders', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;

      const builder = createJoinOnBuilder();
      const predicate = builder.eqCol(tables.user.columns.id, tables.post.columns.userId);

      expect(predicate).toBeDefined();
      expect(predicate.kind).toBe('join-on');
      expect(predicate.left).toBe(tables.user.columns.id);
      expect(predicate.right).toBe(tables.post.columns.userId);
    });

    it('throws error when left operand is not a column builder', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;

      const builder = createJoinOnBuilder();

      expect(() => {
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        builder.eqCol(null as any, tables.post.columns.userId);
      }).toThrow('Join ON left operand must be a column');

      expect(() => {
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        builder.eqCol(undefined as any, tables.post.columns.userId);
      }).toThrow('Join ON left operand must be a column');
    });

    it('throws error when right operand is not a column builder', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;

      const builder = createJoinOnBuilder();

      expect(() => {
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        builder.eqCol(tables.user.columns.id, null as any);
      }).toThrow('Join ON right operand must be a column');

      expect(() => {
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        builder.eqCol(tables.user.columns.id, undefined as any);
      }).toThrow('Join ON right operand must be a column');
    });

    it('throws error for self-joins', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;

      const builder = createJoinOnBuilder();

      expect(() => {
        builder.eqCol(tables.user.columns.id, tables.user.columns.id);
      }).toThrow('Self-joins are not supported in MVP');
    });
  });
});
