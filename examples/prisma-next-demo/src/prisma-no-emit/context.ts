import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { contract } from '../../prisma/contract';
// SqlContractResult<Definition> is too deeply nested for TypeScript to reduce
// to literal table keys, so the emitted Contract type is still needed for
// full type inference in the SQL builder and ORM surfaces.
import type { Contract } from '../prisma/contract.d';

export const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvector],
});

const validatedContract = validateContract<Contract>(contract);

export const context = createExecutionContext({
  contract: validatedContract,
  stack,
});

export const schema = schemaBuilder(context);
export const tables = schema.tables;
export const sql = sqlBuilder<Contract>({ context });
