import { expectTypeOf, test } from 'vitest';
import { createRuntime } from '../src/runtime';
import type { Plan, ResultType } from '@prisma-next/sql/types';
import type { SqlContract } from '@prisma-next/contract/types';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { sql } from '@prisma-next/sql/sql';
import { schema } from '@prisma-next/sql/schema';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, 'fixtures');

function loadContract(name: string): SqlContract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  return JSON.parse(contents) as SqlContract;
}

test('execute() preserves Row type from Plan', () => {
  const contract = loadContract('contract');
  const adapter = createPostgresAdapter();
  const tables = schema(contract).tables;
  const userTable = tables.user as typeof tables.user & Record<string, any>;

  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({
      id: userTable.id,
      email: userTable.email,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Create runtime with stub driver for type testing
  const runtime = createRuntime({
    contract,
    adapter,
    driver: {
      connect: async () => {},
      execute: async function* () {},
      close: async () => {},
    } as any,
    verify: { mode: 'never' },
  });

  // execute() should accept Plan<Row> and return AsyncIterable<Row>
  const result = runtime.execute(plan);
  expectTypeOf(result).toMatchTypeOf<AsyncIterable<Row>>();
});

test('execute() signature matches Plan Row type', () => {
  const contract = loadContract('contract');
  const adapter = createPostgresAdapter();
  const tables = schema(contract).tables;
  const userTable = tables.user as typeof tables.user & Record<string, any>;

  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({
      id: userTable.id,
      email: userTable.email,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Verify that execute signature matches
  interface Runtime {
    execute<Row>(plan: Plan<Row>): AsyncIterable<Row>;
  }

  const runtime: Runtime = {
    execute<Row>(plan: Plan<Row>): AsyncIterable<Row> {
      return (async function* () {})();
    },
  };

  const result = runtime.execute(plan);
  expectTypeOf(result).toMatchTypeOf<AsyncIterable<Row>>();
});

