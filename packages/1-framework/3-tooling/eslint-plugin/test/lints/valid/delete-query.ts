import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { Contract } from '../../fixtures/user.ts';
import { loadContract } from '../../utils.ts';

const contract = loadContract<Contract>('user');
const adapter = createStubAdapter();
const context = createTestContext(contract, adapter);
const tables = schema(context).tables;

sql<typeof contract>({ context })
  .delete(tables.user)
  .where(tables.user.columns.id.eq(param('userId')))
  .build({ params: { userId: 123 } });
