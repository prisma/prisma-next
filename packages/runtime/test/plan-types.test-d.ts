import type { Plan, ResultType } from '@prisma-next/contract/types';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { expectTypeOf, test } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { Contract } from '../../sql-query/test/fixtures/contract.d';
import contractJson from '../../sql-query/test/fixtures/contract.json' with { type: 'json' };
import { createRuntime } from '../src/runtime';
import { createRuntimeContext } from '../src/context';

test('execute() preserves Row type from Plan', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Verify Row type is correctly inferred
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Create runtime with stub driver for type testing
  const runtime = createRuntime({
    context,
    adapter,
    driver: {
      connect: async () => {},
      execute: async function* () {},
      close: async () => {},
    } as unknown as import('@prisma-next/sql-target').SqlDriver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });

  // execute() should accept Plan<Row> and return AsyncIterable<Row>
  const result = runtime.execute(plan);
  expectTypeOf(result).toMatchTypeOf<AsyncIterable<Row>>();
});

test('execute() signature matches Plan Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Verify Row type is correctly inferred
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify that execute signature matches
  interface Runtime {
    execute<Row>(plan: Plan<Row>): AsyncIterable<Row>;
  }

  const runtime: Runtime = {
    execute<Row>(_plan: Plan<Row>): AsyncIterable<Row> {
      void _plan;
      return (async function* () {})();
    },
  };

  const result = runtime.execute(plan);
  expectTypeOf(result).toMatchTypeOf<AsyncIterable<Row>>();
});
