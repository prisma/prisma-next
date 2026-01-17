import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { contract } from '../../prisma/contract';

// Use contract directly from TypeScript - no emit needed!
export const executionStack = createExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

export const executionContext = executionStack.createContext({ contract });

export const sql = sqlBuilder<typeof contract>({
  context: executionContext,
});

export const schema = schemaBuilder<typeof contract>(executionContext);
export const tables = schema.tables;

export const orm = ormBuilder<typeof contract>({
  context: executionContext,
});
