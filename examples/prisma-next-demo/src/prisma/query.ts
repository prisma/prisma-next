import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { executionContext } from './execution-context';

export const schema = schemaBuilder(executionContext);
export const tables = schema.tables;
export const sql = sqlBuilder({ context: executionContext });
export const orm = ormBuilder({ context: executionContext });
