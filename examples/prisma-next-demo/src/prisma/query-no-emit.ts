import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { contract } from '../../prisma/contract.ts';
import { getContext } from './runtime-no-emit.ts';

const context = getContext();

// Use contract directly from TypeScript - no emit needed!
export const sql = sqlBuilder<typeof contract>({
  context,
});

export const schema = schemaBuilder<typeof contract>(context);
export const tables = schema.tables;

export const orm = ormBuilder<typeof contract>({
  context,
});
