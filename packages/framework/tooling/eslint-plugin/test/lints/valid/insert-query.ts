import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { Contract } from '../../fixtures/user';
import { loadContract } from '../../utils';

const contract = loadContract<Contract>('user');
const adapter = createStubAdapter();
const context = createTestContext(contract, adapter);
const tables = schema(context).tables;

sql<typeof contract>({ context })
  .insert(tables.user, {
    email: param('email'),
    name: param('name'),
  })
  .build({ params: { email: 'test@example.com', name: 'Test User' } });
