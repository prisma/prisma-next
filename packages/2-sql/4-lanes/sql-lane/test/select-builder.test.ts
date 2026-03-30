import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { BinaryExpr, ColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('select builder edge cases', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('requires from() and select()', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context }).select({ id: tables.user.columns.id }).build(),
    ).toThrow('from() must be called before building a query');

    expect(() => sql<Contract, CodecTypes>({ context }).from(tables.user).build()).toThrow(
      'select() must be called before build()',
    );
  });

  it('rejects unknown tables, self-joins, and invalid limits', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from({ name: 'nonexistent' })
        .select({ id: tables.user.columns.id })
        .build(),
    ).toThrow('Unknown table nonexistent');

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .innerJoin(tables.user, (on) => on.eqCol(tables.user.columns.id, tables.user.columns.id))
        .select({ id: tables.user.columns.id })
        .build(),
    ).toThrow('Self-joins are not supported in MVP');

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({ id: tables.user.columns.id })
        .limit(-1)
        .build(),
    ).toThrow('Limit must be a non-negative integer');
  });

  it('throws when where parameters are missing', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .where(tables.user.columns.id.eq(param('userId')))
        .select({ id: tables.user.columns.id })
        .build({ params: {} }),
    ).toThrow('Missing value for parameter userId');
  });

  it('builds column-to-column comparisons and all join types', () => {
    const selectPlan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .where(tables.user.columns.id.eq(tables.user.columns.createdAt))
      .select({ id: tables.user.columns.id })
      .build();

    expect(selectPlan.ast.kind).toBe('select');
    expect((selectPlan.ast as SelectAst).where).toEqual(
      BinaryExpr.eq(ColumnRef.of('user', 'id'), ColumnRef.of('user', 'createdAt')),
    );

    const contractWithPosts = {
      ...contract,
      storage: {
        ...contract.storage,
        tables: {
          ...contract.storage.tables,
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    } as Contract;
    const joinContext = createFixtureContext(contractWithPosts);
    const joinTables = schema<Contract>(joinContext).tables;
    const postTable = { name: 'post' };
    const postUserId = {
      ...joinTables.user.columns.id,
      table: 'post',
      column: 'userId',
      toExpr: () => ColumnRef.of('post', 'userId'),
    } as unknown as typeof joinTables.user.columns.id;

    for (const [method, expected] of [
      ['innerJoin', 'inner'],
      ['leftJoin', 'left'],
      ['rightJoin', 'right'],
      ['fullJoin', 'full'],
    ] as const) {
      const joined = sql<Contract, CodecTypes>({ context: joinContext })
        .from(joinTables.user)
        [method](postTable, (on) => on.eqCol(joinTables.user.columns.id, postUserId));
      const plan = joined.select({ id: joinTables.user.columns.id }).build();
      expect((plan.ast as SelectAst).joins?.[0]?.joinType).toBe(expected);
    }
  });
});
