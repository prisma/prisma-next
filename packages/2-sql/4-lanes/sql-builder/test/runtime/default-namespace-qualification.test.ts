import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import type { TableSource } from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

const sqlContract = validateSqlContractFully<Contract>(contractJson);

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  types: {},
  applyMutationDefaults: () => [],
};

const stubInferer = { inferCodec: () => 'pg/text@1' };

// Always-qualified builder: alias to the `public` namespace facet (the sole
// shape) so tables are reached as `db().<table>` through that facet.
function db() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    rawCodecInferer: stubInferer,
  }).public;
}

describe('namespace-facet table resolution', () => {
  it('stamps the public namespace on TableSource from the namespace facet', () => {
    const ast = db().users.buildAst() as TableSource;
    expect(ast.namespaceId).toBe('public');
  });

  it('carries the namespace coordinate through select, insert, update, and delete plans', () => {
    const selectFrom = (db().users.select('id').build().ast as { from: TableSource }).from;
    expect(selectFrom.namespaceId).toBe('public');

    const insertTable = (
      db()
        .users.insert([{ id: 1, email: 'a@example.com', name: 'Ann' }])
        .build().ast as { table: TableSource }
    ).table;
    expect(insertTable.namespaceId).toBe('public');

    const updateTable = (db().users.update({ name: 'Bob' }).build().ast as { table: TableSource })
      .table;
    expect(updateTable.namespaceId).toBe('public');

    const deleteTable = (
      db()
        .users.delete()
        .where((f, fns) => fns.eq(f.id, '1'))
        .build().ast as { table: TableSource }
    ).table;
    expect(deleteTable.namespaceId).toBe('public');
  });
});
