import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { Contract } from '../../fixtures/user.ts';
import { loadContract } from '../../utils.ts';

const testContract = loadContract<Contract>('user');
const adapter = createStubAdapter();
const context = createTestContext(testContract, adapter);
const tables = schema(context).tables;

sql<typeof testContract>({ context })
  .update(tables.user, {
    email: param('email'),
    name: param('name'),
  })
  .where(tables.user.columns.id.eq(param('userId')))
  .build({ params: { email: 'new@example.com', name: 'New Name', userId: 123 } });
