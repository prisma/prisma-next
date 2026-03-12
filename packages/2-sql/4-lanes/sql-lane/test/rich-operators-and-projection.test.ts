import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  NullCheckExpr,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(): Contract {
  return validateContract<Contract>(
    JSON.parse(readFileSync(join(fixtureDir, 'contract.json'), 'utf8')),
  );
}

describe('sql lane rich operator interop', () => {
  it('keeps column-to-column comparisons as binary expressions with rich column refs', () => {
    const contract = loadContract();
    const context = createTestContext(contract, createStubAdapter());
    const tables = schema<Contract>(context).tables;

    const selectPlan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .where(tables.user.columns.id.eq(tables.user.columns.createdAt))
      .select({
        id: tables.user.columns.id,
      })
      .build();

    expect(selectPlan.ast).toBeInstanceOf(SelectAst);
    const where = (selectPlan.ast as SelectAst).where as BinaryExpr;
    expect(where).toEqual(
      BinaryExpr.eq(ColumnRef.of('user', 'id'), ColumnRef.of('user', 'createdAt')),
    );
    expect(selectPlan.meta.refs?.columns).toEqual([
      { table: 'user', column: 'id' },
      { table: 'user', column: 'createdAt' },
    ]);
  });

  it('keeps nullable predicates as rich null-check expressions', () => {
    const contract = loadContract();
    const context = createTestContext(contract, createStubAdapter());
    const tables = schema<Contract>(context).tables;

    const deletePlan = sql<Contract, CodecTypes>({ context })
      .delete(tables.user)
      .where(tables.user.columns.deletedAt.isNotNull())
      .build();

    expect(deletePlan.ast).toBeInstanceOf(DeleteAst);
    expect((deletePlan.ast as DeleteAst).where).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('user', 'deletedAt')),
    );
  });
});
