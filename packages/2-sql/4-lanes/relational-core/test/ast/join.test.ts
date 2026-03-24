import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  int4Column as int4ColumnType,
  textColumn as textColumnType,
} from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createJoinOnBuilder } from '../../src/ast/join';
import { DerivedTableSource, EqColJoinOn, JoinAst } from '../../src/exports/ast';
import { schema } from '../../src/schema';
import { createStubAdapter, createTestContext } from '../utils';
import { col, simpleSelect, table } from './test-helpers';

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
    storageHash: 'test-hash',
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

  it('creates inner, left, right, and full joins with rich classes', () => {
    const on = EqColJoinOn.of(col('user', 'id'), col('post', 'userId'));

    expect(JoinAst.inner(table('post'), on)).toEqual(new JoinAst('inner', table('post'), on));
    expect(JoinAst.left(table('post'), on).joinType).toBe('left');
    expect(JoinAst.right(table('post'), on).joinType).toBe('right');
    expect(JoinAst.full(table('post'), on).joinType).toBe('full');
  });

  it('creates lateral joins for derived sources', () => {
    const derived = DerivedTableSource.as('post_subquery', simpleSelect('post', ['userId']));
    const on = EqColJoinOn.of(col('user', 'id'), col('post_subquery', 'userId'));

    const join = JoinAst.inner(derived, on, true);

    expect(join).toMatchObject({ source: derived, lateral: true, on });
  });

  it('rewrites join predicates through the AST rewriter', () => {
    const join = JoinAst.inner(
      table('post'),
      EqColJoinOn.of(col('user', 'id'), col('post', 'userId')),
    );

    const rewritten = join.rewrite({
      tableSource: (source) => (source.name === 'post' ? table('article') : source),
      eqColJoinOn: (on) =>
        EqColJoinOn.of(col(`rewritten_${on.left.table}`, on.left.column), on.right),
    });

    expect(rewritten.source).toEqual(table('article'));
    expect(rewritten.on).toEqual(
      EqColJoinOn.of(col('rewritten_user', 'id'), col('post', 'userId')),
    );
  });

  it('creates join-on predicates from valid column builders', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;

    const predicate = createJoinOnBuilder().eqCol(
      tables.user.columns.id,
      tables.post.columns.userId,
    );

    expect(predicate).toMatchObject({
      kind: 'join-on',
      left: tables.user.columns.id,
      right: tables.post.columns.userId,
    });
  });

  it('rejects invalid join-on operands and self-joins', () => {
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
      builder.eqCol(tables.user.columns.id, null as any);
    }).toThrow('Join ON right operand must be a column');

    expect(() => {
      builder.eqCol(tables.user.columns.id, tables.user.columns.id);
    }).toThrow('Self-joins are not supported in MVP');
  });
});
