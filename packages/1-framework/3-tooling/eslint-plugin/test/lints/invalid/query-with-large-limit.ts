import { sql } from '@prisma-next/sql-builder/runtime';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { Contract } from '../../fixtures/user';
import { loadContract } from '../../utils';

const contract = loadContract<Contract>('user');
const adapter = createStubAdapter();
const context = createTestContext(contract, adapter);
const db = sql<typeof contract>({ context });

db.user.select('id', 'email').limit(5000).build();
