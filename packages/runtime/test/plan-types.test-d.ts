import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plan, ResultType } from '@prisma-next/contract/types';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { expectTypeOf, test } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { Contract } from '../../sql-query/test/fixtures/contract.d';
import { createRuntime } from '../src/runtime';
import { createRuntimeContext } from '../src/context';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, '../../sql/test/fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents) as unknown;
  return validateContract<Contract>(contractJson);
}

test('execute() preserves Row type from Plan', () => {
  const contract = loadContract('contract');
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user!;
  const userColumns = userTable.columns;

  const plan = sql({ context })
    .from(userTable)
    .select({
      id: userColumns.id!,
      email: userColumns.email!,
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
  const contract = loadContract('contract');
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user!;
  const userColumns = userTable.columns;

  const plan = sql({ context })
    .from(userTable)
    .select({
      id: userColumns.id!,
      email: userColumns.email!,
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
