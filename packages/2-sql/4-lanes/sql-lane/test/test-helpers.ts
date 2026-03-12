import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixtureContract<TContract extends SqlContract<SqlStorage>>(
  name: string,
): TContract {
  return validateContract<TContract>(
    JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')),
  );
}

export function createFixtureContext<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
) {
  return createTestContext(contract, createStubAdapter());
}

export function loadFixtureSchema<TContract extends SqlContract<SqlStorage>>(name: string) {
  const contract = loadFixtureContract<TContract>(name);
  const context = createFixtureContext(contract);

  return {
    contract,
    context,
    tables: schema<TContract>(context).tables,
  };
}
