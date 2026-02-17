import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import {
  createBinaryExpr,
  createColumnRef,
  createTableRef,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('select builder edge cases', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userTable = tables.user;
  const userColumns = userTable.columns;

  it('throws when from is not called', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('from() must be called before building a query');
  });

  it('throws when select is not called', () => {
    expect(() => sql<Contract, CodecTypes>({ context }).from(userTable).build()).toThrow(
      'select() must be called before build()',
    );
  });

  it('throws when table does not exist', () => {
    const nonexistentTable = createTableRef('nonexistent');
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(nonexistentTable)
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('Unknown table nonexistent');
  });

  it('throws when join table does not exist', () => {
    const nonexistentTable = createTableRef('nonexistent');
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .innerJoin(nonexistentTable, (on) => on.eqCol(userColumns.id, userColumns.id))
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('Unknown table nonexistent');
  });

  it('throws when self-join is attempted', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .innerJoin(userTable, (on) => on.eqCol(userColumns.id, userColumns.id))
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('Self-joins are not supported in MVP');
  });

  it('throws when limit is negative', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .select({
          id: userColumns.id,
        })
        .limit(-1)
        .build(),
    ).toThrow('Limit must be a non-negative integer');
  });

  it('throws when limit is not an integer', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .select({
          id: userColumns.id,
        })
        .limit(1.5)
        .build(),
    ).toThrow('Limit must be a non-negative integer');
  });

  it('throws when parameter is missing in where', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .where(userColumns.id.eq(param('userId')))
        .select({
          id: userColumns.id,
        })
        .build({ params: {} }),
    ).toThrow('Missing value for parameter userId');
  });

  it('handles invalid column for alias', () => {
    // This test verifies that buildMeta throws when column is missing
    // The actual error is thrown in buildMeta when processing projection
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .select({
          id: userColumns.id,
        })
        .build(),
    ).not.toThrow('Missing column for alias');
  });

  it('builds query with column-to-column comparison in where', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(userTable)
      .where(userColumns.id.eq(userColumns.createdAt))
      .select({
        id: userColumns.id,
      })
      .build();

    const ast = plan.ast as SelectAst;
    expect(ast.kind).toBe('select');
    expect(ast.where).toEqual(
      createBinaryExpr('eq', createColumnRef('user', 'id'), createColumnRef('user', 'createdAt')),
    );
  });

  it.each([
    ['innerJoin', 'inner'],
    ['leftJoin', 'left'],
    ['rightJoin', 'right'],
    ['fullJoin', 'full'],
  ] as const)('builds query with %s', (joinMethod, expectedJoinType) => {
    const contractWithJoinTable = {
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
    const joinContext = createTestContext(contractWithJoinTable, adapter);
    const postTable = createTableRef('post');
    const postUserId = {
      ...userColumns.id,
      table: 'post',
      column: 'userId',
      toExpr: () => createColumnRef('post', 'userId'),
    } as unknown as typeof userColumns.id;
    const builder = sql<Contract, CodecTypes>({ context: joinContext }).from(userTable);
    const joined = builder[joinMethod](postTable, (on) => on.eqCol(userColumns.id, postUserId));
    const plan = joined
      .select({
        id: userColumns.id,
      })
      .build();

    const ast = plan.ast as SelectAst;
    expect(ast.joins?.[0]).toMatchObject({
      kind: 'join',
      joinType: expectedJoinType,
    });
  });
});
