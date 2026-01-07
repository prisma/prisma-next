import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { Contract } from './contract.d.ts';
import { getContext } from './runtime.ts';

const context = getContext();

export const sql = sqlBuilder<Contract>({
  context,
});

export const schema = schemaBuilder<Contract>(context);
export const tables = schema.tables;

export const orm = ormBuilder<Contract>({
  context,
});
