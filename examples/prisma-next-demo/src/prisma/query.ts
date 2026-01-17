import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { Contract } from './contract.d';
import { executionContext } from './execution-context';

export const sql = sqlBuilder<Contract>({
  context: executionContext,
});

export const schema = schemaBuilder<Contract>(executionContext);
export const tables = schema.tables;

export const orm = ormBuilder<Contract>({
  context: executionContext,
});
