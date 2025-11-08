import { orm as ormBuilder } from '@prisma-next/sql-query/orm';
import { schema as schemaBuilder } from '@prisma-next/sql-query/schema';
import { sql as sqlBuilder } from '@prisma-next/sql-query/sql';
import type { Contract } from './contract.d';
import { getContext } from './runtime';

const context = getContext();

export const sql = sqlBuilder<Contract>({
  context,
});

export const schema = schemaBuilder<Contract>(context);
export const tables = schema.tables;

export const orm = ormBuilder<Contract>({
  context,
});
