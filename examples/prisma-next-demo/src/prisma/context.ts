import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Kysely } from 'kysely';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = validateContract<Contract>(contractJson);

export const demoStack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvector],
});

export const demoContext = createExecutionContext({
  contract,
  stack: demoStack,
});

export const demoSchema = schemaBuilder(demoContext);
export const demoSql = sqlBuilder({ context: demoContext });

export function createKysely(runtime: Runtime) {
  return new Kysely<KyselifyContract<Contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });
}
